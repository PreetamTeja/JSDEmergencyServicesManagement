using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Amazon.DynamoDBv2.Model;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.Lambda.Serialization.SystemTextJson;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace TransportApi;

public class Function
{
    // ---- Tables (env-overridable) ----
    private static readonly string TblOps      = Env("TBL_REQUESTS", "TransportRequests");
    private static readonly string TblFleet    = Env("TBL_FLEET",    "Fleet");
    private static readonly string TblCards    = Env("TBL_CARDS",    "ShuttleCards");
    private static readonly string TblRef      = Env("TBL_REF",      "ReferenceData");
    private static readonly string TblEmp      = Env("EMP_TABLE",    "jamshedpur-users");
    private static readonly string FnName      = Env("AWS_LAMBDA_FUNCTION_NAME", "psiog-transport-api");
    private static readonly string VoiceFnName = Env("VOICE_FN_NAME", "psiog-voice-agent");
    private static readonly string BedrockModelId = Env("BEDROCK_MODEL_ID", "eu.amazon.nova-lite-v1:0");
    private static readonly string AppBaseUrl  = (Env("APP_BASE_URL", "")).TrimEnd('/');
    private static readonly string PolicyBucket  = Env("POLICY_BUCKET", "");
    private static readonly string PolicySyncFn  = Env("POLICY_SYNC_FUNCTION", "psiog-policy-sync");
    private static readonly string PolicyKey     = Env("POLICY_KEY", "policy.pdf");

    private static readonly JsonDocument PolicyConfig = ParseJson(Env("POLICY_CONFIG", "{}"));

    // CORS
    private static readonly string[] AllowedOrigins = (Env("ALLOWED_ORIGINS", "*"))
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    // Services (reused across warm invocations)
    private static readonly DynamoService Ddb  = new();
    private static readonly CloudWatchService Cwsvc = new();
    private static readonly AmazonS3Client S3  = new();
    private static readonly Amazon.Lambda.AmazonLambdaClient LambdaClient = new();
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    // Reference data cache (warm invocation reuse)
    private static RefData? _ref;

    // ---- Fuel constants ----
    private record FuelSpec(double TankL, double Kmpl);
    private static readonly Dictionary<string, FuelSpec> FuelSpecMap = new()
    {
        ["ambulance"] = new(60, 9),
        ["firetruck"]  = new(200, 5),
    };
    private const double RefuelPct = 0.20;

    // ---- Speed ----
    private static double SpeedKmh => GetPolicyDouble("speed_kmh", 28);

    // ---- Entry point ----
    public async Task<APIGatewayHttpApiV2ProxyResponse> FunctionHandler(
        APIGatewayHttpApiV2ProxyRequest request, ILambdaContext context)
    {
        var corsHeaders = BuildCors(request.Headers);
        var method = request.RequestContext?.Http?.Method?.ToUpperInvariant() ?? "GET";
        var rawPath = request.RawPath ?? "/";

        if (method == "OPTIONS")
            return Resp(204, null, corsHeaders);

        JsonObject body = new();
        try
        {
            if (!string.IsNullOrEmpty(request.Body))
                body = JsonNode.Parse(request.Body)?.AsObject() ?? new();
        }
        catch { return ErrResp(400, "BAD_JSON", "Invalid JSON body", corsHeaders); }

        var seg = rawPath.Trim('/').Split('/');

        // --- Principal resolution ---
        var headers = request.Headers ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var apiKeySource = Auth.CallerSource(headers);
        var bearerToken = (headers.TryGetValue("authorization", out var authH) ? authH : "").Replace("Bearer ", "", StringComparison.OrdinalIgnoreCase).Trim();
        JwtPayload? claims = null;
        if (!string.IsNullOrEmpty(bearerToken))
            claims = await Auth.VerifyJwt(bearerToken);
        var admin = apiKeySource == "CONSOLE" || (claims != null && Auth.IsAdmin(claims));
        var identity = Auth.IdentityOf(claims);
        var authed = apiKeySource != null || claims != null;
        var authOn = Auth.KeysEnabled || Auth.JwtEnabled;

        // --- Write authorization ---
        if (method == "POST")
        {
            if (authOn && !authed) return ErrResp(401, "UNAUTHORIZED", "Authentication required", corsHeaders);
            if (apiKeySource != null && apiKeySource != "CONSOLE" && !Auth.CanPost(apiKeySource, seg[0]))
                return ErrResp(403, "FORBIDDEN", $"{apiKeySource} key is not permitted to POST /{seg[0]}", corsHeaders);
            if (apiKeySource == null && claims != null && !admin)
            {
                var allowed = seg[0] == "emergencies" || (seg[0] == "requests" && seg.Length > 2 && seg[2] == "cancel");
                if (!allowed) return ErrResp(403, "FORBIDDEN", "Not permitted for this user", corsHeaders);
            }
        }
        // source is server-controlled
        if (apiKeySource != null && apiKeySource != "CONSOLE") body["source"] = apiKeySource;
        else if (apiKeySource == null && claims != null && !admin) body["source"] = "PORTAL";

        // --- Read authorization ---
        if (method == "GET" && authOn)
        {
            var adminGet = new[] { "employees", "allotments", "fuel", "cards", "powerbi" };
            var authedGet = new[] { "fleet", "ops" }.Concat(adminGet).ToArray();
            if (authedGet.Contains(seg[0]) && !authed) return ErrResp(401, "UNAUTHORIZED", "Authentication required", corsHeaders);
            if (adminGet.Contains(seg[0]) && !admin) return ErrResp(403, "FORBIDDEN", "Admin only", corsHeaders);
        }

        try
        {
            // ---- health ----
            if (rawPath == "/health")
                return Ok(new { ok = true, time = Now(), auth = authOn, jwt = Auth.JwtEnabled, policy = PolicyConfig.RootElement }, corsHeaders);

            // ---- public tracking ----
            if (method == "GET" && seg[0] == "track" && seg.Length > 1 && !string.IsNullOrEmpty(seg[1]))
            {
                var item = await GetOpsItem(seg[1]);
                var token = QS(request, "t") ?? QS(request, "token");
                if (item == null || Str(item, "entity") != "EMG" || string.IsNullOrEmpty(Str(item, "track_token")) || token != Str(item, "track_token"))
                    return ErrResp(404, "NOT_FOUND", "tracking link invalid or expired", corsHeaders);
                var refData = await LoadRef();
                var pt = ResolvePickup(refData, GetObj(item, "pickup"));
                var veh = !string.IsNullOrEmpty(Str(item, "assigned_vehicle_id"))
                    ? await Ddb.GetItem(TblFleet, Key($"VEH#{Str(item, "assigned_vehicle_id")}", "META"))
                    : null;
                GeoPoint? ZoneRef(string? id) { var z = refData.Zones.FirstOrDefault(z => Str(z, "id") == id); return z != null ? new GeoPoint(Dbl(z, "lat"), Dbl(z, "lng")) : null; }
                object? Named(double lat, double lng, string? label) => lat != 0 ? new { lat, lng, label } : null;
                var incidentLabel = Str(GetObj(item, "pickup"), "name") ?? (pt != null ? $"{pt.Lat:F4}, {pt.Lng:F4}" : "Scene");
                object? origin = null, pickup = null, destination = null;
                var kind = Str(item, "kind");
                if (kind == "fire")
                {
                    var st = refData.FireStations.FirstOrDefault(f => Str(f, "id") == Str(item, "fire_station_id"));
                    origin = st != null ? Named(Dbl(st, "lat"), Dbl(st, "lng"), Str(st, "name")) :
                        (veh != null && ZoneRef(Str(veh, "home_zone_id")) is { } zr ? Named(zr.Lat, zr.Lng, "Fire station") : null);
                    destination = pt != null ? Named(pt.Lat, pt.Lng, incidentLabel) : null;
                }
                else
                {
                    var zr2 = veh != null ? ZoneRef(Str(veh, "home_zone_id")) : null;
                    origin = zr2 != null ? Named(zr2.Lat, zr2.Lng, "Unit base") : null;
                    pickup = pt != null ? Named(pt.Lat, pt.Lng, incidentLabel) : null;
                    if (kind == "blood")
                    {
                        var bank = refData.Locations.FirstOrDefault(l => Str(l, "id") == Str(item, "blood_bank_id"));
                        destination = bank != null ? Named(Dbl(bank, "lat"), Dbl(bank, "lng"), Str(bank, "name")) : null;
                    }
                    else
                    {
                        var hosp = refData.Hospitals.FirstOrDefault(h => Str(h, "id") == Str(item, "hospital_id"));
                        destination = hosp != null ? Named(Dbl(hosp, "lat"), Dbl(hosp, "lng"), Str(hosp, "name")) : null;
                    }
                }
                return Ok(new
                {
                    id = Str(item, "id"), kind, status = Str(item, "status"), severity = Str(item, "severity"),
                    case_type = Str(item, "case_type"), eta_min = Dbl(item, "eta_min"),
                    eta_to_pickup_min = Dbl(item, "eta_to_pickup_min"), eta_complete = item.GetValueOrDefault("eta_complete"),
                    distance_km = Dbl(item, "distance_km"),
                    vehicle = veh != null ? new { reg = Str(veh, "reg"), type = Str(veh, "type") } : null,
                    origin, pickup, destination, created_at = Str(item, "created_at"), updated_at = Str(item, "updated_at"),
                }, corsHeaders);
            }

            // ---- Power BI embed token ----
            if (method == "GET" && seg[0] == "powerbi" && seg.Length > 1 && seg[1] == "embed-token")
            {
                var tenantId   = Env("PBI_TENANT_ID", "");
                var clientId   = Env("PBI_CLIENT_ID", "");
                var clientSecret = Env("PBI_CLIENT_SECRET", "");
                var workspaceId = Env("PBI_WORKSPACE_ID", "");
                var reportId   = Env("PBI_REPORT_ID", "");
                if (string.IsNullOrEmpty(tenantId) || string.IsNullOrEmpty(clientId) || string.IsNullOrEmpty(clientSecret)
                    || string.IsNullOrEmpty(workspaceId) || string.IsNullOrEmpty(reportId))
                    return ErrResp(500, "PBI_NOT_CONFIGURED", "Power BI service principal env vars are not set", corsHeaders);

                // 1) AAD token
                var aadContent = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "client_credentials", ["client_id"] = clientId,
                    ["client_secret"] = clientSecret,
                    ["scope"] = "https://analysis.windows.net/powerbi/api/.default",
                });
                var aadResp = await Http.PostAsync($"https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token", aadContent);
                var aadJson = JsonDocument.Parse(await aadResp.Content.ReadAsStringAsync());
                if (!aadJson.RootElement.TryGetProperty("access_token", out var accessTokenEl))
                {
                    var desc = aadJson.RootElement.TryGetProperty("error_description", out var ed) ? ed.GetString() : "AAD token request failed";
                    return ErrResp(502, "PBI_AAD_FAILED", desc ?? "AAD token request failed", corsHeaders);
                }
                var accessToken = accessTokenEl.GetString()!;
                var pbiBase = $"https://api.powerbi.com/v1.0/myorg/groups/{workspaceId}/reports/{reportId}";
                Http.DefaultRequestHeaders.Remove("Authorization");
                // 2) Report metadata
                using var repReq = new HttpRequestMessage(HttpMethod.Get, pbiBase);
                repReq.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
                var repResp = await Http.SendAsync(repReq);
                var repJson = JsonDocument.Parse(await repResp.Content.ReadAsStringAsync());
                if (!repJson.RootElement.TryGetProperty("embedUrl", out var embedUrlEl))
                {
                    var msg = repJson.RootElement.TryGetProperty("error", out var eEl) && eEl.TryGetProperty("message", out var mEl) ? mEl.GetString() : "report fetch failed";
                    return ErrResp(502, "PBI_REPORT_FAILED", msg ?? "report fetch failed", corsHeaders);
                }
                // 3) Embed token
                using var gtReq = new HttpRequestMessage(HttpMethod.Post, $"{pbiBase}/GenerateToken");
                gtReq.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
                gtReq.Content = new StringContent("{\"accessLevel\":\"View\"}", Encoding.UTF8, "application/json");
                var gtResp = await Http.SendAsync(gtReq);
                var gtJson = JsonDocument.Parse(await gtResp.Content.ReadAsStringAsync());
                if (!gtJson.RootElement.TryGetProperty("token", out var tokenEl))
                {
                    var msg = gtJson.RootElement.TryGetProperty("error", out var eEl) && eEl.TryGetProperty("message", out var mEl) ? mEl.GetString() : "GenerateToken failed";
                    return ErrResp(502, "PBI_TOKEN_FAILED", msg ?? "GenerateToken failed", corsHeaders);
                }
                var expiry = gtJson.RootElement.TryGetProperty("expiration", out var exp) ? exp.GetString() : null;
                return Ok(new
                {
                    embedUrl = embedUrlEl.GetString(),
                    reportId = repJson.RootElement.TryGetProperty("id", out var rid2) ? rid2.GetString() : null,
                    token = tokenEl.GetString(),
                    expiry,
                }, corsHeaders);
            }

            // ---- policy PDF upload ----
            if (method == "POST" && seg[0] == "policy" && seg.Length == 1)
            {
                if (!admin) return ErrResp(403, "FORBIDDEN", "Admin only", corsHeaders);
                if (string.IsNullOrEmpty(PolicyBucket)) return ErrResp(500, "NO_BUCKET", "POLICY_BUCKET not configured", corsHeaders);
                var b64 = Str(body, "content_base64") ?? Str(body, "file");
                if (string.IsNullOrEmpty(b64)) return ErrResp(400, "NO_FILE", "content_base64 (PDF) required", corsHeaders);
                var stripped = System.Text.RegularExpressions.Regex.Replace(b64, @"^data:[^;]*;base64,", "");
                var bytes = Convert.FromBase64String(stripped);
                if (bytes.Length == 0 || bytes.Length > 5 * 1024 * 1024) return ErrResp(400, "BAD_FILE", "empty or too large (max 5MB)", corsHeaders);
                await S3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = PolicyBucket, Key = PolicyKey,
                    InputStream = new System.IO.MemoryStream(bytes), ContentType = "application/pdf",
                });
                var inv = await LambdaClient.InvokeAsync(new Amazon.Lambda.Model.InvokeRequest
                {
                    FunctionName = PolicySyncFn,
                    Payload = JsonSerializer.Serialize(new { bucket = PolicyBucket, key = PolicyKey }),
                });
                JsonDocument result;
                try { result = JsonDocument.Parse(inv.Payload); }
                catch { result = JsonDocument.Parse("{}"); }
                var ok2 = result.RootElement.TryGetProperty("ok", out var okEl) && okEl.GetBoolean();
                var applied = result.RootElement.TryGetProperty("applied", out var apEl) ? (object?)apEl.GetString() : null;
                var errMsg = result.RootElement.TryGetProperty("error", out var erEl) ? erEl.GetString() : null;
                return Ok(new { ok = ok2, applied, error = errMsg }, corsHeaders);
            }

            // ---- reference ----
            if (method == "GET" && seg[0] == "reference")
            {
                var refData = await LoadRef();
                if (seg.Length > 1)
                {
                    return seg[1] switch
                    {
                        "locations"    => Ok(refData.Locations, corsHeaders),
                        "zones"        => Ok(refData.Zones, corsHeaders),
                        "hospitals"    => Ok(refData.Hospitals, corsHeaders),
                        "firestations" => Ok(refData.FireStations, corsHeaders),
                        "policy"       => Ok(await GetPolicyItem(), corsHeaders),
                        _ => ErrResp(404, "NO_ROUTE", $"No reference/{seg[1]}", corsHeaders),
                    };
                }
            }

            // ---- employees ----
            if (method == "GET" && seg[0] == "employees" && seg.Length == 1)
            {
                var items = await Ddb.Scan(TblEmp);
                var bandsList = await PolicyLevels();
                var active = items.Where(e =>
                {
                    var s = Str(e, "status") ?? Str(e, "employee_status");
                    return s == null || s == "Active";
                }).Select(e => MapEmployee(e, bandsList)).ToList();
                return Ok(active, corsHeaders);
            }
            if (method == "GET" && seg[0] == "employees" && seg.Length > 1)
            {
                var raw = await EmployeeRaw(seg[1]);
                if (raw == null) return ErrResp(404, "NOT_FOUND", $"employee {seg[1]} not found", corsHeaders);
                var bandsList = await PolicyLevels();
                return Ok(MapEmployee(raw, bandsList), corsHeaders);
            }

            // ---- allotments ----
            if (method == "GET" && seg[0] == "allotments")
            {
                var items = await Ddb.Scan(TblFleet, "begins_with(PK, :a)", null, new() { [":a"] = DynamoService.Av("ALLOT#") });
                return Ok(items, corsHeaders);
            }
            if (method == "POST" && seg[0] == "allotments")
            {
                if (!admin) return ErrResp(403, "FORBIDDEN", "Admin only", corsHeaders);
                var empId = Str(body, "employeeId");
                var vehId = Str(body, "vehicleId");
                if (string.IsNullOrEmpty(empId) || string.IsNullOrEmpty(vehId))
                    return ErrResp(400, "INVALID_INPUT", "employeeId and vehicleId required", corsHeaders);
                var rawEmp = await EmployeeRaw(empId);
                if (rawEmp == null) return ErrResp(404, "UNKNOWN_EMPLOYEE", $"employee {empId} not found", corsHeaders);
                var vehItem = await Ddb.GetItem(TblFleet, Key($"VEH#{vehId}", "META"));
                if (vehItem == null) return ErrResp(404, "NOT_FOUND", "vehicle not found", corsHeaders);
                var band = BandNum(Str(rawEmp, "employee_band"));
                var levels = await PolicyLevels();
                var def = BandForBand(levels, band);
                var allowed = def != null && def.TryGetValue("allowed_vehicle_types", out var avt) && avt is List<object?> avtList
                    ? avtList.Select(x => x?.ToString() ?? "").ToList()
                    : new List<string>();
                var vehType = Str(vehItem, "type") ?? "";
                if (!allowed.Contains(vehType))
                    return ErrResp(422, "NOT_ELIGIBLE", $"Band {band} ({Str(def, "label") ?? "-"}) is not eligible for a {vehType}",
                        corsHeaders, new { allowed });
                var id = $"al-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
                var it = new Dictionary<string, object?>
                {
                    ["PK"] = $"ALLOT#{empId}", ["SK"] = "META", ["id"] = id,
                    ["employeeId"] = empId, ["vehicleId"] = vehId,
                    ["employee_band"] = band, ["grade"] = Str(def, "id"),
                    ["validTill"] = Str(body, "validTill") ?? "2027-03-31",
                };
                await Ddb.PutItem(TblFleet, it);
                return Ok(it, corsHeaders, 201);
            }

            // ---- fuel logs ----
            if (method == "GET" && seg[0] == "fuel")
            {
                var items = await Ddb.Scan(TblFleet, "begins_with(SK, :f)", null, new() { [":f"] = DynamoService.Av("FUEL#") });
                return Ok(items, corsHeaders);
            }
            if (method == "POST" && seg[0] == "fuel")
            {
                if (!admin) return ErrResp(403, "FORBIDDEN", "Admin only", corsHeaders);
                var date = Now()[..10];
                var id = $"f-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
                var it = new Dictionary<string, object?>
                {
                    ["PK"] = $"VEH#{Str(body, "vehicleId")}", ["SK"] = $"FUEL#{date}#{id}",
                    ["id"] = id, ["vehicleId"] = Str(body, "vehicleId"),
                    ["litres"] = body["litres"]?.ToString(), ["cost"] = body["cost"]?.ToString(),
                    ["date"] = date, ["station"] = Str(body, "station") ?? "Fuel Station Depot",
                };
                await Ddb.PutItem(TblFleet, it);
                return Ok(it, corsHeaders, 201);
            }

            // ---- fuel-team integration ----
            var fuelCaller = admin || apiKeySource == "FUEL";
            if (method == "GET" && seg[0] == "fleet" && seg.Length > 1 && seg[1] == "vehicles")
            {
                if (!fuelCaller) return ErrResp(403, "FORBIDDEN", "FUEL key or admin only", corsHeaders);
                var (vehicles, _) = await ListFleet();
                var out2 = vehicles.Where(v => FuelSpecMap.ContainsKey(Str(v, "type") ?? ""))
                    .Select(v =>
                    {
                        var spec = GetFuelSpec(Str(v, "type") ?? "");
                        var fl = CurrentFuelL(v, spec);
                        return (object)new
                        {
                            vehicle_id = Str(v, "id"), reg = Str(v, "reg"), type = Str(v, "type"), status = Str(v, "status"),
                            tank_capacity_l = spec.TankL, kmpl = spec.Kmpl,
                            fuel_l = fl, fuel_pct = FuelPct(fl, spec), needs_refuel = BoolVal(v, "needs_refuel"),
                        };
                    }).ToList();
                return Ok(out2, corsHeaders);
            }
            if (method == "GET" && seg[0] == "fleet" && seg.Length > 1 && seg[1] == "refuel-requests")
            {
                if (!fuelCaller) return ErrResp(403, "FORBIDDEN", "FUEL key or admin only", corsHeaders);
                var (vehicles2, _) = await ListFleet();
                var fuelLoc = await Ddb.GetItem(TblRef, Key("LOC", "loc-fuel"));
                var out3 = vehicles2.Where(v => BoolVal(v, "needs_refuel")).Select(v =>
                {
                    var spec = GetFuelSpec(Str(v, "type") ?? "");
                    var fl = CurrentFuelL(v, spec);
                    return (object)new
                    {
                        vehicle_id = Str(v, "id"), reg = Str(v, "reg"), type = Str(v, "type"), status = Str(v, "status"),
                        fuel_l = fl, tank_capacity_l = spec.TankL, fuel_pct = FuelPct(fl, spec),
                        station_id = fuelLoc != null ? Str(fuelLoc, "id") : "loc-fuel",
                        station_name = fuelLoc != null ? Str(fuelLoc, "name") : "Fuel Station Depot",
                        location = fuelLoc != null ? new { lat = Dbl(fuelLoc, "lat"), lng = Dbl(fuelLoc, "lng") } : (object?)null,
                        requested_at = Str(v, "updated_at"),
                    };
                }).ToList();
                return Ok(out3, corsHeaders);
            }
            if (method == "POST" && seg[0] == "fleet" && seg.Length > 1 && seg[1] == "refuel")
            {
                if (!fuelCaller) return ErrResp(403, "FORBIDDEN", "FUEL key or admin only", corsHeaders);
                var vehId = Str(body, "vehicle_id");
                var v = await Ddb.GetItem(TblFleet, Key($"VEH#{vehId}", "META"));
                if (v == null) return ErrResp(404, "NOT_FOUND", $"vehicle {vehId} not found", corsHeaders);
                if (!double.TryParse(body["litres_added"]?.ToString(), out var added) || added <= 0)
                    return ErrResp(422, "INVALID", "litres_added must be a positive number", corsHeaders);
                var spec = GetFuelSpec(Str(v, "type") ?? "");
                var fl = Math.Min(spec.TankL, Math.Round(CurrentFuelL(v, spec) + added, 2));
                var pct = (int)Math.Round(fl / spec.TankL * 100);
                await Ddb.UpdateItem(TblFleet, Key($"VEH#{Str(v, "id")}", "META"),
                    "SET fuel_l = :f, tank_capacity_l = :t, kmpl = :k, needs_refuel = :n, fuel = :pct",
                    null, new()
                    {
                        [":f"] = DynamoService.Av(fl), [":t"] = DynamoService.Av(spec.TankL),
                        [":k"] = DynamoService.Av(spec.Kmpl), [":n"] = DynamoService.Av(false), [":pct"] = DynamoService.Av(pct),
                    });
                if (Str(v, "status") == "refueling") await SetVehicleStatus(v, "idle");
                var date = Now()[..10];
                var fuelId = $"f-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
                await Ddb.PutItem(TblFleet, new Dictionary<string, object?>
                {
                    ["PK"] = $"VEH#{Str(v, "id")}", ["SK"] = $"FUEL#{date}#{fuelId}",
                    ["id"] = fuelId, ["vehicleId"] = Str(v, "id"), ["litres"] = added,
                    ["cost"] = body["cost"]?.ToString(), ["date"] = date,
                    ["station"] = Str(body, "station") ?? "Fuel team", ["source"] = "FUEL",
                    ["at"] = Str(body, "at") ?? Now(),
                });
                return Ok(new { vehicle_id = Str(v, "id"), fuel_l = fl, fuel_pct = pct, tank_capacity_l = spec.TankL, needs_refuel = false, status = "idle" }, corsHeaders);
            }

            // ---- fleet ----
            if (method == "GET" && seg[0] == "fleet" && seg.Length == 1)
            {
                var (vv, dd) = await ListFleet();
                return Ok(new { vehicles = vv, drivers = dd }, corsHeaders);
            }
            if (method == "POST" && seg[0] == "fleet" && seg.Length > 2 && seg[2] == "status")
            {
                if (!admin) return ErrResp(403, "FORBIDDEN", "Admin only", corsHeaders);
                var veh = await Ddb.GetItem(TblFleet, Key($"VEH#{seg[1]}", "META"));
                if (veh == null) return ErrResp(404, "NOT_FOUND", "vehicle not found", corsHeaders);
                await SetVehicleStatus(veh, Str(body, "status") ?? "idle");
                return Ok(new { id = seg[1], status = Str(body, "status") }, corsHeaders);
            }

            // ---- shuttle cards ----
            if (method == "GET" && seg[0] == "cards")
            {
                var all = await Ddb.Scan(TblCards);
                var cards = all.Where(i => Str(i, "SK") == "META").Select(c => new Dictionary<string, object?>(c)
                {
                    ["rides"] = all.Where(x => Str(x, "PK") == Str(c, "PK") && (Str(x, "SK") ?? "").StartsWith("RIDE#"))
                        .OrderByDescending(x => Str(x, "SK")).ToList<object?>(),
                }).ToList();
                return Ok(cards, corsHeaders);
            }

            // ---- ops ----
            if (method == "GET" && seg[0] == "ops")
            {
                await SweepDue();
                var (reqs, emgs, bks) = await GetOps();
                if (admin) return Ok(new { requests = reqs, emergencies = emgs, bookings = bks }, corsHeaders);
                var myEmgs = emgs.Where(e => identity != null && Str(e, "requested_by") == identity).ToList();
                return Ok(new { requests = Array.Empty<object>(), bookings = Array.Empty<object>(), emergencies = myEmgs }, corsHeaders);
            }

            // ---- single item status ----
            if (method == "GET" && (seg[0] == "requests" || seg[0] == "emergencies" || seg[0] == "bookings") && seg.Length == 2)
            {
                var item = await GetOpsItem(seg[1]);
                if (item == null) return ErrResp(404, "NOT_FOUND", $"{seg[1]} not found", corsHeaders);
                return Ok(new
                {
                    id = Str(item, "id"), type = Str(item, "entity"), status = Str(item, "status"),
                    severity = Str(item, "severity"), case_type = Str(item, "case_type"),
                    pickup = GetObj(item, "pickup"), drop = GetObj(item, "drop"), drops = GetObj(item, "drops"),
                    hospital_id = Str(item, "hospital_id"),
                    assigned_vehicle_id = Str(item, "assigned_vehicle_id"),
                    assigned_driver_id = Str(item, "assigned_driver_id"),
                    eta_min = Dbl(item, "eta_min"), distance_km = Dbl(item, "distance_km"),
                    created_at = Str(item, "created_at"), updated_at = Str(item, "updated_at"),
                }, corsHeaders);
            }

            // ---- create transport request ----
            if (method == "POST" && seg[0] == "requests" && seg.Length == 1)
            {
                var refData = await LoadRef();
                var pt = ResolvePickup(refData, GetObj(body, "pickup"));
                if (pt == null) return ErrResp(404, "UNKNOWN_LOCATION", "pickup not resolvable", corsHeaders);
                var zoneId = ZonesByProximity(refData, pt).FirstOrDefault()?.Zone?.GetValueOrDefault("id")?.ToString();
                var id = Rid("REQ", 1000);
                var createdAt = Now();
                var rec = new Dictionary<string, object?>
                {
                    ["PK"] = $"REQ#{id}", ["SK"] = "META", ["entity"] = "REQ", ["id"] = id,
                    ["external_ref"] = Str(body, "external_ref"),
                    ["source"] = Str(body, "source") ?? "PORTAL",
                    ["request_type"] = Str(body, "request_type") ?? "TRANSPORT",
                    ["vehicle_type"] = Str(body, "vehicle_type") ?? "car",
                    ["status"] = "NEW", ["priority"] = Str(body, "priority") ?? "normal",
                    ["pickup"] = GetObj(body, "pickup"), ["drops"] = body["drops"]?.ToString() != null ? (object?)body["drops"] : new List<object?>(),
                    ["pickup_zone_id"] = zoneId,
                    ["requested_by"] = Str(body, "requested_by"),
                    ["note"] = Str(body, "note"),
                    ["created_at"] = createdAt, ["updated_at"] = createdAt,
                };
                MergeIndexAttrs(rec, "REQ", "NEW", zoneId, Str(body, "source") ?? "PORTAL", createdAt, null, null);
                await PutOps(rec);
                return Ok(new { id, status = "NEW" }, corsHeaders, 201);
            }

            // ---- request actions ----
            if (method == "POST" && seg[0] == "requests" && seg.Length > 2)
            {
                var item = await GetOpsItem(seg[1]);
                if (item == null) return ErrResp(404, "NOT_FOUND", "request not found", corsHeaders);
                var action = seg[2];
                var ownsItem = identity != null && Str(item, "requested_by") == identity;
                if (new[] { "review", "assign", "dispatch" }.Contains(action) && !admin)
                    return ErrResp(403, "FORBIDDEN", "Admin only", corsHeaders);
                if (new[] { "cancel", "complete" }.Contains(action) && !admin && !ownsItem)
                    return ErrResp(403, "FORBIDDEN", "Not your request", corsHeaders);
                if (action == "review")
                {
                    await PatchOpsStatus(item, "REVIEWED");
                    return Ok(new { id = seg[1], status = "REVIEWED" }, corsHeaders);
                }
                if (action == "assign")
                {
                    await PatchOpsStatus(item, "ASSIGNED");
                    var vehicleId2 = Str(body, "vehicleId") ?? "";
                    var driverId2 = Str(body, "driverId") ?? "";
                    await Ddb.UpdateItem(TblOps, Key(Str(item, "PK")!, "META"),
                        "SET assigned_vehicle_id = :v, assigned_driver_id = :d, GSI5PK = :g5, GSI5SK = :g5s",
                        null, new()
                        {
                            [":v"] = DynamoService.Av(vehicleId2), [":d"] = DynamoService.Av(driverId2),
                            [":g5"] = DynamoService.Av($"VEH#{vehicleId2}"), [":g5s"] = DynamoService.Av(Str(item, "created_at") ?? ""),
                        });
                    if (!string.IsNullOrEmpty(driverId2)) await SetDriverStatus(driverId2, "available", seg[1]);
                    return Ok(new { id = seg[1], status = "ASSIGNED" }, corsHeaders);
                }
                if (action == "dispatch")
                {
                    var (vvv, _) = await ListFleet();
                    var dv = vvv.FirstOrDefault(x => Str(x, "id") == Str(item, "assigned_vehicle_id"));
                    if (dv != null) await SetVehicleStatus(dv, "enroute");
                    var dvr = Str(item, "assigned_driver_id");
                    if (!string.IsNullOrEmpty(dvr)) await SetDriverStatus(dvr, "on-trip", seg[1]);
                    await PatchOpsStatus(item, "EN_ROUTE");
                    await Ddb.UpdateItem(TblOps, Key(Str(item, "PK")!, "META"),
                        "SET eta_complete = :e", null, new() { [":e"] = DynamoService.Av(EtaComplete(6)) });
                    return Ok(new { id = seg[1], status = "EN_ROUTE" }, corsHeaders);
                }
                if (action == "complete" || action == "cancel")
                {
                    var status2 = action == "complete" ? "COMPLETED" : "CANCELLED";
                    var (vvv2, _) = await ListFleet();
                    var dv2 = vvv2.FirstOrDefault(x => Str(x, "id") == Str(item, "assigned_vehicle_id"));
                    if (dv2 != null) await SetVehicleStatus(dv2, "idle");
                    var dvr2 = Str(item, "assigned_driver_id");
                    if (!string.IsNullOrEmpty(dvr2)) await SetDriverStatus(dvr2, "available", null);
                    await PatchOpsStatus(item, status2);
                    return Ok(new { id = seg[1], status = status2 }, corsHeaders);
                }
            }

            // ---- emergency actions ----
            if (method == "POST" && seg[0] == "emergencies" && seg.Length > 2)
            {
                var item = await GetOpsItem(seg[1]);
                if (item == null) return ErrResp(404, "NOT_FOUND", "emergency not found", corsHeaders);
                if (seg[2] == "route")
                {
                    double.TryParse(body["eta_min"]?.ToString(), out var etaMin);
                    double.TryParse(body["distance_km"]?.ToString(), out var distKm);
                    double.TryParse(body["eta_to_pickup_min"]?.ToString(), out var etaPickup);
                    await Ddb.UpdateItem(TblOps, Key(Str(item, "PK")!, "META"),
                        "SET distance_km = :d, eta_min = :e, eta_to_pickup_min = :p, eta_complete = :c, updated_at = :u",
                        null, new()
                        {
                            [":d"] = DynamoService.Av(distKm > 0 ? distKm : Dbl(item, "distance_km")),
                            [":e"] = DynamoService.Av(etaMin),
                            [":p"] = DynamoService.Av(etaPickup > 0 ? etaPickup : Dbl(item, "eta_to_pickup_min")),
                            [":c"] = DynamoService.Av(EtaComplete(etaMin)), [":u"] = DynamoService.Av(Now()),
                        });
                    return Ok(new { id = seg[1], updated = true }, corsHeaders);
                }
                if (seg[2] == "reassign")
                {
                    if (!admin) return ErrResp(403, "FORBIDDEN", "Admin only", corsHeaders);
                    var (vvv, _) = await ListFleet();
                    var newVehId = Str(body, "vehicleId");
                    if (!string.IsNullOrEmpty(newVehId) && newVehId != Str(item, "assigned_vehicle_id"))
                    {
                        var newV = vvv.FirstOrDefault(x => Str(x, "id") == newVehId);
                        if (newV == null) return ErrResp(404, "NOT_FOUND", "replacement vehicle not found", corsHeaders);
                        var oldV = vvv.FirstOrDefault(x => Str(x, "id") == Str(item, "assigned_vehicle_id"));
                        if (oldV != null) await SetVehicleStatus(oldV, "idle");
                        var oldDrv = Str(item, "assigned_driver_id");
                        if (!string.IsNullOrEmpty(oldDrv)) await SetDriverStatus(oldDrv, "available", null);
                        await SetVehicleStatus(newV, "enroute");
                        var newDrv = Str(newV, "driver_id");
                        if (!string.IsNullOrEmpty(newDrv)) await SetDriverStatus(newDrv, "on-trip", seg[1]);
                        await Ddb.UpdateItem(TblOps, Key(Str(item, "PK")!, "META"),
                            "SET assigned_vehicle_id = :v, assigned_driver_id = :d, GSI5PK = :g5, GSI5SK = :g5s, updated_at = :u",
                            null, new()
                            {
                                [":v"] = DynamoService.Av(Str(newV, "id")), [":d"] = DynamoService.Av(newDrv),
                                [":g5"] = DynamoService.Av($"VEH#{Str(newV, "id")}"),
                                [":g5s"] = DynamoService.Av(Str(item, "created_at") ?? ""), [":u"] = DynamoService.Av(Now()),
                            });
                    }
                    var newHospId = Str(body, "hospitalId");
                    if (!string.IsNullOrEmpty(newHospId) && newHospId != Str(item, "hospital_id"))
                    {
                        await Ddb.UpdateItem(TblOps, Key(Str(item, "PK")!, "META"),
                            "SET hospital_id = :h, updated_at = :u", null,
                            new() { [":h"] = DynamoService.Av(newHospId), [":u"] = DynamoService.Av(Now()) });
                    }
                    await Ddb.PutItem(TblOps, new Dictionary<string, object?>
                    {
                        ["PK"] = Str(item, "PK"), ["SK"] = $"EVT#{Now()}",
                        ["type"] = "REASSIGNED", ["vehicleId"] = Str(body, "vehicleId"), ["hospitalId"] = Str(body, "hospitalId"),
                    });
                    return Ok(new { id = seg[1], reassigned = true }, corsHeaders);
                }
                return ErrResp(404, "NO_ROUTE", $"No emergency action {seg[2]}", corsHeaders);
            }

            // ---- emergency create ----
            if (method == "POST" && seg[0] == "emergencies" && seg.Length == 1)
            {
                var vErr = ValidateEmergency(body);
                if (vErr != null) return ErrResp(400, "INVALID_INPUT", vErr, corsHeaders);
                await SweepDue();
                var refData = await LoadRef();
                var pickupObj = GetObj(body, "pickup");
                if (ResolvePickup(refData, pickupObj) == null) return ErrResp(404, "UNKNOWN_LOCATION", "pickup not resolvable", corsHeaders);
                var caseType = Str(body, "case_type") ?? Str(body, "caseType");
                var ctLower = (caseType ?? "").ToLowerInvariant();
                var kind = ctLower == "fire" ? "fire" : ctLower == "blood" ? "blood" :
                    (Str(body, "kind") is { } k2 && new[] { "medical", "fire", "blood" }.Contains(k2) ? k2 : "medical");
                int.TryParse(body["patients"]?.ToString(), out var patientsRaw);
                var patients = Math.Max(1, patientsRaw);
                var per = (int)GetPolicyDouble("patients_per_ambulance", 4);
                var cap = (int)GetPolicyDouble("max_units", 10);
                var massT = (int)GetPolicyDouble("mass_patient_threshold", 3);
                int units;
                if (kind == "fire") units = 1;
                else if (int.TryParse(body["units"]?.ToString(), out var uRaw) && uRaw > 1) units = Math.Min(cap, uRaw);
                else units = patients > massT ? Math.Min(cap, Math.Max(2, (int)Math.Ceiling((double)patients / per))) : 1;
                var incidentId = units > 1 ? Rid("INC", 100) : null;
                var records = new List<Dictionary<string, object?>>();
                for (var i = 0; i < units; i++)
                {
                    refData = await LoadRef();
                    var rec2 = await BuildEmergency(refData, new Dictionary<string, object?>
                    {
                        ["id"] = Rid("EMG", 100), ["kind"] = kind, ["case_type"] = caseType,
                        ["severity"] = Str(body, "severity"), ["pickup"] = pickupObj,
                        ["blood_bank_id"] = Str(body, "blood_bank_id"),
                        ["requested_by"] = Str(body, "requested_by"), ["source"] = Str(body, "source"),
                        ["incident_id"] = incidentId, ["patients_count"] = patients,
                        ["note"] = Str(body, "note"), ["contact"] = Str(body, "contact"),
                        ["created_at"] = Now(),
                    });
                    await PutOps(rec2);
                    records.Add(rec2);
                }
                string? HospName(string? id) => id != null ? Str(refData.Hospitals.FirstOrDefault(h => Str(h, "id") == id), "name") : null;
                string? BankName(string? id) => id != null ? Str(refData.Locations.FirstOrDefault(l => Str(l, "id") == id), "name") : null;
                object RespItem(Dictionary<string, object?> r) => new
                {
                    id = Str(r, "id"), status = Str(r, "status"),
                    assigned_vehicle_id = Str(r, "assigned_vehicle_id"),
                    hospital_id = Str(r, "hospital_id"), hospital = HospName(Str(r, "hospital_id")),
                    blood_bank_id = Str(r, "blood_bank_id"), blood_bank = BankName(Str(r, "blood_bank_id")),
                    eta_to_pickup_min = Dbl(r, "eta_to_pickup_min"), eta_min = Dbl(r, "eta_min"),
                    distance_km = Dbl(r, "distance_km"), traffic_factor = Dbl(r, "traffic_factor") is 0 ? 1 : Dbl(r, "traffic_factor"),
                    tracking_url = TrackUrl(r),
                    reason = Str(r, "status") == "QUEUED" ? (kind == "fire" ? "No fire truck available" : "No ambulance available")
                        : Str(r, "status") == "NO_HOSPITAL" ? $"No facility with {Str(r, "case_type")} + capacity"
                        : Str(r, "status") == "NO_BLOODBANK" ? "No blood bank configured" : null,
                };
                if (units == 1) return Ok(RespItem(records[0]), corsHeaders, 201);
                return Ok(new
                {
                    incident_id = incidentId, units,
                    dispatched = records.Count(r => Str(r, "status") == "EN_ROUTE"),
                    results = records.Select(RespItem).ToList(),
                }, corsHeaders, 201);
            }

            // ---- shuttle booking ----
            if (method == "POST" && seg[0] == "bookings")
            {
                await SweepDue();
                var refData = await LoadRef();
                var cardId = Str(body, "card_id");
                var card = await Ddb.GetItem(TblCards, Key($"CARD#{cardId}", "META"));
                if (card == null) return ErrResp(404, "NOT_FOUND", "card not found", corsHeaders);
                var levels = await PolicyLevels();
                var cardGrade = Str(card, "grade");
                int.TryParse(card.GetValueOrDefault("employee_band")?.ToString(), out var empBand);
                var band = levels.FirstOrDefault(b => Str(b, "id") == cardGrade) ?? BandForBand(levels, empBand);
                int.TryParse(band?.GetValueOrDefault("shuttle_rides")?.ToString(), out var shuttleCap);
                var month = Now()[..7];
                var pickupObj2 = GetObj(body, "pickup");
                var pt = ResolvePickup(refData, pickupObj2);
                if (pt == null) return ErrResp(404, "UNKNOWN_LOCATION", "pickup not resolvable", corsHeaders);
                var found = await FindNearestVehicle(refData, pt, "bus");
                if (found == null) return ErrResp(422, "NO_RESOURCE", "No shuttle available in any zone", corsHeaders);
                var dropObj = GetObj(body, "drop");
                var dropId = Str(dropObj, "ref") != null ? refData.Locations.FirstOrDefault(l => Str(l, "id") == Str(dropObj, "ref")) : null;
                var dropPt = dropId != null ? new GeoPoint(Dbl(dropId, "lat"), Dbl(dropId, "lng")) :
                    (dropObj != null && dropObj.ContainsKey("lat") ? new GeoPoint(Dbl(dropObj, "lat"), Dbl(dropObj, "lng")) : null);
                var distKm = dropPt != null ? HavKm(pt, dropPt) : 0;
                var fare = (int)Math.Round(distKm * 12);
                var bkId = Rid("BK", 1000);
                // Atomic cap check + increment
                try
                {
                    await Ddb.UpdateItem(TblCards, Key($"CARD#{cardId}", "META"),
                        "SET used_this_month = if_not_exists(used_this_month, :z) + :one, #m = :mo",
                        new() { ["#m"] = "month" },
                        new()
                        {
                            [":one"] = DynamoService.Av(1), [":z"] = DynamoService.Av(0),
                            [":cap"] = DynamoService.Av(shuttleCap), [":mo"] = DynamoService.Av(month),
                        },
                        conditionExpr: "(attribute_not_exists(used_this_month) OR used_this_month < :cap)");
                }
                catch (Amazon.DynamoDBv2.Model.ConditionalCheckFailedException)
                {
                    return ErrResp(422, "CAP_EXHAUSTED", $"Monthly shuttle entitlement exhausted (cap {shuttleCap})", corsHeaders);
                }
                var createdAt2 = Now();
                await Ddb.PutItem(TblCards, new Dictionary<string, object?>
                {
                    ["PK"] = $"CARD#{cardId}", ["SK"] = $"RIDE#{createdAt2[..10]}#{bkId}",
                    ["id"] = bkId, ["memberId"] = Str(body, "member_id"),
                    ["from"] = Str(pickupObj2, "ref"), ["to"] = Str(dropObj, "ref"),
                    ["date"] = createdAt2[..10], ["fare"] = fare,
                });
                var etaMin2 = Math.Round(distKm / 28.0 * 60);
                var bkRec = new Dictionary<string, object?>
                {
                    ["PK"] = $"BK#{bkId}", ["SK"] = "META", ["entity"] = "BK", ["id"] = bkId,
                    ["status"] = "EN_ROUTE", ["card_id"] = cardId, ["member_id"] = Str(body, "member_id"),
                    ["pickup"] = pickupObj2, ["drop"] = dropObj,
                    ["pickup_zone_id"] = Str(found.Zone, "id"),
                    ["assigned_vehicle_id"] = Str(found.Vehicle, "id"),
                    ["assigned_driver_id"] = Str(found.Vehicle, "driver_id"),
                    ["fare"] = fare, ["distance_km"] = Math.Round(distKm, 1),
                    ["eta_complete"] = EtaComplete(etaMin2), ["source"] = "HR",
                    ["created_at"] = createdAt2, ["updated_at"] = createdAt2,
                };
                MergeIndexAttrs(bkRec, "BK", "EN_ROUTE", Str(found.Zone, "id") ?? "", "HR", createdAt2, null, Str(found.Vehicle, "id"));
                await PutOps(bkRec);
                await SetVehicleStatus(found.Vehicle, "enroute");
                var bkDrv = Str(found.Vehicle, "driver_id");
                if (!string.IsNullOrEmpty(bkDrv)) await SetDriverStatus(bkDrv, "on-trip", bkId);
                return Ok(new { id = bkId, status = "EN_ROUTE", zone = Str(found.Zone, "name"), fare, etaMin = (int)etaMin2 }, corsHeaders, 201);
            }

            // ---- bookings list ----
            if (method == "GET" && seg[0] == "bookings")
            {
                var all = await Ddb.Scan(TblOps, "SK = :m AND entity = :e",
                    null, new() { [":m"] = DynamoService.Av("META"), [":e"] = DynamoService.Av("BK") });
                return Ok(all, corsHeaders);
            }

            // ---- infra metrics ----
            if (method == "GET" && seg[0] == "infra" && seg.Length > 1 && seg[1] == "metrics")
            {
                if (!admin && apiKeySource != "MCP") return ErrResp(403, "FORBIDDEN", "Admin or MCP key required", corsHeaders);
                int.TryParse(QS(request, "range_min"), out var rangeMin);
                int.TryParse(QS(request, "period_min"), out var periodMin);
                if (rangeMin <= 0) rangeMin = 1440;
                if (periodMin <= 0) periodMin = 60;
                try
                {
                    var metrics = await Cwsvc.GetMetrics(FnName, rangeMin, periodMin);

                    // Everything below is additive and best-effort: if X-Ray tracing or the
                    // extra IAM permissions haven't been enabled yet (see
                    // infra/enable-observability.sh), these fall back to empty/zero rather
                    // than breaking the primary metrics that already work today.
                    async Task<object?> Safe(Func<Task<object?>> f) { try { return await f(); } catch { return null; } }

                    var voiceMetricsTask  = Safe(async () => { var m = await Cwsvc.GetMetrics(VoiceFnName, rangeMin, periodMin); return (object?)m; });
                    var opsTableTask      = Safe(async () => (object?)await Cwsvc.GetDynamoMetrics(TblOps, rangeMin, periodMin));
                    var fleetTableTask    = Safe(async () => (object?)await Cwsvc.GetDynamoMetrics(TblFleet, rangeMin, periodMin));
                    var bedrockTask       = Safe(async () => (object?)await Cwsvc.GetBedrockMetrics(BedrockModelId, rangeMin, periodMin));
                    var traceTask         = Safe(async () => (object?)await Cwsvc.GetTraceBreakdown(rangeMin));
                    var costTransportTask = Safe(async () => (object?)await Cwsvc.GetLambdaCostEstimate(FnName, metrics.Invocations, metrics.DurationAvgMs, rangeMin));

                    await Task.WhenAll(voiceMetricsTask, opsTableTask, fleetTableTask, bedrockTask, traceTask, costTransportTask);

                    var voiceMetrics = (InfraMetrics?)await voiceMetricsTask;
                    var opsTable = (DynamoTableMetrics?)await opsTableTask;
                    var fleetTable = (DynamoTableMetrics?)await fleetTableTask;
                    var bedrock = (BedrockMetrics?)await bedrockTask;
                    var trace = (List<TraceSegment>?)await traceTask;
                    var costTransport = (LambdaCostEstimate?)await costTransportTask;
                    LambdaCostEstimate? costVoice = null;
                    if (voiceMetrics != null)
                    {
                        try { costVoice = await Cwsvc.GetLambdaCostEstimate(VoiceFnName, voiceMetrics.Invocations, voiceMetrics.DurationAvgMs, rangeMin); } catch { }
                    }

                    object? Fn(InfraMetrics? m) => m == null ? null : new
                    {
                        function_name = m.FunctionName,
                        invocations = m.Invocations, errors = m.Errors, error_rate_pct = m.ErrorRatePct,
                        throttles = m.Throttles, duration_avg_ms = m.DurationAvgMs, duration_p99_ms = m.DurationP99Ms,
                        cold_starts = m.ColdStarts, max_concurrent = m.MaxConcurrent,
                        recent_errors = m.RecentErrors.Select(e => new { timestamp = e.Timestamp, message = e.Message }).ToList(),
                    };

                    var bedrockCostPerMonth = bedrock == null || rangeMin <= 0 ? (double?)null
                        : Math.Round(((bedrock.InputTokens / 1000.0 * 0.00006) + (bedrock.OutputTokens / 1000.0 * 0.00024)) * (43800.0 / rangeMin), 2);
                    var totalCost = (costTransport?.EstMonthlyUsd ?? 0) + (costVoice?.EstMonthlyUsd ?? 0) + (bedrockCostPerMonth ?? 0);

                    return Ok(new
                    {
                        function_name = metrics.FunctionName,
                        range_min = metrics.RangeMin, period_min = metrics.PeriodMin,
                        invocations = metrics.Invocations, errors = metrics.Errors,
                        error_rate_pct = metrics.ErrorRatePct, throttles = metrics.Throttles,
                        duration_avg_ms = metrics.DurationAvgMs, duration_p99_ms = metrics.DurationP99Ms,
                        cold_starts = metrics.ColdStarts, max_concurrent = metrics.MaxConcurrent,
                        series = new
                        {
                            invocations = metrics.Series.Invocations.Select(s => new { t = s.T, v = s.V }).ToList(),
                            errors = metrics.Series.Errors.Select(s => new { t = s.T, v = s.V }).ToList(),
                            duration_avg = metrics.Series.DurationAvg.Select(s => new { t = s.T, v = s.V }).ToList(),
                        },
                        recent_errors = metrics.RecentErrors.Select(e => new { timestamp = e.Timestamp, message = e.Message }).ToList(),
                        generated_at = metrics.GeneratedAt,

                        // ── additive fields (all optional/best-effort) ──
                        functions = new[] { Fn(voiceMetrics) }.Where(f => f != null).ToList(),
                        dynamodb = new[]
                        {
                            opsTable == null ? null : new { table = opsTable.TableName, consumed_rcu = opsTable.ConsumedReadUnits, consumed_wcu = opsTable.ConsumedWriteUnits, read_throttles = opsTable.ReadThrottles, write_throttles = opsTable.WriteThrottles },
                            fleetTable == null ? null : new { table = fleetTable.TableName, consumed_rcu = fleetTable.ConsumedReadUnits, consumed_wcu = fleetTable.ConsumedWriteUnits, read_throttles = fleetTable.ReadThrottles, write_throttles = fleetTable.WriteThrottles },
                        }.Where(t => t != null).ToList(),
                        bedrock = bedrock == null ? null : new
                        {
                            model_id = bedrock.ModelId, invocations = bedrock.Invocations,
                            input_tokens = bedrock.InputTokens, output_tokens = bedrock.OutputTokens,
                            avg_latency_ms = bedrock.AvgLatencyMs, client_errors = bedrock.ClientErrors,
                            est_monthly_usd = bedrockCostPerMonth,
                        },
                        trace_breakdown = trace?.Select(t => new { service = t.Service, avg_ms = t.AvgMs, samples = t.SampleCount }).ToList(),
                        cost_estimate = new
                        {
                            note = "Approximate, list pricing extrapolated from the sampled window — not a substitute for Cost Explorer.",
                            lambdas = new[]
                            {
                                costTransport == null ? null : new { function_name = costTransport.FunctionName, memory_mb = costTransport.MemoryMb, est_monthly_usd = costTransport.EstMonthlyUsd },
                                costVoice == null ? null : new { function_name = costVoice.FunctionName, memory_mb = costVoice.MemoryMb, est_monthly_usd = costVoice.EstMonthlyUsd },
                            }.Where(c => c != null).ToList(),
                            bedrock_est_monthly_usd = bedrockCostPerMonth,
                            total_est_monthly_usd = Math.Round(totalCost, 2),
                        },
                    }, corsHeaders);
                }
                catch (Exception ex) { return ErrResp(500, "CW_ERROR", ex.Message, corsHeaders); }
            }

            return ErrResp(404, "NO_ROUTE", $"No handler for {method} {rawPath}", corsHeaders);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ERR {ex.GetType().Name} {ex.Message}");
            return ErrResp(500, "INTERNAL", "Internal error", corsHeaders);
        }
    }

    // =====================================================================
    // Reference data
    // =====================================================================
    private record RefData(
        List<Dictionary<string, object?>> Locations,
        List<Dictionary<string, object?>> Zones,
        List<Dictionary<string, object?>> Hospitals,
        List<Dictionary<string, object?>> FireStations);

    private async Task<RefData> LoadRef()
    {
        if (_ref != null) return _ref;
        var (loc, zone, hosp, fire) = await (
            Ddb.Query(TblRef, "PK = :p", new() { [":p"] = DynamoService.Av("LOC") }),
            Ddb.Query(TblRef, "PK = :p", new() { [":p"] = DynamoService.Av("ZONE") }),
            Ddb.Query(TblRef, "PK = :p", new() { [":p"] = DynamoService.Av("HOSP") }),
            Ddb.Query(TblRef, "PK = :p", new() { [":p"] = DynamoService.Av("FIRE") })
        ).Collect();
        var locations = loc.Select(l =>
        {
            if (!l.ContainsKey("id") && l.TryGetValue("SK", out var sk)) l["id"] = sk?.ToString() ?? l.GetValueOrDefault("location_id");
            return l;
        }).ToList();
        _ref = new RefData(locations, zone, hosp, fire);
        return _ref;
    }

    private static async Task<Dictionary<string, object?>> GetPolicyItem()
    {
        var r = await Ddb.Query(TblRef, "PK = :p", new() { [":p"] = DynamoService.Av("POLICY") },
            scanForward: false, limit: 1);
        return r.FirstOrDefault() ?? new();
    }

    private static async Task<List<Dictionary<string, object?>>> PolicyLevels()
    {
        var p = await GetPolicyItem();
        if (p.TryGetValue("levels", out var lv) && lv is List<object?> ll)
            return ll.OfType<Dictionary<string, object?>>().ToList();
        return [];
    }

    // =====================================================================
    // Geo helpers
    // =====================================================================
    private const double R = 6371;
    private static double HavKm(GeoPoint a, GeoPoint b)
    {
        var dLat = (b.Lat - a.Lat) * Math.PI / 180;
        var dLng = (b.Lng - a.Lng) * Math.PI / 180;
        var la1 = a.Lat * Math.PI / 180;
        var la2 = b.Lat * Math.PI / 180;
        var x = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(la1) * Math.Cos(la2) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(x), Math.Sqrt(1 - x));
    }

    private record ZoneWithDist(Dictionary<string, object?> Zone, double D);
    private static List<ZoneWithDist> ZonesByProximity(RefData refData, GeoPoint? p)
    {
        if (p == null) return [];
        return refData.Zones.Select(z => new ZoneWithDist(z, HavKm(p, new GeoPoint(Dbl(z, "lat"), Dbl(z, "lng")))))
            .OrderBy(zd => zd.D).ToList();
    }

    private static GeoPoint? ResolvePickup(RefData refData, Dictionary<string, object?>? pickup)
    {
        if (pickup == null) return null;
        var pickupRef = Str(pickup, "ref");
        if (!string.IsNullOrEmpty(pickupRef))
        {
            var loc = refData.Locations.FirstOrDefault(l => Str(l, "id") == pickupRef);
            return loc != null ? new GeoPoint(Dbl(loc, "lat"), Dbl(loc, "lng")) : null;
        }
        if (pickup.TryGetValue("lat", out var latV) && double.TryParse(latV?.ToString(), out var lat) &&
            pickup.TryGetValue("lng", out var lngV) && double.TryParse(lngV?.ToString(), out var lng))
            return new GeoPoint(lat, lng);
        return null;
    }

    // =====================================================================
    // Fleet helpers
    // =====================================================================
    private async Task<(List<Dictionary<string, object?>> Vehicles, List<Dictionary<string, object?>> Drivers)> ListFleet()
    {
        var items = await Ddb.Scan(TblFleet, "SK = :m", null, new() { [":m"] = DynamoService.Av("META") });
        return (
            items.Where(i => (Str(i, "PK") ?? "").StartsWith("VEH#")).ToList(),
            items.Where(i => (Str(i, "PK") ?? "").StartsWith("DRV#")).ToList()
        );
    }

    private async Task SetVehicleStatus(Dictionary<string, object?> vehicle, string status)
    {
        var id = Str(vehicle, "id") ?? "";
        var type = Str(vehicle, "type") ?? "";
        await Ddb.UpdateItem(TblFleet, Key($"VEH#{id}", "META"),
            "SET #s = :s, GSI1SK = :g1, GSI3PK = :g3",
            new() { ["#s"] = "status" },
            new()
            {
                [":s"] = DynamoService.Av(status),
                [":g1"] = DynamoService.Av($"{status}#{type}#{id}"),
                [":g3"] = DynamoService.Av($"VEHSTATUS#{status}"),
            });
    }

    private async Task SetDriverStatus(string driverId, string status, string? assignment)
    {
        await Ddb.UpdateItem(TblFleet, Key($"DRV#{driverId}", "META"),
            "SET #s = :s, GSI2SK = :g2, assignment = :a",
            new() { ["#s"] = "status" },
            new()
            {
                [":s"] = DynamoService.Av(status),
                [":g2"] = DynamoService.Av($"{status}#{driverId}"),
                [":a"] = DynamoService.Av(assignment),
            });
    }

    private record NearestVehicleResult(Dictionary<string, object?> Vehicle, Dictionary<string, object?> Zone, double Km);

    private async Task<NearestVehicleResult?> FindNearestVehicle(RefData refData, GeoPoint? pickupPt, string type)
    {
        if (pickupPt == null) return null;
        foreach (var zd in ZonesByProximity(refData, pickupPt))
        {
            var zoneId = Str(zd.Zone, "id") ?? "";
            var r = await Ddb.Query(TblFleet,
                "GSI1PK = :p AND begins_with(GSI1SK, :s)",
                new() { [":p"] = DynamoService.Av($"ZONE#{zoneId}#VEH"), [":s"] = DynamoService.Av($"idle#{type}#") },
                indexName: "GSI1-zoneveh", limit: 1);
            var v = r.FirstOrDefault();
            if (v != null) return new NearestVehicleResult(v, zd.Zone, zd.D);
        }
        return null;
    }

    // =====================================================================
    // Ops helpers
    // =====================================================================
    private async Task<(List<Dictionary<string, object?>> Requests, List<Dictionary<string, object?>> Emergencies, List<Dictionary<string, object?>> Bookings)> GetOps()
    {
        var items = await Ddb.Scan(TblOps, "SK = :m", null, new() { [":m"] = DynamoService.Av("META") });
        return (
            items.Where(i => Str(i, "entity") == "REQ").ToList(),
            items.Where(i => Str(i, "entity") == "EMG").ToList(),
            items.Where(i => Str(i, "entity") == "BK").ToList()
        );
    }

    private static void MergeIndexAttrs(Dictionary<string, object?> d, string entity, string status, string? zoneId, string source, string createdAt, int? sevRank, string? vehicleId)
    {
        d["GSI2PK"] = $"{entity}#STATUS#{status}";
        d["GSI2SK"] = sevRank.HasValue ? $"{sevRank}#{createdAt}" : createdAt;
        d["GSI3PK"] = $"ZONE#{zoneId}";
        d["GSI3SK"] = createdAt;
        d["GSI4PK"] = $"SRC#{source}";
        d["GSI4SK"] = createdAt;
        if (!string.IsNullOrEmpty(vehicleId))
        {
            d["GSI5PK"] = $"VEH#{vehicleId}";
            d["GSI5SK"] = createdAt;
        }
    }

    private async Task PutOps(Dictionary<string, object?> rec) => await Ddb.PutItem(TblOps, rec);

    private async Task<Dictionary<string, object?>?> GetOpsItem(string id)
    {
        var prefix = id.StartsWith("EMG") ? "EMG#" : id.StartsWith("BK") ? "BK#" : "REQ#";
        return await Ddb.GetItem(TblOps, Key($"{prefix}{id}", "META"));
    }

    private async Task PatchOpsStatus(Dictionary<string, object?> item, string status, Dictionary<string, object?>? extra = null)
    {
        var entity = Str(item, "entity") ?? "REQ";
        var sev = Str(item, "severity");
        int? sevRank = entity == "EMG" ? sev switch { "Critical" => 0, "Urgent" => 1, _ => 2 } : null;
        var createdAt = Str(item, "created_at") ?? "";
        await Ddb.UpdateItem(TblOps, Key(Str(item, "PK")!, "META"),
            "SET #s = :s, GSI2PK = :g2p, GSI2SK = :g2s, updated_at = :u",
            new() { ["#s"] = "status" },
            new()
            {
                [":s"] = DynamoService.Av(status),
                [":g2p"] = DynamoService.Av($"{entity}#STATUS#{status}"),
                [":g2s"] = DynamoService.Av(sevRank.HasValue ? $"{sevRank}#{createdAt}" : createdAt),
                [":u"] = DynamoService.Av(Now()),
            });
        var auditRow = new Dictionary<string, object?> { ["PK"] = Str(item, "PK"), ["SK"] = $"EVT#{Now()}", ["type"] = status };
        if (extra != null) foreach (var kv in extra) auditRow[kv.Key] = kv.Value;
        await Ddb.PutItem(TblOps, auditRow);
    }

    private async Task CompleteOp(Dictionary<string, object?> item)
    {
        var vehId = Str(item, "assigned_vehicle_id");
        if (!string.IsNullOrEmpty(vehId))
        {
            var v = await Ddb.GetItem(TblFleet, Key($"VEH#{vehId}", "META"));
            if (v != null)
            {
                double.TryParse(item.GetValueOrDefault("distance_km")?.ToString(), out var distKm);
                var drained = await DrainFuel(v, distKm);
                await SetVehicleStatus(v, drained.NeedsRefuel ? "refueling" : "idle");
            }
        }
        var drvId = Str(item, "assigned_driver_id");
        if (!string.IsNullOrEmpty(drvId)) await SetDriverStatus(drvId, "available", null);
        await PatchOpsStatus(item, "COMPLETED");
    }

    private async Task SweepDue()
    {
        var items = await Ddb.Scan(TblOps, "SK = :m AND #s = :en",
            new() { ["#s"] = "status" }, new() { [":m"] = DynamoService.Av("META"), [":en"] = DynamoService.Av("EN_ROUTE") });
        var nowSec = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        foreach (var it in items)
        {
            long.TryParse(it.GetValueOrDefault("eta_complete")?.ToString(), out var etaComplete);
            var createdAt = Str(it, "created_at");
            var due = (etaComplete > 0 && etaComplete <= nowSec)
                || (etaComplete == 0 && createdAt != null && DateTimeOffset.TryParse(createdAt, out var cAt) && DateTimeOffset.UtcNow - cAt > TimeSpan.FromMinutes(10));
            if (due) try { await CompleteOp(it); } catch { }
        }
        try { await TryDispatchQueued(); } catch { }
    }

    private async Task TryDispatchQueued()
    {
        var items = await Ddb.Scan(TblOps,
            "SK = :m AND entity = :e AND (#s = :q OR #s = :n)",
            new() { ["#s"] = "status" },
            new() { [":m"] = DynamoService.Av("META"), [":e"] = DynamoService.Av("EMG"), [":q"] = DynamoService.Av("QUEUED"), [":n"] = DynamoService.Av("NO_HOSPITAL") });
        var sorted = items.OrderBy(a => Str(a, "GSI2SK")?.ToString() ?? "").Take(10);
        foreach (var it in sorted)
        {
            var refData = await LoadRef();
            var rec = await BuildEmergency(refData, it);
            if (Str(rec, "status") == "EN_ROUTE") await PutOps(rec);
        }
    }

    // =====================================================================
    // Fuel model
    // =====================================================================
    private static FuelSpec GetFuelSpec(string type) => FuelSpecMap.TryGetValue(type, out var s) ? s : new FuelSpec(60, 9);
    private static double CurrentFuelL(Dictionary<string, object?> v, FuelSpec spec)
    {
        if (double.TryParse(v.GetValueOrDefault("fuel_l")?.ToString(), out var fl)) return fl;
        if (double.TryParse(v.GetValueOrDefault("fuel")?.ToString(), out var pct)) return Math.Round(spec.TankL * Math.Min(100, Math.Max(0, pct)) / 100, 1);
        return spec.TankL;
    }
    private static int FuelPct(double fl, FuelSpec spec) => (int)Math.Round(fl / spec.TankL * 100);

    private record DrainResult(double FuelL, bool NeedsRefuel, double TankL);
    private async Task<DrainResult> DrainFuel(Dictionary<string, object?> v, double km)
    {
        var spec = GetFuelSpec(Str(v, "type") ?? "");
        var used = km > 0 ? km / spec.Kmpl : 0;
        var fuelL = Math.Max(0, Math.Round(CurrentFuelL(v, spec) - used, 2));
        var needsRefuel = fuelL <= spec.TankL * RefuelPct;
        var pct = (int)Math.Round(fuelL / spec.TankL * 100);
        await Ddb.UpdateItem(TblFleet, Key($"VEH#{Str(v, "id")}", "META"),
            "SET fuel_l = :f, tank_capacity_l = :t, kmpl = :k, needs_refuel = :n, fuel = :pct",
            null, new()
            {
                [":f"] = DynamoService.Av(fuelL), [":t"] = DynamoService.Av(spec.TankL),
                [":k"] = DynamoService.Av(spec.Kmpl), [":n"] = DynamoService.Av(needsRefuel), [":pct"] = DynamoService.Av(pct),
            });
        return new DrainResult(fuelL, needsRefuel, spec.TankL);
    }

    // =====================================================================
    // Emergency dispatch core
    // =====================================================================
    private record RouteEtaResult(double DistanceKm, double EtaToPickupMin, double EtaMin, double TrafficFactor);

    private async Task<RouteEtaResult> ComputeRouteEta(List<GeoPoint> points, double fallbackPickupKm, double fallbackTotalKm)
    {
        var f = TrafficService.Multiplier(GetPolicyDouble("traffic_factor", 0) is 0 ? null : GetPolicyDouble("traffic_factor", 0));
        var r = await OsrmService.Route(points);
        if (r != null)
        {
            var pickupMin = (r.Legs.Count > 0 ? r.Legs[0].Min : r.FreeMin) * f;
            return new RouteEtaResult(Math.Round(r.Km, 1), Math.Round(pickupMin, 1), Math.Round(r.FreeMin * f, 1), f);
        }
        return new RouteEtaResult(
            Math.Round(fallbackTotalKm, 1),
            Math.Round(fallbackPickupKm / SpeedKmh * 60 * f, 1),
            Math.Round(fallbackTotalKm / SpeedKmh * 60 * f, 1),
            f);
    }

    private async Task<Dictionary<string, object?>> BuildEmergency(RefData refData, Dictionary<string, object?> item)
    {
        var createdAt = Str(item, "created_at") ?? Now();
        var severity = Str(item, "severity") ?? "Urgent";
        var sevR = severity switch { "Critical" => 0, "Urgent" => 1, _ => 2 };
        var pickupObj = GetObj(item, "pickup");
        var pt = ResolvePickup(refData, pickupObj);
        var zoneId = ZonesByProximity(refData, pt).FirstOrDefault()?.Zone.GetValueOrDefault("id")?.ToString();
        var id = Str(item, "id") ?? Rid("EMG", 100);
        var kind = Str(item, "kind") ?? "medical";
        var trackToken = Str(item, "track_token") ?? Guid.NewGuid().ToString("N");
        int.TryParse(item.GetValueOrDefault("patients_count")?.ToString(), out var patientsCount);
        if (patientsCount < 1) patientsCount = 1;
        var source = Str(item, "source") ?? "CONSOLE";

        var baseRec = new Dictionary<string, object?>
        {
            ["PK"] = $"EMG#{id}", ["SK"] = "META", ["entity"] = "EMG", ["id"] = id,
            ["kind"] = kind, ["severity"] = severity,
            ["pickup"] = pickupObj != null && Str(pickupObj, "name") == null && pt != null
                ? new Dictionary<string, object?>(pickupObj) { ["name"] = $"{pt.Lat:F4}, {pt.Lng:F4}" }
                : pickupObj,
            ["pickup_zone_id"] = zoneId,
            ["requested_by"] = Str(item, "requested_by"), ["source"] = source,
            ["incident_id"] = Str(item, "incident_id"), ["patients_count"] = patientsCount,
            ["note"] = Str(item, "note"), ["contact"] = Str(item, "contact"),
            ["track_token"] = trackToken, ["created_at"] = createdAt, ["updated_at"] = Now(),
        };

        if (kind == "fire")
        {
            var truck = await FindNearestVehicle(refData, pt, "firetruck");
            if (truck == null)
            {
                MergeIndexAttrs(baseRec, "EMG", "QUEUED", zoneId, source, createdAt, sevR, null);
                baseRec["case_type"] = "Fire";
                baseRec["status"] = "QUEUED";
                return baseRec;
            }
            var station = refData.FireStations.FirstOrDefault(f => Str(f, "zone_id") == Str(truck.Zone, "id"))
                ?? refData.FireStations
                    .Select(f => (f, d: HavKm(pt!, new GeoPoint(Dbl(f, "lat"), Dbl(f, "lng")))))
                    .OrderBy(x => x.d).FirstOrDefault().f;
            var origin = station != null
                ? new GeoPoint(Dbl(station, "lat"), Dbl(station, "lng"))
                : new GeoPoint(Dbl(truck.Zone, "lat"), Dbl(truck.Zone, "lng"));
            var eta = await ComputeRouteEta([origin, pt!], truck.Km, truck.Km);
            await SetVehicleStatus(truck.Vehicle, "enroute");
            var trDrv = Str(truck.Vehicle, "driver_id");
            if (!string.IsNullOrEmpty(trDrv)) await SetDriverStatus(trDrv, "on-trip", id);
            baseRec["case_type"] = "Fire";
            baseRec["status"] = "EN_ROUTE";
            baseRec["assigned_vehicle_id"] = Str(truck.Vehicle, "id");
            baseRec["assigned_driver_id"] = trDrv;
            baseRec["fire_station_id"] = station != null ? Str(station, "id") : null;
            baseRec["distance_km"] = eta.DistanceKm;
            baseRec["eta_min"] = eta.EtaMin;
            baseRec["eta_to_pickup_min"] = eta.EtaToPickupMin;
            baseRec["traffic_factor"] = eta.TrafficFactor;
            baseRec["eta_complete"] = EtaComplete(eta.EtaMin);
            MergeIndexAttrs(baseRec, "EMG", "EN_ROUTE", zoneId, source, createdAt, sevR, Str(truck.Vehicle, "id"));
            return baseRec;
        }

        if (kind == "blood")
        {
            var found = await FindNearestVehicle(refData, pt, "ambulance");
            if (found == null)
            {
                MergeIndexAttrs(baseRec, "EMG", "QUEUED", zoneId, source, createdAt, sevR, null);
                baseRec["case_type"] = "Blood";
                baseRec["status"] = "QUEUED";
                return baseRec;
            }
            var bloodBankId = Str(item, "blood_bank_id");
            Dictionary<string, object?>? bank = !string.IsNullOrEmpty(bloodBankId)
                ? refData.Locations.FirstOrDefault(l => Str(l, "id") == bloodBankId)
                : null;
            if (bank == null)
                bank = refData.Locations
                    .Where(l => Str(l, "type") == "bloodbank")
                    .Select(l => (l, d: HavKm(pt!, new GeoPoint(Dbl(l, "lat"), Dbl(l, "lng")))))
                    .OrderBy(x => x.d).FirstOrDefault().l;
            if (bank == null)
            {
                MergeIndexAttrs(baseRec, "EMG", "NO_BLOODBANK", zoneId, source, createdAt, sevR, Str(found.Vehicle, "id"));
                baseRec["case_type"] = "Blood";
                baseRec["status"] = "NO_BLOODBANK";
                baseRec["assigned_vehicle_id"] = Str(found.Vehicle, "id");
                return baseRec;
            }
            var bankPt = new GeoPoint(Dbl(bank, "lat"), Dbl(bank, "lng"));
            var pickToBank = HavKm(pt!, bankPt);
            var totalKm = found.Km + 2 * pickToBank;
            var foundZonePt = new GeoPoint(Dbl(found.Zone, "lat"), Dbl(found.Zone, "lng"));
            var eta = await ComputeRouteEta([foundZonePt, pt!, bankPt, pt!], found.Km, totalKm);
            await SetVehicleStatus(found.Vehicle, "enroute");
            var bDrv = Str(found.Vehicle, "driver_id");
            if (!string.IsNullOrEmpty(bDrv)) await SetDriverStatus(bDrv, "on-trip", id);
            baseRec["case_type"] = "Blood";
            baseRec["status"] = "EN_ROUTE";
            baseRec["assigned_vehicle_id"] = Str(found.Vehicle, "id");
            baseRec["assigned_driver_id"] = bDrv;
            baseRec["blood_bank_id"] = Str(bank, "id");
            baseRec["distance_km"] = eta.DistanceKm;
            baseRec["eta_min"] = eta.EtaMin;
            baseRec["eta_to_pickup_min"] = eta.EtaToPickupMin;
            baseRec["traffic_factor"] = eta.TrafficFactor;
            baseRec["eta_complete"] = EtaComplete(eta.EtaMin);
            MergeIndexAttrs(baseRec, "EMG", "EN_ROUTE", zoneId, source, createdAt, sevR, Str(found.Vehicle, "id"));
            return baseRec;
        }

        // Medical (default)
        var caseType = Str(item, "case_type");
        var medFound = await FindNearestVehicle(refData, pt, "ambulance");
        if (medFound == null)
        {
            MergeIndexAttrs(baseRec, "EMG", "QUEUED", zoneId, source, createdAt, sevR, null);
            baseRec["case_type"] = caseType;
            baseRec["status"] = "QUEUED";
            return baseRec;
        }
        var hospCandidates = refData.Hospitals
            .Where(h =>
            {
                if (h.TryGetValue("specialties", out var sp) && sp is List<object?> spl)
                    return spl.Any(s => s?.ToString() == caseType);
                return false;
            })
            .Select(h => (h, d: HavKm(pt!, new GeoPoint(Dbl(h, "lat"), Dbl(h, "lng")))))
            .OrderBy(x => severity == "Critical"
                ? (-(double.TryParse(x.h.GetValueOrDefault("capability")?.ToString(), out var cap2) ? cap2 : 0)) * 1e9 + x.d
                : x.d)
            .FirstOrDefault();
        if (hospCandidates.h == null)
        {
            MergeIndexAttrs(baseRec, "EMG", "NO_HOSPITAL", zoneId, source, createdAt, sevR, Str(medFound.Vehicle, "id"));
            baseRec["case_type"] = caseType;
            baseRec["status"] = "NO_HOSPITAL";
            baseRec["assigned_vehicle_id"] = Str(medFound.Vehicle, "id");
            return baseRec;
        }
        var hosp = hospCandidates.h;
        var hospPt = new GeoPoint(Dbl(hosp, "lat"), Dbl(hosp, "lng"));
        var medZonePt = new GeoPoint(Dbl(medFound.Zone, "lat"), Dbl(medFound.Zone, "lng"));
        var totalKm2 = medFound.Km + hospCandidates.d;
        var medEta = await ComputeRouteEta([medZonePt, pt!, hospPt], medFound.Km, totalKm2);
        await SetVehicleStatus(medFound.Vehicle, "enroute");
        var mDrv = Str(medFound.Vehicle, "driver_id");
        if (!string.IsNullOrEmpty(mDrv)) await SetDriverStatus(mDrv, "on-trip", id);
        baseRec["case_type"] = caseType;
        baseRec["status"] = "EN_ROUTE";
        baseRec["assigned_vehicle_id"] = Str(medFound.Vehicle, "id");
        baseRec["assigned_driver_id"] = mDrv;
        baseRec["hospital_id"] = Str(hosp, "id");
        baseRec["distance_km"] = medEta.DistanceKm;
        baseRec["eta_min"] = medEta.EtaMin;
        baseRec["eta_to_pickup_min"] = medEta.EtaToPickupMin;
        baseRec["traffic_factor"] = medEta.TrafficFactor;
        baseRec["eta_complete"] = EtaComplete(medEta.EtaMin);
        MergeIndexAttrs(baseRec, "EMG", "EN_ROUTE", zoneId, source, createdAt, sevR, Str(medFound.Vehicle, "id"));
        return baseRec;
    }

    // =====================================================================
    // Employee helpers
    // =====================================================================
    private static int BandNum(string? v)
    {
        if (string.IsNullOrEmpty(v)) return 0;
        var stripped = System.Text.RegularExpressions.Regex.Replace(v, @"[^\d]", "");
        if (!int.TryParse(stripped, out var n)) return 0;
        return Math.Min(4, Math.Max(0, n));
    }

    private static Dictionary<string, object?>? BandForBand(List<Dictionary<string, object?>> levels, int band)
    {
        var exact = levels.FirstOrDefault(l => BandNum(Str(l, "band")) == band);
        if (exact != null) return exact;
        return levels.OrderByDescending(l => BandNum(Str(l, "band"))).FirstOrDefault(l => band >= BandNum(Str(l, "band")))
            ?? levels.LastOrDefault();
    }

    private static object MapEmployee(Dictionary<string, object?> i, List<Dictionary<string, object?>> bands)
    {
        var b = BandNum(Str(i, "employee_band"));
        var def = BandForBand(bands, b);
        var allowedVt = def != null && def.TryGetValue("allowed_vehicle_types", out var avt) && avt is List<object?> ll
            ? ll.Select(x => x?.ToString() ?? "").ToList() : new List<string>();
        var firstName = Str(i, "first_name") ?? "";
        var lastName = Str(i, "last_name") ?? "";
        var name = Str(i, "name") ?? $"{firstName} {lastName}".Trim();
        return new
        {
            id = Str(i, "employee_id"), name,
            employee_band = b, grade = Str(def, "id"), bandLabel = Str(def, "label") ?? "",
            allowed_vehicle_types = allowedVt, dept = Str(i, "employee_department") ?? "",
            type = Str(i, "employee_type") ?? "", email = Str(i, "email"), phone = Str(i, "phone"),
            zone = Str(i, "zone") ?? "", status = Str(i, "status") ?? Str(i, "employee_status") ?? "Active",
        };
    }

    private static async Task<Dictionary<string, object?>?> EmployeeRaw(string id)
    {
        var r = await Ddb.Scan(TblEmp, "employee_id = :id", null, new() { [":id"] = DynamoService.Av(id) });
        return r.FirstOrDefault();
    }

    // =====================================================================
    // Input validation
    // =====================================================================
    private static string? ValidateEmergency(JsonObject b)
    {
        var kinds = new[] { "medical", "fire", "blood" };
        var sevs = new[] { "Critical", "Urgent", "Normal" };
        var kind = b["kind"]?.ToString();
        if (kind != null && !kinds.Contains(kind)) return "invalid kind";
        var sev = b["severity"]?.ToString();
        if (sev != null && !sevs.Contains(sev)) return "invalid severity";
        if (!int.TryParse(b["units"]?.ToString() ?? "1", out var units) || units < 1 || units > 10) return "invalid units";
        if (!int.TryParse(b["patients"]?.ToString() ?? "1", out var patients) || patients < 1 || patients > 1000) return "invalid patients";
        var pickup = b["pickup"];
        if (pickup == null) return "pickup required";
        var pickupRef = pickup["ref"]?.ToString();
        var pickupLat = b["pickup"]?["lat"]?.ToString();
        var pickupLng = b["pickup"]?["lng"]?.ToString();
        if (pickupRef == null && (pickupLat == null || pickupLng == null)) return "pickup needs ref or lat/lng";
        var note = b["note"]?.ToString();
        if (note != null && note.Length > 500) return "note too long";
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
            ["access-control-allow-headers"] = "content-type,authorization,x-api-key",
            ["access-control-allow-methods"] = "GET,POST,OPTIONS",
            ["vary"] = "Origin",
            ["content-type"] = "application/json",
        };
    }

    private static APIGatewayHttpApiV2ProxyResponse Resp(int statusCode, string? body, Dictionary<string, string> headers)
        => new() { StatusCode = statusCode, Body = body, Headers = headers };

    private static APIGatewayHttpApiV2ProxyResponse Ok(object body, Dictionary<string, string> cors, int code = 200)
        => Resp(code, JsonSerializer.Serialize(body, new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull }), cors);

    private static APIGatewayHttpApiV2ProxyResponse ErrResp(int status, string code, string message, Dictionary<string, string> cors, object? extra = null)
    {
        object body = extra == null
            ? (object)new { code, message }
            : JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(new { code, message }))!
              .Union(JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(extra))!)
              .ToDictionary(k => k.Key, k => k.Value);
        return Resp(status, JsonSerializer.Serialize(body, new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull }), cors);
    }

    // =====================================================================
    // Misc helpers
    // =====================================================================
    private static string Now() => DateTime.UtcNow.ToString("o");
    private static long EtaComplete(double mins) => DateTimeOffset.UtcNow.ToUnixTimeSeconds() + Math.Max(120, (long)Math.Round(mins * 60));
    private static string Rid(string prefix, int n) => $"{prefix}-{n + (int)(new Random().NextDouble() * 9 * n)}";
    private static string? TrackUrl(Dictionary<string, object?> rec)
    {
        var id = Str(rec, "id");
        var token = Str(rec, "track_token");
        return !string.IsNullOrEmpty(AppBaseUrl) && !string.IsNullOrEmpty(token)
            ? $"{AppBaseUrl}/track/{id}?t={token}" : null;
    }

    private static Dictionary<string, AttributeValue> Key(string pk, string sk) => new()
    {
        ["PK"] = new AttributeValue { S = pk },
        ["SK"] = new AttributeValue { S = sk },
    };

    private static string? QS(APIGatewayHttpApiV2ProxyRequest req, string key)
        => req.QueryStringParameters != null && req.QueryStringParameters.TryGetValue(key, out var v) ? v : null;

    private static string? Str(Dictionary<string, object?>? d, string key)
        => d?.TryGetValue(key, out var v) == true ? v?.ToString() : null;
    private static double Dbl(Dictionary<string, object?>? d, string key)
        => d != null && d.TryGetValue(key, out var v) && double.TryParse(v?.ToString(), out var r) ? r : 0;
    private static bool BoolVal(Dictionary<string, object?>? d, string key)
    {
        if (d == null || !d.TryGetValue(key, out var v)) return false;
        if (v is bool b) return b;
        var s = v?.ToString();
        return s == "True" || s == "true";
    }
    private static Dictionary<string, object?>? GetObj(Dictionary<string, object?>? d, string key)
        => d != null && d.TryGetValue(key, out var v) && v is Dictionary<string, object?> obj ? obj : null;

    private static Dictionary<string, object?>? GetObj(JsonObject? o, string key)
    {
        if (o == null || !o.TryGetPropertyValue(key, out var node) || node == null) return null;
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(node.ToJsonString());
        }
        catch { return null; }
    }

    private static string? Str(JsonObject? o, string key)
        => o?.TryGetPropertyValue(key, out var v) == true ? v?.ToString() : null;

    private static string Env(string name, string def) => Environment.GetEnvironmentVariable(name) ?? def;

    private static JsonDocument ParseJson(string s)
    {
        try { return JsonDocument.Parse(s); }
        catch { return JsonDocument.Parse("{}"); }
    }

    private static double GetPolicyDouble(string key, double def)
    {
        if (PolicyConfig.RootElement.TryGetProperty(key, out var el) && el.TryGetDouble(out var v)) return v;
        return def;
    }
}

// Helpers for tuple async
internal static class TaskExtensions
{
    internal static async Task<(T1, T2, T3, T4)> Collect<T1, T2, T3, T4>(
        this (Task<T1>, Task<T2>, Task<T3>, Task<T4>) tasks)
    {
        await Task.WhenAll(tasks.Item1, tasks.Item2, tasks.Item3, tasks.Item4);
        return (tasks.Item1.Result, tasks.Item2.Result, tasks.Item3.Result, tasks.Item4.Result);
    }
}
