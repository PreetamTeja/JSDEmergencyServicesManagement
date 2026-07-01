using Amazon.DynamoDBv2.Model;
using TransportApi;
using Xunit;

namespace TransportApi.Tests;

/// <summary>
/// Unit tests for DynamoService.FromAv and DynamoService.Av —
/// the AttributeValue ↔ plain-object conversion layer.
///
/// Key regression: M and L fields in the .NET SDK are initialized to empty
/// collections (not null), so a plain `if (av.M != null)` would always be true.
/// The production code correctly gates on `Count > 0` to distinguish an actual
/// map/list from the SDK's default empty value.
/// </summary>
public class DynamoServiceTests
{
    // ── FromAv: primitives ─────────────────────────────────────────────────

    [Fact]
    public void FromAv_Null_ReturnsNull()
    {
        var av = new AttributeValue { NULL = true };
        Assert.Null(DynamoService.FromAv(av));
    }

    [Fact]
    public void FromAv_BoolTrue_ReturnsTrue()
    {
        var av = new AttributeValue { BOOL = true, IsBOOLSet = true };
        var result = DynamoService.FromAv(av);
        Assert.IsType<bool>(result);
        Assert.True((bool)result!);
    }

    [Fact]
    public void FromAv_BoolFalse_ReturnsFalse()
    {
        var av = new AttributeValue { BOOL = false, IsBOOLSet = true };
        Assert.Equal(false, DynamoService.FromAv(av));
    }

    [Fact]
    public void FromAv_String_ReturnsString()
    {
        var av = new AttributeValue { S = "hello" };
        Assert.Equal("hello", DynamoService.FromAv(av));
    }

    [Fact]
    public void FromAv_EmptyString_ReturnsEmptyString()
    {
        var av = new AttributeValue { S = "" };
        Assert.Equal("", DynamoService.FromAv(av));
    }

    [Fact]
    public void FromAv_Number_ReturnsDouble()
    {
        var av = new AttributeValue { N = "42" };
        var result = DynamoService.FromAv(av);
        Assert.IsType<double>(result);
        Assert.Equal(42.0, (double)result!);
    }

    [Fact]
    public void FromAv_DecimalNumber_ReturnsDouble()
    {
        var av = new AttributeValue { N = "3.14159" };
        var result = DynamoService.FromAv(av);
        Assert.IsType<double>(result);
        Assert.Equal(3.14159, (double)result!, 5);
    }

    [Fact]
    public void FromAv_NegativeNumber_ReturnsDouble()
    {
        var av = new AttributeValue { N = "-7.5" };
        Assert.Equal(-7.5, (double)DynamoService.FromAv(av)!);
    }

    [Fact]
    public void FromAv_NumberThatIsNotParseable_ReturnsRawString()
    {
        // Malformed N field falls back to returning the string
        var av = new AttributeValue { N = "not-a-number" };
        Assert.Equal("not-a-number", DynamoService.FromAv(av));
    }

    // ── FromAv: Map (M) — the M/L empty-collection bug fix ───────────────

    [Fact]
    public void FromAv_EmptyMap_ReturnsNull_NotEmptyDict()
    {
        // M is initialized to an empty Dictionary<string, AttributeValue> by the SDK.
        // The bug: checking `av.M != null` would see the empty dict and try to
        // convert it, returning an empty dictionary instead of falling through.
        // The fix (Count > 0) should return null for an otherwise-empty AV.
        var av = new AttributeValue(); // M and L default to empty collections
        Assert.Null(DynamoService.FromAv(av));
    }

    [Fact]
    public void FromAv_NonEmptyMap_ReturnsDictionary()
    {
        var av = new AttributeValue
        {
            M = new Dictionary<string, AttributeValue>
            {
                ["name"] = new AttributeValue { S = "Alice" },
                ["age"]  = new AttributeValue { N = "30" },
            }
        };
        var result = DynamoService.FromAv(av) as Dictionary<string, object?>;
        Assert.NotNull(result);
        Assert.Equal("Alice", result["name"]);
        Assert.Equal(30.0, (double)result["age"]!);
    }

    [Fact]
    public void FromAv_NestedMap_ConvertsRecursively()
    {
        var inner = new AttributeValue
        {
            M = new Dictionary<string, AttributeValue>
            {
                ["city"] = new AttributeValue { S = "Jamshedpur" }
            }
        };
        var outer = new AttributeValue
        {
            M = new Dictionary<string, AttributeValue>
            {
                ["address"] = inner
            }
        };
        var result = DynamoService.FromAv(outer) as Dictionary<string, object?>;
        Assert.NotNull(result);
        var address = result["address"] as Dictionary<string, object?>;
        Assert.NotNull(address);
        Assert.Equal("Jamshedpur", address["city"]);
    }

    // ── FromAv: List (L) — the M/L empty-collection bug fix ──────────────

    [Fact]
    public void FromAv_EmptyList_ReturnsNull_NotEmptyList()
    {
        // Same empty-collection bug: L defaults to an empty list.
        // Without the Count > 0 guard, FromAv would return an empty List<object?>.
        var av = new AttributeValue(); // Both M and L default to empty
        Assert.Null(DynamoService.FromAv(av));
    }

    [Fact]
    public void FromAv_NonEmptyList_ReturnsList()
    {
        var av = new AttributeValue
        {
            L = new List<AttributeValue>
            {
                new AttributeValue { S = "first" },
                new AttributeValue { N = "2" },
                new AttributeValue { BOOL = true, IsBOOLSet = true },
            }
        };
        var result = DynamoService.FromAv(av) as List<object?>;
        Assert.NotNull(result);
        Assert.Equal(3, result.Count);
        Assert.Equal("first", result[0]);
        Assert.Equal(2.0, (double)result[1]!);
        Assert.Equal(true, result[2]);
    }

    [Fact]
    public void FromAv_ListContainingMap_ConvertsElements()
    {
        var av = new AttributeValue
        {
            L = new List<AttributeValue>
            {
                new AttributeValue
                {
                    M = new Dictionary<string, AttributeValue>
                    {
                        ["key"] = new AttributeValue { S = "value" }
                    }
                }
            }
        };
        var result = DynamoService.FromAv(av) as List<object?>;
        Assert.NotNull(result);
        var inner = result[0] as Dictionary<string, object?>;
        Assert.NotNull(inner);
        Assert.Equal("value", inner["key"]);
    }

    [Fact]
    public void FromAv_ListContainingNullAttributeValue_ConvertsToNull()
    {
        var av = new AttributeValue
        {
            L = new List<AttributeValue>
            {
                new AttributeValue { NULL = true },
                new AttributeValue { S = "after-null" },
            }
        };
        var result = DynamoService.FromAv(av) as List<object?>;
        Assert.NotNull(result);
        Assert.Null(result[0]);
        Assert.Equal("after-null", result[1]);
    }

    // ── FromAv: String Set (SS) ───────────────────────────────────────────

    [Fact]
    public void FromAv_StringSet_ReturnsList()
    {
        var av = new AttributeValue { SS = new List<string> { "a", "b", "c" } };
        var result = DynamoService.FromAv(av) as List<object?>;
        Assert.NotNull(result);
        Assert.Equal(3, result.Count);
        Assert.Contains("a", result.Cast<string>());
    }

    // ── FromAv: Number Set (NS) ───────────────────────────────────────────

    [Fact]
    public void FromAv_NumberSet_ReturnsNumericList()
    {
        var av = new AttributeValue { NS = new List<string> { "1", "2.5", "3" } };
        var result = DynamoService.FromAv(av) as List<object?>;
        Assert.NotNull(result);
        Assert.Equal(3, result.Count);
        Assert.Contains(1.0, result.Cast<double>());
        Assert.Contains(2.5, result.Cast<double>());
    }

    // ── Av: round-trip ────────────────────────────────────────────────────

    [Fact]
    public void Av_Null_SetsNullFlag()
    {
        var av = DynamoService.Av(null);
        Assert.True(av.NULL);
    }

    [Fact]
    public void Av_Bool_SetsBoolField()
    {
        Assert.True(DynamoService.Av(true).BOOL);
        Assert.False(DynamoService.Av(false).BOOL);
    }

    [Fact]
    public void Av_Int_SetsNField()
    {
        Assert.Equal("42", DynamoService.Av(42).N);
    }

    [Fact]
    public void Av_Long_SetsNField()
    {
        Assert.Equal("9999999999", DynamoService.Av(9999999999L).N);
    }

    [Fact]
    public void Av_Double_SetsNField()
    {
        var av = DynamoService.Av(3.14);
        Assert.NotNull(av.N);
        Assert.Contains("3.14", av.N);
    }

    [Fact]
    public void Av_String_SetsSField()
    {
        Assert.Equal("hello", DynamoService.Av("hello").S);
    }

    [Fact]
    public void Av_Dictionary_SetsMapField()
    {
        var d = new Dictionary<string, object?> { ["k"] = "v" };
        var av = DynamoService.Av(d);
        Assert.NotNull(av.M);
        Assert.True(av.M.ContainsKey("k"));
        Assert.Equal("v", av.M["k"].S);
    }

    [Fact]
    public void Av_List_SetsListField()
    {
        var list = new List<object?> { "x", 1 };
        var av = DynamoService.Av(list);
        Assert.NotNull(av.L);
        Assert.Equal(2, av.L.Count);
        Assert.Equal("x", av.L[0].S);
        Assert.Equal("1", av.L[1].N);
    }

    // ── Round-trip: Av then FromAv ────────────────────────────────────────

    [Theory]
    [InlineData("hello world")]
    [InlineData("")]
    [InlineData("unicode: 🚑")]
    public void RoundTrip_String(string s)
    {
        Assert.Equal(s, DynamoService.FromAv(DynamoService.Av(s)));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void RoundTrip_Bool(bool b)
    {
        Assert.Equal(b, (bool)DynamoService.FromAv(DynamoService.Av(b))!);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(-100)]
    [InlineData(int.MaxValue)]
    public void RoundTrip_Int_AsDouble(int i)
    {
        var result = (double)DynamoService.FromAv(DynamoService.Av(i))!;
        Assert.Equal((double)i, result);
    }

    [Fact]
    public void RoundTrip_NestedMap()
    {
        var original = new Dictionary<string, object?>
        {
            ["severity"] = "Critical",
            ["patients"] = 3.0,
            ["active"]   = true,
            ["nested"]   = new Dictionary<string, object?>
            {
                ["zone"] = "South"
            }
        };
        var av = DynamoService.Av(original);
        var result = DynamoService.FromAv(av) as Dictionary<string, object?>;
        Assert.NotNull(result);
        Assert.Equal("Critical", result["severity"]);
        Assert.Equal(3.0, (double)result["patients"]!);
        Assert.Equal(true, result["active"]);
        var nested = result["nested"] as Dictionary<string, object?>;
        Assert.NotNull(nested);
        Assert.Equal("South", nested["zone"]);
    }

    // ── FromItem helper ───────────────────────────────────────────────────

    [Fact]
    public void FromItem_ConvertsAllAttributeValues()
    {
        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"]     = new AttributeValue { S = "EMG#emg-001" },
            ["status"] = new AttributeValue { S = "EN_ROUTE" },
            ["count"]  = new AttributeValue { N = "5" },
        };
        var result = DynamoService.FromItem(item);
        Assert.Equal("EMG#emg-001", result["PK"]);
        Assert.Equal("EN_ROUTE", result["status"]);
        Assert.Equal(5.0, (double)result["count"]!);
    }
}
