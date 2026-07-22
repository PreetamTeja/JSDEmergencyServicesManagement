using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.IdentityModel.Tokens;

namespace TransportApi;

/// <summary>
/// JWT RS256 verification against Cognito JWKS, with static JWKS cache for warm invocation reuse.
/// Also handles x-api-key lookup.
/// </summary>
public static class Auth
{
    private static readonly string Region = Environment.GetEnvironmentVariable("COGNITO_REGION") ?? "";
    private static readonly string Pool = Environment.GetEnvironmentVariable("COGNITO_USER_POOL_ID") ?? "";
    private static readonly string ClientId = Environment.GetEnvironmentVariable("COGNITO_CLIENT_ID") ?? "";
    private static readonly string Issuer = Region.Length > 0 && Pool.Length > 0
        ? $"https://cognito-idp.{Region}.amazonaws.com/{Pool}" : "";

    public static readonly bool JwtEnabled = Issuer.Length > 0;

    // Admin groups from env (comma-separated). Falls back to ".*-admin" pattern.
    private static readonly HashSet<string> AdminGroups = (Environment.GetEnvironmentVariable("ADMIN_GROUPS") ?? "")
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    // API_KEYS: { "key": "SOURCE" }
    private static readonly Dictionary<string, string> ApiKeys = ParseApiKeys();
    public static readonly bool KeysEnabled = ApiKeys.Count > 0;

    // JWKS cache — static so it survives warm invocations (Lambda container reuse).
    private static IList<JsonWebKey>? _jwksCache;
    private static long _jwksCachedAt;
    private static readonly SemaphoreSlim _jwksLock = new(1, 1);
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };

    // Scopes: which POST resources each source may call. CONSOLE = all.
    private static readonly Dictionary<string, string[]> Scopes = new()
    {
        ["CONSOLE"] = ["*"],
        ["HOSPITAL"] = ["emergencies"],
        ["EDUCATION"] = ["requests"],
        ["DELIVERY"] = ["requests"],
        ["ADMIN"] = ["requests"],
        ["HR"] = ["bookings"],
        ["FUEL"] = ["fleet"],
        ["MCP"] = ["infra"],
    };

    public static string? CallerSource(IDictionary<string, string> headers)
    {
        if (!KeysEnabled) return null;
        if (headers.TryGetValue("x-api-key", out var k) || headers.TryGetValue("X-Api-Key", out k))
            return ApiKeys.TryGetValue(k, out var src) ? src : null;
        return null;
    }

    public static bool CanPost(string source, string resource)
    {
        if (!Scopes.TryGetValue(source, out var allow)) return false;
        return allow.Contains("*") || allow.Contains(resource);
    }

    public static async Task<JwtPayload?> VerifyJwt(string token)
    {
        if (!JwtEnabled || string.IsNullOrEmpty(token)) return null;
        var parts = token.Split('.');
        if (parts.Length != 3) return null;
        try
        {
            var keys = await GetJwks();
            var handler = new JwtSecurityTokenHandler { MaximumTokenSizeInBytes = 1024 * 16 };
            var vp = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = Issuer,
                ValidateAudience = false, // checked manually below
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromSeconds(5),
                IssuerSigningKeys = keys,
            };
            handler.ValidateToken(token, vp, out var validated);
            var jwt = (JwtSecurityToken)validated;
            // Audience / client_id check
            if (!string.IsNullOrEmpty(ClientId))
            {
                var aud = jwt.Claims.FirstOrDefault(c => c.Type == "aud")?.Value
                       ?? jwt.Claims.FirstOrDefault(c => c.Type == "client_id")?.Value;
                if (aud != null && aud != ClientId) return null;
            }
            var tokenUse = jwt.Claims.FirstOrDefault(c => c.Type == "token_use")?.Value;
            if (tokenUse != null && tokenUse != "access" && tokenUse != "id") return null;
            return jwt.Payload;
        }
        catch { return null; }
    }

    public static string[] GroupsOf(JwtPayload? claims)
    {
        if (claims == null) return [];
        if (claims.TryGetValue("cognito:groups", out var g))
        {
            if (g is string s) return [s];
            if (g is JsonElement je && je.ValueKind == JsonValueKind.Array)
                return je.EnumerateArray().Select(e => e.GetString() ?? "").Where(x => x.Length > 0).ToArray();
            if (g is IEnumerable<object> list)
                return list.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).ToArray();
        }
        return [];
    }

    public static bool IsAdmin(JwtPayload? claims) => IsAdminGroups(GroupsOf(claims));

    // Extracted so callers with groups from a non-JWT source (e.g. the
    // sso_session cookie claims) can reuse the same admin-group logic.
    public static bool IsAdminGroups(string[] groups)
    {
        if (AdminGroups.Count > 0)
            return groups.Any(g => AdminGroups.Contains(g));
        return groups.Any(g => g.EndsWith("-admin", StringComparison.OrdinalIgnoreCase));
    }

    public static string? IdentityOf(JwtPayload? claims)
    {
        if (claims == null) return null;
        foreach (var key in new[] { "sub", "username", "email", "name" })
            if (claims.TryGetValue(key, out var v) && v is string s && s.Length > 0) return s;
        return null;
    }

    private static async Task<IList<JsonWebKey>> GetJwks()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (_jwksCache != null && now - _jwksCachedAt < 3_600_000) return _jwksCache;
        await _jwksLock.WaitAsync();
        try
        {
            // Double-check after acquiring lock
            now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (_jwksCache != null && now - _jwksCachedAt < 3_600_000) return _jwksCache;
            var json = await _http.GetStringAsync($"{Issuer}/.well-known/jwks.json");
            var doc = JsonDocument.Parse(json);
            var keySet = new JsonWebKeySet(json);
            _jwksCache = keySet.Keys;
            _jwksCachedAt = now;
            return _jwksCache;
        }
        finally { _jwksLock.Release(); }
    }

    private static Dictionary<string, string> ParseApiKeys()
    {
        try
        {
            var raw = Environment.GetEnvironmentVariable("API_KEYS") ?? "{}";
            return JsonSerializer.Deserialize<Dictionary<string, string>>(raw) ?? new();
        }
        catch { return new(); }
    }
}
