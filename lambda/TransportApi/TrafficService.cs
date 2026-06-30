using System;

namespace TransportApi;

/// <summary>
/// Time-of-day IST traffic congestion factor.
/// Peak 8-9 am and 5-7 pm → up to 1.6x. Off-peak → 1.0x.
/// POLICY.traffic_factor env override takes precedence.
/// </summary>
public static class TrafficService
{
    public static double Multiplier(double? policyOverride = null)
    {
        if (policyOverride.HasValue && policyOverride.Value > 0)
            return policyOverride.Value;
        var utcNow = DateTime.UtcNow;
        // IST = UTC+5:30 = UTC + 330 min
        var istMinutes = (utcNow.Hour * 60 + utcNow.Minute + 330) % 1440;
        var istH = istMinutes / 60.0;
        // Morning peak ~9:30am, evening peak ~18:30
        var morningPeak = Math.Max(0, 1 - Math.Abs(istH - 9.5) / 2.5);
        var eveningPeak = Math.Max(0, 1 - Math.Abs(istH - 18.5) / 3.0);
        var peak = Math.Max(morningPeak, eveningPeak);
        return Math.Round(1 + 0.6 * peak, 2);
    }
}
