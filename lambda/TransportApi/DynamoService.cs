using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace TransportApi;

/// <summary>
/// Thin DynamoDB wrapper. Converts between AttributeValue and plain Dictionary<string, object?> for ease of use.
/// </summary>
public sealed class DynamoService : IDisposable
{
    private readonly AmazonDynamoDBClient _client;

    public DynamoService()
    {
        _client = new AmazonDynamoDBClient();
    }

    // ---- Low-level attribute helpers ----

    public static AttributeValue Av(object? v)
    {
        return v switch
        {
            null => new AttributeValue { NULL = true },
            bool b => new AttributeValue { BOOL = b },
            int i => new AttributeValue { N = i.ToString() },
            long l => new AttributeValue { N = l.ToString() },
            double d => new AttributeValue { N = d.ToString("G17") },
            float f => new AttributeValue { N = f.ToString("G9") },
            decimal dec => new AttributeValue { N = dec.ToString() },
            string s => new AttributeValue { S = s },
            Dictionary<string, object?> dict => new AttributeValue { M = dict.ToDictionary(k => k.Key, k => Av(k.Value)) },
            IEnumerable<object?> list => new AttributeValue { L = list.Select(Av).ToList() },
            _ => new AttributeValue { S = v.ToString() ?? "" },
        };
    }

    public static object? FromAv(AttributeValue av)
    {
        if (av.NULL) return null;
        if (av.IsBOOLSet) return av.BOOL;
        if (av.S != null) return av.S;
        if (av.N != null)
        {
            // Return as double so JS receives a JSON number, not a string.
            // This preserves the behaviour of the Node.js DocumentClient.
            if (double.TryParse(av.N, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var d))
                return d;
            return av.N;
        }
        if (av.SS?.Count > 0) return av.SS.Cast<object?>().ToList(); // String Set → array
        if (av.NS?.Count > 0) return av.NS                           // Number Set → numeric array
            .Select(n => double.TryParse(n, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var d) ? (object?)d : n)
            .ToList();
        if (av.M != null) return av.M.ToDictionary(k => k.Key, k => FromAv(k.Value));
        if (av.L != null) return av.L.Select(FromAv).ToList();
        return null;
    }

    public static Dictionary<string, object?> FromItem(Dictionary<string, AttributeValue> item)
        => item.ToDictionary(k => k.Key, k => FromAv(k.Value));

    public static Dictionary<string, AttributeValue> ToItem(Dictionary<string, object?> d)
        => d.Where(k => k.Value != null).ToDictionary(k => k.Key, k => Av(k.Value));

    // ---- Operations ----

    public async Task<Dictionary<string, object?>?> GetItem(string table, Dictionary<string, AttributeValue> key)
    {
        var r = await _client.GetItemAsync(new GetItemRequest { TableName = table, Key = key });
        return r.Item?.Count > 0 ? FromItem(r.Item) : null;
    }

    public async Task PutItem(string table, Dictionary<string, object?> item)
    {
        var req = new PutItemRequest
        {
            TableName = table,
            Item = item.Where(k => k.Value != null).ToDictionary(k => k.Key, k => Av(k.Value)),
        };
        await _client.PutItemAsync(req);
    }

    public async Task UpdateItem(string table, Dictionary<string, AttributeValue> key,
        string updateExpr, Dictionary<string, string>? nameMap, Dictionary<string, AttributeValue> values,
        string? conditionExpr = null)
    {
        var req = new UpdateItemRequest
        {
            TableName = table,
            Key = key,
            UpdateExpression = updateExpr,
            ExpressionAttributeValues = values,
        };
        if (nameMap?.Count > 0) req.ExpressionAttributeNames = nameMap;
        if (conditionExpr != null) req.ConditionExpression = conditionExpr;
        await _client.UpdateItemAsync(req);
    }

    public async Task<List<Dictionary<string, object?>>> Scan(string table,
        string? filterExpr = null,
        Dictionary<string, string>? nameMap = null,
        Dictionary<string, AttributeValue>? values = null)
    {
        var result = new List<Dictionary<string, object?>>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var req = new ScanRequest { TableName = table, ExclusiveStartKey = lastKey };
            if (filterExpr != null) req.FilterExpression = filterExpr;
            if (nameMap?.Count > 0) req.ExpressionAttributeNames = nameMap;
            if (values?.Count > 0) req.ExpressionAttributeValues = values;
            var r = await _client.ScanAsync(req);
            result.AddRange(r.Items.Select(FromItem));
            lastKey = r.LastEvaluatedKey?.Count > 0 ? r.LastEvaluatedKey : null;
        } while (lastKey != null);
        return result;
    }

    public async Task<List<Dictionary<string, object?>>> Query(string table,
        string keyExpr, Dictionary<string, AttributeValue> values,
        string? indexName = null, bool scanForward = true, int? limit = null)
    {
        var result = new List<Dictionary<string, object?>>();
        Dictionary<string, AttributeValue>? lastKey = null;
        do
        {
            var req = new QueryRequest
            {
                TableName = table,
                KeyConditionExpression = keyExpr,
                ExpressionAttributeValues = values,
                ScanIndexForward = scanForward,
                ExclusiveStartKey = lastKey,
            };
            if (indexName != null) req.IndexName = indexName;
            if (limit.HasValue) req.Limit = limit.Value;
            var r = await _client.QueryAsync(req);
            result.AddRange(r.Items.Select(FromItem));
            lastKey = r.LastEvaluatedKey?.Count > 0 ? r.LastEvaluatedKey : null;
            if (limit.HasValue) break; // with limit, stop after first page
        } while (lastKey != null);
        return result;
    }

    public void Dispose() => _client.Dispose();
}
