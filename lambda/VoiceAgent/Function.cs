using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Microsoft.IdentityModel.Tokens;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace VoiceAgent;

public class Function
{
    private static readonly string ModelId = Env("BEDROCK_MODEL_ID", "eu.amazon.nova-lite-v1:0");
    private static readonly string ApiBase = Env("TRANSPORT_API_URL", Env("API_BASE", ""));
    private static readonly string ApiKey  = Env("TRANSPORT_API_KEY", Env("API_KEY", ""));

    // Cognito JWT
    private static readonly string CognitoRegion = Env("COGNITO_REGION", "");
    private static readonly string CognitoPool   = Env("COGNITO_USER_POOL_ID", "");
    private static readonly string CognitoClient = Env("COGNITO_CLIENT_ID", "");
    private static readonly string Issuer = CognitoRegion.Length > 0 && CognitoPool.Length > 0
        ? $"https://cognito-idp.{CognitoRegion}.amazonaws.com/{CognitoPool}" : "";
    private static readonly bool JwtEnabled = Issuer.Length > 0;

    // CORS
    private static readonly string[] AllowedOrigins = Env("ALLOWED_ORIGINS", "*")
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    // OKF knowledge — loaded once at cold start
    private static readonly string OkfKnowledge = LoadOkf();

    // JWKS cache
    private static IList<JsonWebKey>? _jwksCache;
    private static long _jwksCachedAt;
    private static readonly SemaphoreSlim JwksLock = new(1, 1);
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private static readonly AmazonBedrockRuntimeClient Bedrock = new();

    // Location cache (populated per cold start or first request)
    private static List<LocInfo>? _locsCache;

    private static readonly string[] ValidSev   = ["Critical", "Urgent", "Normal"];
    private static readonly string[] ValidCases = ["Cardiac", "Trauma", "General", "Maternity", "Pediatric"];

    private static string LoadOkf()
    {
        try
        {
            // Knowledge files are deployed alongside the Lambda binary in a "knowledge/" subfolder.
            var knowledgeDir = Path.Combine(AppContext.BaseDirectory, "knowledge");
            if (!Directory.Exists(knowledgeDir)) return "";
            var sections = new List<string>();
            foreach (var relPath in new[] { "emergency-types/index.md", "vehicles/index.md" })
            {
                var full = Path.Combine(knowledgeDir, relPath);
                if (File.Exists(full)) sections.Add(File.ReadAllText(full));
            }
            var locsDir = Path.Combine(knowledgeDir, "locations");
            if (Directory.Exists(locsDir))
            {
                foreach (var f in Directory.GetFiles(locsDir, "*.md"))
                    if (!f.EndsWith("index.md")) sections.Add(File.ReadAllText(f));
            }
            return string.Join("\n\n---\n\n", sections.Where(s => s.Length > 0));
        }
        catch { return ""; }
    }

    public async Task<APIGatewayHttpApiV2ProxyResponse> FunctionHandler(
        APIGatewayHttpApiV2ProxyRequest request, ILambdaContext context)
    {
        var cors = BuildCors(request.Headers);
        var method = request.RequestContext?.Http?.Method?.ToUpperInvariant() ?? "POST";
        if (method == "OPTIONS") return Reply(new { }, cors);

        // Auth
        var headers = request.Headers ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var bearer = (headers.TryGetValue("authorization", out var ah) ? ah : "")
            .Replace("Bearer ", "", StringComparison.OrdinalIgnoreCase).Trim();
        JwtPayload? claims = null;
        if (!string.IsNullOrEmpty(bearer)) claims = await VerifyJwt(bearer);
        if (JwtEnabled && claims == null)
            return Reply(new { reply = "Please sign in to use the emergency voice line.", booked = (object?)null }, cors, 401);

        JsonObject payload = new();
        try { if (!string.IsNullOrEmpty(request.Body)) payload = JsonNode.Parse(request.Body)?.AsObject() ?? new(); } catch { }

        var messagesNode = payload["messages"]?.AsArray();
        var turns = messagesNode != null
            ? messagesNode
                .Where(t => t != null && t["text"] != null)
                .Take(20)
                .Select(t => new Turn(
                    t!["role"]?.ToString() == "assistant" ? "assistant" : "user",
                    (t["text"]?.ToString() ?? "")[..Math.Min(1000, t["text"]?.ToString()?.Length ?? 0)]))
                .Where(t => t.Text.Length > 0)
                .ToList()
            : new List<Turn>();

        var requestedBy = IdentityOf(claims) ?? payload["requestedBy"]?.ToString();
        var finalize  = payload["finalize"]?.GetValue<bool>() == true;
        var confirmed = payload["confirmed"]?.GetValue<bool>() == true;

        var locs = await GetLocations();
        var transcript = string.Join("\n", turns.Select(t => $"{(t.Role == "assistant" ? "Agent" : "Caller")}: {t.Text}"));
        var anyUser = turns.Any(t => t.Role != "assistant" && t.Text.Trim().Length > 0);

        // Greeting
        if (!anyUser && !finalize)
            return Reply(new { reply = "Emergency line. Do you need an ambulance or a fire truck, and where is it?", booked = (object?)null }, cors);

        try
        {
            // Confirmed path — dispatch the already-collected slots
            var slotsNode = payload["slots"]?.AsObject();
            if (confirmed && slotsNode != null && !string.IsNullOrEmpty(slotsNode["pickup_id"]?.ToString()))
            {
                var sl = ParseSlots(slotsNode);
                return await DoDispatch(sl, requestedBy, locs, cors);
            }

            var slots = await ExtractSlots(transcript, locs);
            Console.WriteLine($"slots {JsonSerializer.Serialize(slots)}");

            var kind = slots.Kind == "fire" || slots.Kind == "medical" ? slots.Kind : "";
            string? pid = KnownId(locs, slots.PickupId)
                ? slots.PickupId
                : (ResolveLocation(slots.PickupId, locs)
                   ?? ResolveLocation(slots.PickupText, locs)
                   ?? ResolveLocation(transcript, locs));
            var caseType = ValidCases.Contains(slots.CaseType) ? slots.CaseType : "";
            var severity = ValidSev.Contains(slots.Severity) ? slots.Severity : "";
            var patients = Math.Max(1, (int)Math.Round((double)slots.Patients));
            var mass = kind == "medical" && patients > 3;

            if (finalize) { if (severity.Length == 0) severity = "Urgent"; if (kind == "medical" && caseType.Length == 0) caseType = "General"; }

            if (kind.Length == 0) return Reply(new { reply = "Do you need an ambulance or a fire truck?", booked = (object?)null }, cors);
            if (pid == null) return Reply(new { reply = "What is the location of the emergency?", booked = (object?)null }, cors);
            if (kind == "medical" && caseType.Length == 0)
                return Reply(new { reply = "What is the medical emergency? For example cardiac, trauma, maternity, pediatric, or general.", booked = (object?)null }, cors);
            if (severity.Length == 0)
                return Reply(new { reply = "How severe is it — critical, urgent, or normal?", booked = (object?)null }, cors);

            // Confirm before dispatch
            var place = locs.FirstOrDefault(l => l.Id == pid)?.Name ?? "the location";
            if (!confirmed)
            {
                var summary = kind == "fire"
                    ? $"a fire truck to {place}, severity {severity}"
                    : mass
                        ? $"a mass casualty response to {place} for {patients} people, severity {severity}"
                        : $"an ambulance to {place} for a {caseType.ToLowerInvariant()} case, severity {severity}";
                return Reply(new
                {
                    reply = $"I have {summary}. Should I dispatch? Say yes to confirm or no to change something.",
                    booked = (object?)null,
                    pending = new { kind, pickup_id = pid, case_type = caseType, severity, units = 1, patients, mass, summary },
                }, cors);
            }

            return await DoDispatch(new SlotData(kind, pid, caseType, severity, 1, patients), requestedBy, locs, cors);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"voice-agent error {ex.GetType().Name} {ex.Message}");
            return Reply(new { reply = $"Voice service error: {ex.Message}", booked = (object?)null }, cors);
        }
    }

    // =====================================================================
    // Dispatch
    // =====================================================================
    private async Task<APIGatewayHttpApiV2ProxyResponse> DoDispatch(
        SlotData s, string? requestedBy, List<LocInfo> locs, Dictionary<string, string> cors)
    {
        var kind = s.Kind == "fire" || s.Kind == "medical" ? s.Kind : "medical";
        var pid = KnownId(locs, s.PickupId) ? s.PickupId : ResolveLocation(s.PickupId, locs);
        if (pid == null)
            return Reply(new { reply = "What is the location of the emergency?", booked = (object?)null }, cors);
        var severity = ValidSev.Contains(s.Severity) ? s.Severity : "Urgent";
        var caseType = ValidCases.Contains(s.CaseType) ? s.CaseType : "General";
        var patients = Math.Max(1, (int)Math.Round((double)s.Patients));
        var units = Math.Max(1, Math.Min(10, s.Units));
        var place = locs.FirstOrDefault(l => l.Id == pid)?.Name ?? "the location";
        var dispatchBody = new Dictionary<string, object>
        {
            ["external_ref"] = $"VOICE-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
            ["kind"] = kind,
            ["source"] = kind == "fire" ? "FIRE" : "HOSPITAL",
            ["pickup"] = new { @ref = pid },
            ["case_type"] = kind == "fire" ? "Fire" : (object)caseType,
            ["severity"] = severity,
            ["units"] = units,
            ["patients"] = patients,
            ["requested_by"] = requestedBy ?? "Voice agent",
        };
        var json = JsonSerializer.Serialize(dispatchBody);
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/emergencies");
        req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        req.Headers.Add("x-api-key", ApiKey);
        var httpResp = await Http.SendAsync(req);
        var resultJson = await httpResp.Content.ReadAsStringAsync();
        Console.WriteLine($"dispatch result {resultJson}");
        JsonDocument result;
        try { result = JsonDocument.Parse(resultJson); }
        catch { result = JsonDocument.Parse("{}"); }
        var root = result.RootElement;

        if (root.TryGetProperty("incident_id", out _))
        {
            var dispatched = root.TryGetProperty("dispatched", out var dp) ? dp.GetInt32() : 0;
            var replyText = dispatched > 0
                ? $"Mass casualty — {dispatched} ambulance{(dispatched > 1 ? "s" : "")} dispatched to {place} for {patients} people."
                : "No ambulances are available right now.";
            return Reply(new
            {
                reply = replyText,
                booked = new { incident_id = root.TryGetProperty("incident_id", out var iid) ? iid.GetString() : null, mass = true, kind, pickup_id = pid, severity, case_type = caseType, patients },
            }, cors);
        }

        var status = root.TryGetProperty("status", out var st) ? st.GetString() : null;
        var ok = status == "EN_ROUTE";
        var hospName = root.TryGetProperty("hospital", out var hn) ? hn.GetString() : null;
        var reason = root.TryGetProperty("reason", out var re) ? re.GetString() : null;
        var dispatchedReply = ok
            ? $"{(kind == "fire" ? "Fire truck" : "Ambulance")} dispatched{(!string.IsNullOrEmpty(hospName) ? " to " + hospName : "")}."
            : (reason ?? "No unit is available right now.");
        return Reply(new
        {
            reply = dispatchedReply,
            booked = new { status, kind, pickup_id = pid, severity, case_type = caseType },
        }, cors);
    }

    // =====================================================================
    // Slot extraction via Bedrock Nova Lite
    // =====================================================================
    private async Task<SlotData> ExtractSlots(string transcript, List<LocInfo> locs)
    {
        var locationContext = OkfKnowledge.Length > 0
            ? $"Use the Open Knowledge Format bundle below to resolve locations and emergency types.\n\n{OkfKnowledge}"
            : "Locations (id=name): " + string.Join("; ", locs.Select(l => $"{l.Id}={l.Name}"));

        var systemText =
            "You read an emergency phone call transcript and extract structured fields. Output ONLY minified JSON, nothing else:\n" +
            "{\"kind\":\"medical|fire|\",\"pickup_id\":\"a location id from the list or empty\",\"pickup_text\":\"the place the caller said or empty\",\"case_type\":\"Cardiac|Trauma|General|Maternity|Pediatric|\",\"severity\":\"Critical|Urgent|Normal|\",\"patients\":0}\n" +
            "Rules: kind=fire for any fire/smoke/blaze, otherwise medical if it's a medical/health emergency, else empty. " +
            "Map the spoken place to the closest location id using the aliases and context in the knowledge bundle; also copy the spoken place into pickup_text. " +
            "\"patients\" = number of people affected/injured (integer); use 0 if unknown. " +
            "A bomb blast, explosion, building collapse, stampede, gas leak, or \"many/multiple people injured\" is a MASS CASUALTY — set case_type to Trauma, severity to Critical, and patients to the stated count (estimate generously if they say \"many\"). " +
            "Leave a field \"\" or 0 ONLY if the caller truly has not indicated it. Do not invent values that weren't implied.\n\n" +
            locationContext;

        var converseReq = new ConverseRequest
        {
            ModelId = ModelId,
            System = [new SystemContentBlock { Text = systemText }],
            Messages =
            [
                new Message
                {
                    Role = ConversationRole.User,
                    Content = [new ContentBlock { Text = transcript.Length > 0 ? transcript : "(no input yet)" }],
                },
            ],
        };
        var resp = await Bedrock.ConverseAsync(converseReq);
        var raw = resp.Output?.Message?.Content?.FirstOrDefault(c => c.Text != null)?.Text ?? "";
        var match = Regex.Match(raw, @"\{[\s\S]*\}");
        if (!match.Success) return new SlotData("", null, "", "", 1, 0);
        try
        {
            var doc = JsonDocument.Parse(match.Value);
            var r = doc.RootElement;
            return new SlotData(
                Kind: r.TryGetProperty("kind", out var k) ? k.GetString() ?? "" : "",
                PickupId: r.TryGetProperty("pickup_id", out var pi) ? pi.GetString() : null,
                CaseType: r.TryGetProperty("case_type", out var ct) ? ct.GetString() ?? "" : "",
                Severity: r.TryGetProperty("severity", out var sv) ? sv.GetString() ?? "" : "",
                Units: 1,
                Patients: r.TryGetProperty("patients", out var pt) && pt.TryGetDouble(out var ptD) ? ptD : 0
            ) with { PickupText = r.TryGetProperty("pickup_text", out var pxt) ? pxt.GetString() : null };
        }
        catch { return new SlotData("", null, "", "", 1, 0); }
    }

    private static SlotData ParseSlots(JsonObject? o)
    {
        if (o == null) return new SlotData("", null, "", "", 1, 0);
        var kind = o["kind"]?.ToString() ?? "";
        var pid = o["pickup_id"]?.ToString();
        var ct = o["case_type"]?.ToString() ?? "";
        var sv = o["severity"]?.ToString() ?? "";
        var units = int.TryParse(o["units"]?.ToString(), out var u) ? u : 1;
        var patients = double.TryParse(o["patients"]?.ToString(), out var p) ? p : 0;
        return new SlotData(kind, pid, ct, sv, units, patients);
    }

    // =====================================================================
    // Location helpers
    // =====================================================================
    private record LocInfo(string Id, string Name);

    private async Task<List<LocInfo>> GetLocations()
    {
        if (_locsCache != null) return _locsCache;
        try
        {
            var resp = await Http.GetStringAsync($"{ApiBase}/reference/locations");
            var arr = JsonSerializer.Deserialize<JsonElement[]>(resp) ?? [];
            _locsCache = arr
                .Where(e => e.TryGetProperty("id", out _))
                .Select(e => new LocInfo(
                    e.GetProperty("id").GetString() ?? "",
                    e.TryGetProperty("name", out var n) ? n.GetString() ?? "" : ""))
                .ToList();
        }
        catch { _locsCache = []; }
        return _locsCache;
    }

    private static bool KnownId(List<LocInfo> locs, string? id)
        => !string.IsNullOrEmpty(id) && locs.Any(l => l.Id == id);

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "quarters","quarter","hostel","hostels","block","near","the","area","road",
        "gate","colony","campus","to","at","in","a","an","please","send","need","there","is","fire",
        "accident","ambulance","truck","building","house","flat","number","no","and","me","we","my",
    };

    private static string Norm(string s)
        => Regex.Replace(Regex.Replace(s.ToLowerInvariant(), @"[^a-z0-9 ]", " "), @"\s+", " ").Trim();

    private static string? ResolveLocation(string? text, List<LocInfo> locs)
    {
        if (string.IsNullOrEmpty(text) || locs.Count == 0) return null;
        var full = Norm(text);
        var q = full.Split(' ').Where(w => w.Length > 0 && !StopWords.Contains(w)).ToArray();
        string? best = null;
        var bestScore = 0;
        foreach (var loc in locs)
        {
            var name = Norm(loc.Name);
            var nameTok = name.Split(' ').Where(w => w.Length > 0).ToArray();
            var score = 0;
            foreach (var w in q)
            {
                if (nameTok.Contains(w)) score += 2;
                else if (nameTok.Any(n => n.Length > 2 && (n.Contains(w) || w.Contains(n)))) score += 1;
            }
            if (name.Length > 0 && (full.Contains(name) || name.Contains(full))) score += 3;
            if (score > bestScore) { bestScore = score; best = loc.Id; }
        }
        return bestScore >= 2 ? best : null;
    }

    // =====================================================================
    // Cognito JWT verification
    // =====================================================================
    private static async Task<JwtPayload?> VerifyJwt(string token)
    {
        if (!JwtEnabled || string.IsNullOrEmpty(token)) return null;
        var parts = token.Split('.');
        if (parts.Length != 3) return null;
        try
        {
            var keys = await GetJwks();
            var handler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler { MaximumTokenSizeInBytes = 1024 * 16 };
            var vp = new TokenValidationParameters
            {
                ValidateIssuer = true, ValidIssuer = Issuer,
                ValidateAudience = false, ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(5),
                IssuerSigningKeys = keys,
            };
            handler.ValidateToken(token, vp, out var validated);
            var jwt = (System.IdentityModel.Tokens.Jwt.JwtSecurityToken)validated;
            if (!string.IsNullOrEmpty(CognitoClient))
            {
                var aud = jwt.Claims.FirstOrDefault(c => c.Type == "aud")?.Value
                       ?? jwt.Claims.FirstOrDefault(c => c.Type == "client_id")?.Value;
                if (aud != null && aud != CognitoClient) return null;
            }
            var tokenUse = jwt.Claims.FirstOrDefault(c => c.Type == "token_use")?.Value;
            if (tokenUse != null && tokenUse != "access" && tokenUse != "id") return null;
            return jwt.Payload;
        }
        catch { return null; }
    }

    private static async Task<IList<JsonWebKey>> GetJwks()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (_jwksCache != null && now - _jwksCachedAt < 3_600_000) return _jwksCache;
        await JwksLock.WaitAsync();
        try
        {
            now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (_jwksCache != null && now - _jwksCachedAt < 3_600_000) return _jwksCache;
            var json = await Http.GetStringAsync($"{Issuer}/.well-known/jwks.json");
            var keySet = new JsonWebKeySet(json);
            _jwksCache = keySet.Keys;
            _jwksCachedAt = now;
            return _jwksCache;
        }
        finally { JwksLock.Release(); }
    }

    private static string? IdentityOf(JwtPayload? claims)
    {
        if (claims == null) return null;
        foreach (var key in new[] { "sub", "username", "email", "name" })
            if (claims.TryGetValue(key, out var v) && v is string s && s.Length > 0) return s;
        return null;
    }

    // =====================================================================
    // CORS + response helpers
    // =====================================================================
    private static Dictionary<string, string> BuildCors(IDictionary<string, string>? headers)
    {
        var origin = headers?.TryGetValue("origin", out var o) == true ? o : null;
        string allow;
        if (AllowedOrigins.Contains("*")) allow = "*";
        else if (origin != null && AllowedOrigins.Contains(origin)) allow = origin;
        else allow = AllowedOrigins.FirstOrDefault() ?? "null";
        return new Dictionary<string, string>
        {
            ["access-control-allow-origin"] = allow,
            ["access-control-allow-headers"] = "content-type,authorization",
            ["access-control-allow-methods"] = "POST,OPTIONS",
            ["vary"] = "Origin",
            ["content-type"] = "application/json",
        };
    }

    private static APIGatewayHttpApiV2ProxyResponse Reply(object body, Dictionary<string, string> cors, int code = 200)
        => new()
        {
            StatusCode = code,
            Headers = cors,
            Body = JsonSerializer.Serialize(body, new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull }),
        };

    private static string Env(string name, string def) => Environment.GetEnvironmentVariable(name) ?? def;

    // =====================================================================
    // Data records
    // =====================================================================
    private record Turn(string Role, string Text);
    private record SlotData(string Kind, string? PickupId, string CaseType, string Severity, int Units, double Patients)
    {
        public string? PickupText { get; init; }
    }
}
