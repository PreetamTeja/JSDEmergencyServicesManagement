using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Amazon.CloudWatch;
using Amazon.CloudWatch.Model;
using Amazon.CloudWatchLogs;
using Amazon.CloudWatchLogs.Model;
using Amazon.Lambda;
using Amazon.XRay;
using Amazon.XRay.Model;

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

// ---- Additions: cross-function view, DynamoDB, Bedrock, cost, tracing ----
public record DynamoTableMetrics(string TableName, double ConsumedReadUnits, double ConsumedWriteUnits, double ReadThrottles, double WriteThrottles);
public record BedrockMetrics(string ModelId, double Invocations, double InputTokens, double OutputTokens, double AvgLatencyMs, double ClientErrors);
public record TraceSegment(string Service, double AvgMs, int SampleCount);
public record LambdaCostEstimate(string FunctionName, double MemoryMb, double GbSeconds, double EstMonthlyUsd);
public record CostEstimate(List<LambdaCostEstimate> Lambdas, double? BedrockEstMonthlyUsd, double TotalEstMonthlyUsd, string Note);

/// <summary>CloudWatch metrics + log events for the infra/metrics endpoint.</summary>
public sealed class CloudWatchService : IDisposable
{
    private readonly AmazonCloudWatchClient _cw;
    private readonly AmazonCloudWatchLogsClient _cwl;
    private readonly AmazonLambdaClient _lambda;
    private readonly AmazonXRayClient _xray;

    // Approximate AWS list pricing (eu-west-1, USD) — for a rough cost signal only,
    // not a substitute for Cost Explorer. Adjust here if pricing changes.
    private const double LambdaPricePerGbSecond = 0.0000166667;
    private const double LambdaPricePerMillionRequests = 0.20;
    private const double BedrockNovaLitePricePerKInputTokens = 0.00006;
    private const double BedrockNovaLitePricePerKOutputTokens = 0.00024;
    private const double MonthlyExtrapolationFactor = 43800.0; // minutes in a month, scaled against the sampled window

    public CloudWatchService()
    {
        _cw = new AmazonCloudWatchClient();
        _cwl = new AmazonCloudWatchLogsClient();
        _lambda = new AmazonLambdaClient();
        _xray = new AmazonXRayClient();
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

    /// <summary>DynamoDB consumed capacity + throttle counts for one table — the class of
    /// failure that doesn't show up as a Lambda error (dispatch just gets slow/silently retried).</summary>
    public async Task<DynamoTableMetrics> GetDynamoMetrics(string tableName, int rangeMin, int periodMin)
    {
        var end = DateTime.UtcNow;
        var start = end.AddMinutes(-rangeMin);
        var period = periodMin * 60;
        var dim = new[] { new Dimension { Name = "TableName", Value = tableName } };

        var queries = new List<MetricDataQuery>
        {
            MQ("rcu", "AWS/DynamoDB", "ConsumedReadCapacityUnits",  dim, period, "Sum"),
            MQ("wcu", "AWS/DynamoDB", "ConsumedWriteCapacityUnits", dim, period, "Sum"),
            MQ("rthr", "AWS/DynamoDB", "ReadThrottleEvents",  dim, period, "Sum"),
            MQ("wthr", "AWS/DynamoDB", "WriteThrottleEvents", dim, period, "Sum"),
        };

        try
        {
            var resp = await _cw.GetMetricDataAsync(new GetMetricDataRequest { MetricDataQueries = queries, StartTime = start, EndTime = end });
            var byId = resp.MetricDataResults.ToDictionary(m => m.Id);
            double Sum(string id) => byId.TryGetValue(id, out var r) ? r.Values.Sum() : 0;
            return new DynamoTableMetrics(tableName, Sum("rcu"), Sum("wcu"), Sum("rthr"), Sum("wthr"));
        }
        catch { return new DynamoTableMetrics(tableName, 0, 0, 0, 0); }
    }

    /// <summary>Bedrock invocation + token usage for VoiceAgent's model — separate AWS
    /// namespace from Lambda, invisible to the standard invocation metrics.</summary>
    public async Task<BedrockMetrics> GetBedrockMetrics(string modelId, int rangeMin, int periodMin)
    {
        var end = DateTime.UtcNow;
        var start = end.AddMinutes(-rangeMin);
        var period = periodMin * 60;
        var dim = new[] { new Dimension { Name = "ModelId", Value = modelId } };

        var queries = new List<MetricDataQuery>
        {
            MQ("inv",  "AWS/Bedrock", "Invocations",       dim, period, "Sum"),
            MQ("intk", "AWS/Bedrock", "InputTokenCount",   dim, period, "Sum"),
            MQ("outk", "AWS/Bedrock", "OutputTokenCount",  dim, period, "Sum"),
            MQ("lat",  "AWS/Bedrock", "InvocationLatency", dim, period, "Average"),
            MQ("cerr", "AWS/Bedrock", "InvocationClientErrors", dim, period, "Sum"),
        };

        try
        {
            var resp = await _cw.GetMetricDataAsync(new GetMetricDataRequest { MetricDataQueries = queries, StartTime = start, EndTime = end });
            var byId = resp.MetricDataResults.ToDictionary(m => m.Id);
            double Sum(string id) => byId.TryGetValue(id, out var r) ? r.Values.Sum() : 0;
            double Avg(string id) => byId.TryGetValue(id, out var r) && r.Values.Count > 0 ? r.Values.Average() : 0;
            return new BedrockMetrics(modelId, Sum("inv"), Sum("intk"), Sum("outk"), Math.Round(Avg("lat"), 1), Sum("cerr"));
        }
        catch { return new BedrockMetrics(modelId, 0, 0, 0, 0, 0); }
    }

    /// <summary>Approximate GB-seconds -> $/month for a Lambda, extrapolated from the
    /// sampled window. List pricing — a directional cost signal, not a bill.</summary>
    public async Task<LambdaCostEstimate> GetLambdaCostEstimate(string functionName, double invocations, double durationAvgMs, int rangeMin)
    {
        double memoryMb = 256;
        try
        {
            var cfg = await _lambda.GetFunctionConfigurationAsync(new Amazon.Lambda.Model.GetFunctionConfigurationRequest { FunctionName = functionName });
            if (cfg.MemorySize > 0) memoryMb = cfg.MemorySize;
        }
        catch { /* best-effort: fall back to default estimate */ }

        var gbSeconds = (durationAvgMs / 1000.0) * (memoryMb / 1024.0) * invocations;
        var sampledCost = gbSeconds * LambdaPricePerGbSecond + (invocations / 1_000_000.0) * LambdaPricePerMillionRequests;
        var scaleToMonth = rangeMin > 0 ? MonthlyExtrapolationFactor / rangeMin : 0;
        return new LambdaCostEstimate(functionName, memoryMb, Math.Round(gbSeconds, 2), Math.Round(sampledCost * scaleToMonth, 2));
    }

    /// <summary>X-Ray trace segment breakdown (requires Active tracing enabled on the
    /// function). Splits a request's time across services — e.g. DynamoDB vs an
    /// external OSRM routing call vs the Lambda's own code — instead of one p99 number.</summary>
    public async Task<List<TraceSegment>> GetTraceBreakdown(int rangeMin)
    {
        var end = DateTime.UtcNow;
        var start = end.AddMinutes(-Math.Min(rangeMin, 60)); // X-Ray summaries: keep the query window small
        var byService = new Dictionary<string, (double totalMs, int count)>();

        try
        {
            string? nextToken = null;
            var pages = 0;
            do
            {
                var resp = await _xray.GetTraceSummariesAsync(new GetTraceSummariesRequest
                {
                    StartTime = start, EndTime = end, NextToken = nextToken,
                });
                foreach (var s in resp.TraceSummaries)
                {
                    foreach (var svc in s.ServiceIds ?? new List<ServiceId>())
                    {
                        var name = svc.Name ?? "unknown";
                        var ms = s.Duration * 1000.0;
                        if (!byService.ContainsKey(name)) byService[name] = (0, 0);
                        var cur = byService[name];
                        byService[name] = (cur.totalMs + ms, cur.count + 1);
                    }
                }
                nextToken = resp.NextToken;
                pages++;
            } while (!string.IsNullOrEmpty(nextToken) && pages < 3); // cap pagination — this is a dashboard hint, not an export
        }
        catch { /* X-Ray may not be enabled yet — return whatever we gathered (possibly empty) */ }

        return byService
            .Select(kv => new TraceSegment(kv.Key, Math.Round(kv.Value.totalMs / Math.Max(1, kv.Value.count), 1), kv.Value.count))
            .OrderByDescending(t => t.AvgMs)
            .ToList();
    }

    public void Dispose() { _cw.Dispose(); _cwl.Dispose(); _lambda.Dispose(); _xray.Dispose(); }
}
