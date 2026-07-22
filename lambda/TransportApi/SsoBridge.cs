using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Amazon.Lambda.APIGatewayEvents;

namespace TransportApi;

/// <summary>
/// AWS-native replacement for the once-proposed Cloudflare Worker SSO bridge.
/// Runs inside the existing TransportApi Lambda, behind the same CloudFront
/// distribution and API Gateway this app already uses — no new domain, no
/// new third-party platform. Verifies the Cognito ID token the SSO portal
/// posts, then issues our own HMAC-signed HttpOnly session cookie so the
/// frontend stops depending on in-memory-only token storage (which is lost
/// on reload).
/// </summary>
public static class SsoBridge
{
    // Real-world measured latency through the portal's redirect chain runs
    // 70-110s (see SSO_STALE_TOKEN diagnostics, 2026-07-08) — well beyond the
    // original 30s target. This window is defense-in-depth on top of the
    // real replay guard (one-time jti check below), so widening it doesn't
    // weaken the actual protection against a stolen-in-transit token being
    // reused; it only had to be short enough to bound how long a stolen
    // token stays valid, and 5 minutes still does that.
    private const int MaxTokenAgeMs = 300_000;
    private const int SessionMaxAgeS = 8 * 60 * 60; // 8h

    // Must be set via `aws lambda update-function-configuration --environment
    // Variables={SSO_SESSION_SECRET=...}` (or console) directly by whoever
    // owns the Lambda — never hardcoded or committed here.
    private static readonly string SessionSecret = Environment.GetEnvironmentVariable("SSO_SESSION_SECRET") ?? "";
    private static readonly string ReplayTable = Environment.GetEnvironmentVariable("TBL_SSO_REPLAY") ?? "SsoReplayTokens";
    private static readonly AmazonDynamoDBClient Ddb = new();

    public static bool Enabled => SessionSecret.Length > 0;

    public static async Task<APIGatewayHttpApiV2ProxyResponse> HandleCallback(
        APIGatewayHttpApiV2ProxyRequest request, Dictionary<string, string> cors)
    {
        if (!Enabled) return Err(500, "SSO_NOT_CONFIGURED", "SSO_SESSION_SECRET is not set", cors);

        var rawBody = request.Body ?? "";
        if (request.IsBase64Encoded)
            rawBody = Encoding.UTF8.GetString(Convert.FromBase64String(rawBody));

        // The SSO portal serves ~42 apps and may send JSON instead of the
        // form-urlencoded contract we specified — accept either rather than
        // rejecting a well-formed request just because of content-type.
        string ssoToken = "", issuedAtRaw = "";
        var contentType = request.Headers?.TryGetValue("content-type", out var ct) == true ? ct : "";
        if (contentType.Contains("application/json") || (rawBody.TrimStart().StartsWith("{")))
        {
            try
            {
                var json = JsonNode.Parse(rawBody)?.AsObject();
                ssoToken = json?["sso_token"]?.ToString() ?? json?["ssoToken"]?.ToString() ?? "";
                issuedAtRaw = json?["issued_at"]?.ToString() ?? json?["issuedAt"]?.ToString() ?? "";
            }
            catch { /* fall through to form parsing below */ }
        }
        if (ssoToken.Length == 0)
        {
            var form = ParseForm(rawBody);
            ssoToken = form.TryGetValue("sso_token", out var stv) ? stv : "";
            issuedAtRaw = form.TryGetValue("issued_at", out var iav) ? iav : "";
        }
        if (ssoToken.Length == 0 || !long.TryParse(issuedAtRaw, out var issuedAt))
        {
            // Diagnostic only — never logs the token value, just enough shape
            // info to tell what the caller actually sent.
            var bodyKeys = TryTopLevelKeys(rawBody);
            Console.Error.WriteLine($"ERROR SSO_BAD_REQUEST content-type='{contentType}' bodyLen={rawBody.Length} keysSeen=[{string.Join(",", bodyKeys)}]");
            return Err(400, "BAD_REQUEST", "missing sso_token or issued_at", cors);
        }

        // Some callers send issued_at in seconds rather than milliseconds —
        // a 10-digit value (< year 2286 in ms, i.e. < ~10_000_000_000) is
        // almost certainly seconds, not ms.
        if (issuedAt > 0 && issuedAt < 10_000_000_000) issuedAt *= 1000;

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var driftMs = now - issuedAt;
        if (Math.Abs(driftMs) > MaxTokenAgeMs)
        {
            Console.Error.WriteLine($"ERROR SSO_STALE_TOKEN driftMs={driftMs} issuedAtRaw='{issuedAtRaw}' nowMs={now}");
            return Err(401, "STALE_TOKEN", "sso_token is not fresh", cors);
        }

        var claims = await Auth.VerifyJwt(ssoToken);
        if (claims == null) return Err(401, "INVALID_TOKEN", "signature/issuer/audience/expiry check failed", cors);

        var jti = claims.TryGetValue("jti", out var jv) ? jv?.ToString() : null;
        if (string.IsNullOrEmpty(jti)) return Err(401, "MISSING_JTI", "token has no jti claim", cors);
        if (!await ConsumeJti(jti)) return Err(401, "REPLAY", "token already used", cors);

        var groups = Auth.GroupsOf(claims);
        var identity = Auth.IdentityOf(claims);
        var email = claims.TryGetValue("email", out var ev) ? ev?.ToString() : null;

        var sessionExp = DateTimeOffset.UtcNow.AddSeconds(SessionMaxAgeS).ToUnixTimeSeconds();
        var sessionClaims = new JsonObject
        {
            ["userId"] = identity,
            ["email"] = email,
            ["groups"] = new JsonArray(groups.Select(g => (JsonNode)g).ToArray()),
            ["exp"] = sessionExp,
        };
        var cookieValue = Sign(sessionClaims.ToJsonString());

        // Must be absolute: a relative "/" only resolves correctly if the
        // browser reached this endpoint via the app's own CloudFront domain.
        // If the caller posted directly to the API Gateway execute-api
        // domain instead, a relative redirect resolves against *that*
        // domain, which has no route for GET / (NO_ROUTE).
        var appBaseUrl = Environment.GetEnvironmentVariable("APP_BASE_URL") ?? "";
        var location = appBaseUrl.Length > 0 ? appBaseUrl.TrimEnd('/') + "/" : "/";

        var headers = new Dictionary<string, string>(cors)
        {
            ["Set-Cookie"] = CookieHeader(cookieValue, SessionMaxAgeS),
            ["Location"] = location,
        };
        return new APIGatewayHttpApiV2ProxyResponse { StatusCode = 302, Headers = headers };
    }

    // Used by Function.cs's main principal-resolution path so every other
    // endpoint (/fleet, /ops, etc.) accepts the sso_session cookie as an
    // alternative to the Authorization bearer JWT — a cookie session never
    // exposes a raw JWT to JS, so there's nothing for the frontend to put
    // in that header anymore.
    public static JsonObject? TryGetSessionClaims(APIGatewayHttpApiV2ProxyRequest request)
    {
        if (!Enabled) return null;
        var cookie = ReadCookie(request, "sso_session");
        return cookie != null ? Verify(cookie) : null;
    }

    public static APIGatewayHttpApiV2ProxyResponse HandleMe(
        APIGatewayHttpApiV2ProxyRequest request, Dictionary<string, string> cors)
    {
        var cookie = ReadCookie(request, "sso_session");
        var claims = cookie != null ? Verify(cookie) : null;
        if (claims == null)
            return new APIGatewayHttpApiV2ProxyResponse
            {
                StatusCode = 401,
                Headers = cors,
                Body = JsonSerializer.Serialize(new { authed = false }),
            };
        return new APIGatewayHttpApiV2ProxyResponse
        {
            StatusCode = 200,
            Headers = cors,
            Body = JsonSerializer.Serialize(new
            {
                authed = true,
                userId = claims["userId"]?.ToString(),
                email = claims["email"]?.ToString(),
                groups = claims["groups"]?.AsArray().Select(g => g?.ToString()).ToArray(),
            }),
        };
    }

    public static APIGatewayHttpApiV2ProxyResponse HandleLogout(Dictionary<string, string> cors)
    {
        var headers = new Dictionary<string, string>(cors)
        {
            ["Set-Cookie"] = CookieHeader("", 0),
            ["Location"] = "/",
        };
        return new APIGatewayHttpApiV2ProxyResponse { StatusCode = 302, Headers = headers };
    }

    // ---- helpers ----

    private static async Task<bool> ConsumeJti(string jti)
    {
        try
        {
            await Ddb.PutItemAsync(new PutItemRequest
            {
                TableName = ReplayTable,
                Item = new Dictionary<string, AttributeValue>
                {
                    ["jti"] = new AttributeValue { S = jti },
                    ["ttl"] = new AttributeValue { N = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds().ToString() },
                },
                ConditionExpression = "attribute_not_exists(jti)",
            });
            return true;
        }
        catch (ConditionalCheckFailedException) { return false; }
    }

    private static string Sign(string json)
    {
        var body = Base64UrlEncode(Encoding.UTF8.GetBytes(json));
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(SessionSecret));
        var sig = Base64UrlEncode(h.ComputeHash(Encoding.UTF8.GetBytes(body)));
        return $"{body}.{sig}";
    }

    private static JsonObject? Verify(string cookieValue)
    {
        var parts = cookieValue.Split('.');
        if (parts.Length != 2) return null;
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(SessionSecret));
        var expectedSig = Base64UrlEncode(h.ComputeHash(Encoding.UTF8.GetBytes(parts[0])));
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expectedSig), Encoding.UTF8.GetBytes(parts[1])))
            return null;
        try
        {
            var obj = JsonNode.Parse(Encoding.UTF8.GetString(Base64UrlDecode(parts[0])))?.AsObject();
            if (obj == null) return null;
            var exp = obj["exp"]?.GetValue<long>() ?? 0;
            if (exp <= DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return null;
            return obj;
        }
        catch { return null; }
    }

    private static string? ReadCookie(APIGatewayHttpApiV2ProxyRequest request, string name)
    {
        string? cookieHeader = null;
        request.Headers?.TryGetValue("cookie", out cookieHeader);
        var cookies = request.Cookies ?? cookieHeader?.Split("; ");
        if (cookies == null) return null;
        foreach (var c in cookies)
        {
            var idx = c.IndexOf('=');
            if (idx > 0 && c[..idx] == name) return c[(idx + 1)..];
        }
        return null;
    }

    private static string CookieHeader(string value, int maxAgeS) =>
        $"sso_session={value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age={maxAgeS}";

    private static List<string> TryTopLevelKeys(string body)
    {
        try
        {
            var obj = JsonNode.Parse(body)?.AsObject();
            if (obj != null) return obj.Select(kv => kv.Key).ToList();
        }
        catch { }
        try { return ParseForm(body).Keys.ToList(); } catch { return new List<string>(); }
    }

    private static Dictionary<string, string> ParseForm(string body)
    {
        var result = new Dictionary<string, string>();
        foreach (var pair in body.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = pair.IndexOf('=');
            if (idx < 0) continue;
            var key = Uri.UnescapeDataString(pair[..idx].Replace('+', ' '));
            var val = Uri.UnescapeDataString(pair[(idx + 1)..].Replace('+', ' '));
            result[key] = val;
        }
        return result;
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    private static byte[] Base64UrlDecode(string s)
    {
        var b64 = s.Replace('-', '+').Replace('_', '/').PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        return Convert.FromBase64String(b64);
    }

    private static APIGatewayHttpApiV2ProxyResponse Err(int status, string code, string message, Dictionary<string, string> cors) =>
        new()
        {
            StatusCode = status,
            Headers = cors,
            Body = JsonSerializer.Serialize(new { code, message }),
        };
}
