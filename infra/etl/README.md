# Dispatch Data ETL — OLTP to OLAP for Power BI

Turns the dispatch records in DynamoDB into a star schema and publishes it to
S3 for Power BI's **Web** connector. Two sources feed the same star schema:

- **`TransportRequestsHistorySynthetic`** — the seeded 2010–2026 synthetic
  backstory. Gives the dashboard 16 years of trend/seasonality/event-window
  data that doesn't exist in real usage yet.
- **`TransportRequests`** — the **live operational table**. Every real
  dispatch the app makes lands here; finished ones (`COMPLETED`/`CANCELLED`)
  are pulled in as genuine historical rows. **This table grows every day the
  app is used** — re-running the ETL picks up yesterday's real dispatches
  automatically, which is the whole point of the scheduled Lambda below: the
  Power BI dataset's volume increases on its own as the app sees more use,
  with nobody having to remember to re-export anything.

Every fact row carries a `synthetic` boolean so any chart that cares about
*only real data* (e.g. "how is the app actually performing right now") can
filter it out, while long-range trend charts can use everything.

Verified end-to-end against the real tables (2026-07): 17,000 synthetic rows
+ 369 live finished dispatches → `fact_dispatch` (17,369 rows) plus 11
dimension tables. If the synthetic table has rows from before the enrichment
columns existed, run `backfill_history_columns.py` first (see below).

Dependency-light by design: stdlib only, plus `boto3` (ships with the Lambda
Python runtime — no third-party deps to vendor for the scheduled job either).

## Why a star schema at all

The source tables are a normal OLTP shape: one flat item per dispatch, ids
instead of names, no pre-computed durations, no dimension tables. That's
correct for an application writing/reading single records fast, but it's the
wrong shape for a BI tool — every chart would otherwise have to re-derive
human-readable labels from ids at query time, there'd be no `dim_date` for
Power BI's time-intelligence functions to key off, and response duration
would get recomputed inconsistently in every visual's DAX instead of once
here.

## Schema

**`fact_dispatch`** (grain: one row per *finished* dispatch)

| column | type | notes |
|---|---|---|
| `dispatch_id` | string | PK, e.g. `EMG-12345` (live) or `SIM-003003` (synthetic) |
| `date_key` | int | FK → `dim_date.date_key`, `YYYYMMDD` |
| `hour_of_day` | int | 0–23, for intraday patterns without a time dimension |
| `kind` | string | `medical` \| `fire` \| `blood` |
| `case_type` | string | FK-ish → `dim_case_type` |
| `severity` | string | FK-ish → `dim_severity` (Critical/Urgent/Normal) |
| `pickup_zone_id` | string | FK → `dim_zone` |
| `pickup_lat` / `pickup_lng` | float | **point-level geo** — the actual scene coordinates, for map visuals finer-grained than zone centroids |
| `hospital_id` | string | FK → `dim_hospital` (null for fire/blood) |
| `assigned_vehicle_id` | string | FK → `dim_vehicle` |
| `status` | string | `COMPLETED` \| `CANCELLED` |
| `resolution_type` | string | FK-ish → `dim_resolution` — outcome bucket. Synthetic rows carry a rich breakdown (Treated & Transported / False Alarm / Refused Transport / …); live rows are coarser (no false-alarm concept in the live operational flow yet) — see "Known gap" below |
| `requester_source` | string | FK-ish → `dim_source` — who originated the dispatch (HOSPITAL/PORTAL/CONSOLE/VOICE/FIRE) |
| `weather_condition` | string | FK-ish → `dim_weather`. `Unknown` for live rows (not captured at intake) |
| `event_tag` | string\|null | FK-ish → `dim_event` — ties synthetic rows to named historical windows; always `None` for live rows |
| `demographic_key` | int\|null | FK → `dim_demographic`, synthetic medical dispatches only |
| `distance_km` | float | measure |
| `eta_to_pickup_min` | float | measure |
| `eta_min` | float | measure — total trip ETA as estimated at dispatch |
| `response_duration_min` | float\|null | measure — **actual** `completed_at - created_at`; null if cancelled |
| `traffic_factor` | float | measure — congestion multiplier applied |
| `sla_breach` | bool | measure — `eta_to_pickup_min` exceeded the severity's SLA threshold (10/15/20 min by severity, same policy for both sources) |
| `sla_threshold_min` | int | the threshold that was checked against |
| `cost_estimate` | float | measure — modeled operating cost (₹), same formula for both sources |
| `fuel_used_l` | float | measure |
| `reassigned_count` | int | measure. Always `0` for live rows today — a real gap, see below, not a fabricated zero |
| `patients_count` | int | measure |
| `synthetic` | bool | **`True`** = seeded backstory, **`False`** = a genuine live dispatch. Filter on this in Power BI wherever "real data only" matters |

**Dimensions**: `dim_date`, `dim_zone` (+ `lat`/`lng`), `dim_hospital` (+
`lat`/`lng`), `dim_vehicle`, `dim_case_type`, `dim_severity`,
`dim_resolution`, `dim_source`, `dim_weather`, `dim_event`,
`dim_demographic`. `dim_zone`/`dim_hospital` coordinates come live from the
app's own `ReferenceData` table (`fetch_reference()`), not a hardcoded copy,
so they can't drift out of sync with what's actually deployed.

### Known gap between the two sources

The live app's operational status vocabulary is just
`EN_ROUTE`/`COMPLETED`/`CANCELLED`/queue-states — there's no
false-alarm/refused-transport classification captured today, and no
per-dispatch reassignment counter. So:

- Live `resolution_type` is coarser than synthetic's (Cancelled, or a
  kind-based "… Completed" label) — the richer breakdown only exists on
  synthetic rows.
- Live `reassigned_count` is always 0. A `REASSIGNED` audit event *is*
  written per reassignment (`Function.cs`'s `PatchOpsStatus`/`EVT#` rows) but
  isn't scanned by this ETL yet — a real future increment, not implemented
  here.
- Live `weather_condition`, `age_band`, `gender` are `Unknown`/null — not
  captured at intake.

None of this is silently smoothed over — it's why `synthetic` exists as a
filterable column. A chart specifically about false-alarm rates or
demographic gaps should filter `synthetic = True`; a chart about raw
dispatch volume, response time, or geo distribution should use everything.

## Backfilling older synthetic rows

If the synthetic table has rows from before the enrichment columns existed
(tell: this ETL's dimension tables collapsing to 1 row each), run:

```bash
python backfill_history_columns.py --region eu-west-1 --table TransportRequestsHistorySynthetic --dry-run --limit 5   # sanity check first
python backfill_history_columns.py --region eu-west-1 --table TransportRequestsHistorySynthetic                       # then the real run
```

Idempotent — seeds a per-row `random.Random()` from a hash of the row's own
id, safe to re-run if interrupted.

## Running the ETL manually

```bash
cd infra/etl
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt

# Both sources merged (the default):
python oltp_to_olap.py --region eu-west-1

# Also publish to S3 for the Power BI Web connector:
python oltp_to_olap.py --upload-s3-bucket psiog-analytics-export --s3-prefix analytics/dispatch

# One source only:
python oltp_to_olap.py --skip-live         # synthetic seed only (old behavior)
python oltp_to_olap.py --skip-synthetic    # live table only
```

Needs DynamoDB `Scan`/`Query` on `TransportRequestsHistorySynthetic`,
`TransportRequests`, and `ReferenceData`, and (if uploading) `s3:PutObject`
on the target bucket.

Output lands in `./olap_export/` — one CSV per table, which is what Power
BI's Web connector reads.

## Automated daily refresh (production)

`infra/etl_lambda/` deploys the same transform as a scheduled Lambda so the
S3 export — and therefore the Power BI dataset on its own scheduled
refresh — picks up real dispatches automatically every night, with no manual
step:

```bash
cd infra
S3_BUCKET=psiog-analytics-export AWS_REGION=eu-west-1 ./etl_lambda/deploy.sh
```

This creates:

- An IAM role scoped to exactly what the transform needs (read the two
  DynamoDB source tables + `ReferenceData`, write to the S3 prefix).
- A Python 3.12 Lambda (`psiog-analytics-etl`) running
  `infra/etl_lambda/handler.py`, which just imports and calls
  `oltp_to_olap.run()` — the exact same code path as the manual run above,
  so there is one implementation of the transform, not two.
- An EventBridge rule on a nightly cron (`cron(0 20 * * ? *)` = 01:30 IST by
  default, override with `SCHEDULE=...`) that invokes it.

Re-running `deploy.sh` updates the function code/schedule in place. Test it
immediately after deploying:

```bash
aws lambda invoke --function-name psiog-analytics-etl --region eu-west-1 /tmp/out.json && cat /tmp/out.json
```

Then in Power BI: **Home → Transform data → Data source settings** (or the
dataset's settings in the Power BI service) → set a **scheduled refresh**
(e.g. daily, a couple hours after the Lambda's nightly run) so the report
picks up the new export without anyone touching it.

## Connecting Power BI

The S3 bucket is **private** (raw dispatch records — exact pickup GPS,
patient demographics — are not something to expose via a public/presigned
link). Instead, `GET /analytics/export/{table}.csv` on the existing
TransportApi Lambda streams each CSV out of S3 server-side, gated by a
dedicated `POWERBI` API key — revocable instantly, logged like every other
request, and scoped to exactly this one endpoint rather than the whole
bucket.

**In Power BI Desktop, once per table:**

1. `Get Data → Web`
2. Paste the URL: `https://dkr9xqi0cx9b5.cloudfront.net/analytics/export/<table>.csv`
   (e.g. `.../analytics/export/fact_dispatch.csv`)
3. When prompted for credentials, choose **Web API** and paste the API key
   into the **Key** field, with header name `x-api-key` — this is entered
   directly into Power BI's own credential store, not embedded in the query.
4. Repeat for all 12 tables: `fact_dispatch`, `dim_date`, `dim_zone`,
   `dim_hospital`, `dim_vehicle`, `dim_case_type`, `dim_severity`,
   `dim_resolution`, `dim_source`, `dim_weather`, `dim_event`,
   `dim_demographic`.
5. Power Query will load each as a single unnamed column of text (CSV isn't
   auto-parsed by the Web connector) — for each query, use **Transform data**
   → `Use First Row As Headers`, then `Split Column → By Delimiter → Comma`,
   then set each column's data type (Power BI usually infers correctly, but
   double check `pickup_lat`/`pickup_lng`/date columns land as Decimal
   Number / Date, not Text).

Then `Model` view → draw the relationships:

- `fact_dispatch[date_key]` → `dim_date[date_key]` (many-to-one)
- `fact_dispatch[pickup_zone_id]` → `dim_zone[zone_id]`
- `fact_dispatch[hospital_id]` → `dim_hospital[hospital_id]`
- `fact_dispatch[assigned_vehicle_id]` → `dim_vehicle[vehicle_id]`
- `fact_dispatch[case_type]` → `dim_case_type[case_type_key]`
- `fact_dispatch[severity]` → `dim_severity[severity_key]`
- `fact_dispatch[resolution_type]` → `dim_resolution[resolution_key]`
- `fact_dispatch[requester_source]` → `dim_source[source_key]`
- `fact_dispatch[weather_condition]` → `dim_weather[weather_key]`
- `fact_dispatch[event_tag]` → `dim_event[event_key]`
- `fact_dispatch[demographic_key]` → `dim_demographic[demographic_key]`

Mark `dim_date` as a **Date Table** (Modeling → Mark as Date Table) so
time-intelligence DAX (`TOTALYTD`, `SAMEPERIODLASTYEAR`, etc.) works against
it.

---

## Complex DAX measures this schema unlocks

Basics first:

```dax
Avg Response Time (min) = AVERAGE(fact_dispatch[response_duration_min])

SLA Breach Rate =
DIVIDE(
    CALCULATE(COUNTROWS(fact_dispatch), fact_dispatch[sla_breach] = TRUE),
    COUNTROWS(fact_dispatch)
)

Cost per Dispatch = DIVIDE(SUM(fact_dispatch[cost_estimate]), COUNTROWS(fact_dispatch))

Dispatches YoY % =
VAR CurrYear = CALCULATE(COUNTROWS(fact_dispatch), DATESYTD(dim_date[full_date]))
VAR PrevYear = CALCULATE(COUNTROWS(fact_dispatch), SAMEPERIODLASTYEAR(DATESYTD(dim_date[full_date])))
RETURN DIVIDE(CurrYear - PrevYear, PrevYear)
```

Now the genuinely "complex analysis" tier — each of these earns its keep on
a dashboard rather than being a metric for its own sake:

**Rolling 30-day response time (trend without daily noise)**
```dax
Response Time 30d Rolling Avg =
AVERAGEX(
    DATESINPERIOD(dim_date[full_date], MAX(dim_date[full_date]), -30, DAY),
    CALCULATE(AVERAGE(fact_dispatch[response_duration_min]))
)
```

**Z-score anomaly flag (statistically unusual days, not just "high")**
```dax
Daily Dispatch Zscore =
VAR DailyCount = CALCULATE(COUNTROWS(fact_dispatch), ALLEXCEPT(dim_date, dim_date[full_date]))
VAR MeanCount = AVERAGEX(ALL(dim_date[full_date]), CALCULATE(COUNTROWS(fact_dispatch)))
VAR StdCount  = STDEVX.P(ALL(dim_date[full_date]), CALCULATE(COUNTROWS(fact_dispatch)))
RETURN DIVIDE(DailyCount - MeanCount, StdCount)
```
Bind this to a conditional-format rule on a calendar heatmap — days beyond
±2 std deviations light up as genuine outliers, not just "a busy Tuesday."

**Cohort-style resolution funnel (dispatch → outcome, as a %)**
```dax
Successful Outcome Rate =
VAR Successful = CALCULATE(COUNTROWS(fact_dispatch),
    fact_dispatch[resolution_type] IN {"Treated & Transported", "Treated on Scene", "Fire Extinguished", "Blood Delivered"})
RETURN DIVIDE(Successful, COUNTROWS(fact_dispatch))
```

**Cost-per-successful-outcome (the "is this money well spent" measure)**
```dax
Cost per Successful Outcome =
VAR Successful = CALCULATE(COUNTROWS(fact_dispatch),
    fact_dispatch[resolution_type] IN {"Treated & Transported", "Treated on Scene", "Fire Extinguished"})
RETURN DIVIDE(SUM(fact_dispatch[cost_estimate]), Successful)
```

**Live-vs-synthetic reality check (does the real world track the model?)**
```dax
Real Dispatch Share =
DIVIDE(
    CALCULATE(COUNTROWS(fact_dispatch), fact_dispatch[synthetic] = FALSE),
    COUNTROWS(fact_dispatch)
)

Live Avg Response vs Synthetic Baseline (%) =
VAR LiveAvg = CALCULATE(AVERAGE(fact_dispatch[response_duration_min]), fact_dispatch[synthetic] = FALSE)
VAR SynthAvg = CALCULATE(AVERAGE(fact_dispatch[response_duration_min]), fact_dispatch[synthetic] = TRUE)
RETURN DIVIDE(LiveAvg - SynthAvg, SynthAvg)
```
This is the measure that matters most once real usage builds up: it tells
you whether the app's actual field performance is tracking the modeled
baseline the synthetic seed encoded, or diverging from it — the kind of
question a purely-synthetic dashboard could never answer.

**Weighted severity-adjusted SLA score (not all breaches are equal)**
```dax
Severity-Weighted SLA Score =
VAR Weight = SWITCH(TRUE(),
    SELECTEDVALUE(fact_dispatch[severity]) = "Critical", 3,
    SELECTEDVALUE(fact_dispatch[severity]) = "Urgent", 2,
    1)
RETURN
SUMX(fact_dispatch, IF(fact_dispatch[sla_breach], -1, 1) * Weight) / SUMX(fact_dispatch, Weight)
```
Ranges -1 (every breach was Critical) to +1 (everything on time) — a single
number for a KPI tile that a raw breach-percentage can't express, since it
weights a breached Critical call far worse than a breached Normal one.

---

## Geo analysis

The schema now carries three levels of geo granularity, from coarse to
precise:

1. **Zone-level** (`dim_zone.lat`/`lng`) — 5 points, good for a simple bubble
   map sized by dispatch count.
2. **Hospital-level** (`dim_hospital.lat`/`lng`) — for a hospital-load map
   (bubble size = dispatches received, color = avg response time).
3. **Point-level** (`fact_dispatch.pickup_lat`/`pickup_lng`) — the actual
   scene of every dispatch. This is the one that unlocks real spatial
   analysis rather than "which zone had more calls."

Recommended visuals, in order of how much this data supports:

- **Filled Map / Shape Map** on `pickup_zone_id`, colored by
  `[SLA Breach Rate]` — the zone-level coverage-gap view, built-in, no
  marketplace visual needed.
- **ArcGIS Maps for Power BI** (built-in, no install) on
  `pickup_lat`/`pickup_lng` — a true point-density heatmap of where
  emergencies actually happen across Jamshedpur, independent of the 5
  administrative zone boundaries. This is the chart that would show, e.g., a
  genuine hotspot straddling two zones that zone-level analysis would split
  and hide.
- **Azure Maps visual** — same point data, if you want drive-time isochrones
  around each hospital/fire station (relevant to the "what's actually
  reachable in N minutes" question, which a straight-line zone map can't
  answer).
- A **flow map** (custom visual: "Flow Map" on AppSource) from
  `dim_vehicle[home_zone_id]` (origin) to `pickup_lat/lng` (destination) —
  visualizes actual unit-to-scene travel patterns, not just point density.

## Animated / "scale increase" charts

Power BI's native animation primitive is the **Play Axis** field well
(available on Scatter and, via a Line/Clustered Column combo, on some
built-in visuals):

- **Scatter chart, Play Axis = `dim_date[full_date]`, X = `distance_km`
  (avg), Y = `response_duration_min` (avg), Size = dispatch count, Legend =
  `pickup_zone_id`** — press play and watch each zone's bubble move/grow
  month by month. This is the single highest-signal animated chart this
  schema supports: it shows response quality *and* volume scaling
  simultaneously, per zone, over time.
- **Clustered column race, Play Axis = `dim_date[full_date]`, Category =
  `dim_hospital[hospital_name]`, Value = running dispatch count** — a
  genuine "bar chart race" needs a marketplace visual (**"Bar Chart Race"**
  or **"Animated Bar Chart"** on AppSource, both free) fed a `RUNNING SUM`
  measure:
  ```dax
  Running Dispatch Count =
  CALCULATE(
      COUNTROWS(fact_dispatch),
      FILTER(ALL(dim_date), dim_date[full_date] <= MAX(dim_date[full_date]))
  )
  ```
  Bind that as the race's value field, `dim_date[full_date]` as its time
  field, and hospital/zone/vehicle-type as the racing category — this is
  the "scale increase" visual: bars visibly overtake each other as real
  dispatch volume accumulates day over day, which is exactly what the
  live-table merge above is feeding.
- **KPI trend with a "since go-live" marker**: a Line chart of
  `Running Dispatch Count` (same measure) with a vertical reference line at
  the date the live table started contributing rows — visually separates
  "modeled backstory" from "the app actually running," and as the live
  Lambda keeps appending nightly, that line's slope becoming visible in real
  time is itself the growth story.
