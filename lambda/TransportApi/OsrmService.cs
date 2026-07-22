using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace TransportApi;

public record GeoPoint(double Lat, double Lng);
public record RouteResult(double Km, double FreeMin, List<RouteLeg> Legs);
public record RouteLeg(double Km, double Min);

/// <summary>
/// HTTP client for OSRM public router. Falls back to straight-line distance when unreachable.
/// </summary>
public static class OsrmService
{
    private const string OsrmBase = "https://router.project-osrm.org/route/v1/driving";
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(4) };
    // In-memory cache within a single Lambda invocation (mass casualty dedup)
    private static readonly Dictionary<string, RouteResult?> Cache = new();

    public static async Task<RouteResult?> Route(IReadOnlyList<GeoPoint> points)
    {
        var valid = points.Where(p => p != null).ToList();
        if (valid.Count < 2) return null;
        var key = string.Join("|", valid.Select(p => $"{p.Lat:F4},{p.Lng:F4}"));
        if (Cache.TryGetValue(key, out var cached)) return cached;

        var path = string.Join(";", valid.Select(p => $"{p.Lng},{p.Lat}"));
        RouteResult? result = null;
        try
        {
            var url = $"{OsrmBase}/{path}?overview=false";
            var json = await Http.GetStringAsync(url);
            var doc = JsonDocument.Parse(json);
            var route = doc.RootElement.GetProperty("routes")[0];
            var distM = route.GetProperty("distance").GetDouble();
            var durS = route.GetProperty("duration").GetDouble();
            var legs = new List<RouteLeg>();
            if (route.TryGetProperty("legs", out var legsEl))
                foreach (var leg in legsEl.EnumerateArray())
                    legs.Add(new RouteLeg(leg.GetProperty("distance").GetDouble() / 1000.0,
                                         leg.GetProperty("duration").GetDouble() / 60.0));
            result = new RouteResult(distM / 1000.0, durS / 60.0, legs);
        }
        catch { result = null; }
        // Only cache successes. A cached null would pin this route to the
        // straight-line fallback for the container's entire warm lifetime
        // after one transient OSRM hiccup. Also cap the cache — it's static
        // (survives across invocations, not just within one), so without a
        // bound it grows for as long as the container lives.
        if (result != null)
        {
            if (Cache.Count >= 500) Cache.Clear();
            Cache[key] = result;
        }
        return result;
    }
}
