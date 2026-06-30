using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Amazon.CloudWatch;
using Amazon.CloudWatch.Model;
using Amazon.CloudWatchLogs;
using Amazon.CloudWatchLogs.Model;

namespace TransportApi;

public record MetricSeries(string T, double V);

public record InfraMetrics(
    string FunctionName,
    int RangeMin,
    int PeriodMin,
    double Invocations,
    double Errors,
    double ErrorRatePct,
    double Throttles,
    double DurationAvgMs,
    double DurationP99Ms,
    double ColdStarts,
    double MaxConcurrent,
    MetricSeriesSet Series,
    List<RecentError> RecentErrors,
    string GeneratedAt
);

public record MetricSeriesSet(List<MetricSeries> Invocations, List<MetricSeries> Errors, List<MetricSeries> DurationAvg);
public record RecentError(string Timestamp, string Message);

/// <summary>CloudWatch metrics + log events for the infra/metrics endpoint.</summary>
public sealed class CloudWatchService : IDisposable
{
    private readonly AmazonCloudWatchClient _cw;
    private readonly AmazonCloudWatchLogsClient _cwl;

    public CloudWatchService()
    {
        _cw = new AmazonCloudWatchClient();
        _cwl = new AmazonCloudWatchLogsClient();
    }

    public async Task<InfraMetrics> GetMetrics(string functionName, int rangeMin, int periodMin)
    {
        var end = DateTime.UtcNow;
        var start = end.AddMinutes(-rangeMin);
        var period = periodMin * 60;

        var dim = new List<Dimension> { new() { Name = "FunctionName", Value = functionName } };
        Dimension[] Dims() => [.. dim];

        var queries = new List<MetricDataQuery>
        {
            MQ("inv",  "AWS/Lambda", "Invocations",          Dims(), period, "Sum"),
            MQ("err",  "AWS/Lambda", "Errors",               Dims(), period, "Sum"),
            MQ("thr",  "AWS/Lambda", "Throttles",            Dims(), period, "Sum"),
            MQ("durA", "AWS/Lambda", "Duration",             Dims(), period, "Average"),
            MQ("durP", "AWS/Lambda", "Duration",             Dims(), period, "p99"),
            MQ("cold", "AWS/Lambda", "InitDuration",         Dims(), period, "SampleCount"),
            MQ("conc", "AWS/Lambda", "ConcurrentExecutions", Dims(), period, "Maximum"),
        };

        var cwResp = await _cw.GetMetricDataAsync(new GetMetricDataRequest
        {
            MetricDataQueries = queries,
            StartTime = start,
            EndTime = end,
        });

        var byId = cwResp.MetricDataResults.ToDictionary(m => m.Id);
        double Sum(string id) => byId.TryGetValue(id, out var r) ? r.Values.Sum() : 0;
        double Avg(string id) => byId.TryGetValue(id, out var r) && r.Values.Count > 0 ? r.Values.Average() : 0;
        double Max(string id) => byId.TryGetValue(id, out var r) && r.Values.Count > 0 ? r.Values.Max() : 0;
        List<MetricSeries> Series(string id)
        {
            if (!byId.TryGetValue(id, out var r)) return [];
            return r.Timestamps
                .Select((t, i) => new MetricSeries(t.ToUniversalTime().ToString("o"), Math.Round(r.Values[i], 2)))
                .OrderBy(s => s.T).ToList();
        }

        var invocations = Sum("inv");
        var errors = Sum("err");

        // Recent errors from CloudWatch Logs (best-effort)
        var recentErrors = new List<RecentError>();
        try
        {
            var le = await _cwl.FilterLogEventsAsync(new FilterLogEventsRequest
            {
                LogGroupName = $"/aws/lambda/{functionName}",
                StartTime = (long)(DateTimeOffset.UtcNow.AddMinutes(-Math.Min(rangeMin, 60)).ToUnixTimeMilliseconds()),
                FilterPattern = "?ERROR ?Error ?WARN",
                Limit = 15,
            });
            recentErrors = le.Events
                .Select(e => new RecentError(
                    DateTimeOffset.FromUnixTimeMilliseconds(e.Timestamp).UtcDateTime.ToString("o"),
                    (e.Message ?? "").Trim()[..Math.Min(400, (e.Message ?? "").Trim().Length)]))
                .ToList();
        }
        catch { /* best-effort */ }

        return new InfraMetrics(
            FunctionName: functionName,
            RangeMin: rangeMin,
            PeriodMin: periodMin,
            Invocations: invocations,
            Errors: errors,
            ErrorRatePct: invocations > 0 ? Math.Round(errors / invocations * 100, 2) : 0,
            Throttles: Sum("thr"),
            DurationAvgMs: Math.Round(Avg("durA"), 1),
            DurationP99Ms: Math.Round(Avg("durP"), 1),
            ColdStarts: Sum("cold"),
            MaxConcurrent: Max("conc"),
            Series: new MetricSeriesSet(Series("inv"), Series("err"), Series("durA")),
            RecentErrors: recentErrors,
            GeneratedAt: DateTime.UtcNow.ToString("o")
        );
    }

    private static MetricDataQuery MQ(string id, string ns, string metric, Dimension[] dims, int period, string stat)
        => new()
        {
            Id = id,
            MetricStat = new MetricStat
            {
                Metric = new Metric { Namespace = ns, MetricName = metric, Dimensions = [.. dims] },
                Period = period,
                Stat = stat,
            },
        };

    public void Dispose() { _cw.Dispose(); _cwl.Dispose(); }
}
