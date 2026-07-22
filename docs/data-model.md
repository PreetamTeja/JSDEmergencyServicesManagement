# Dispatch Data Model — reference for Power BI

This is the reference doc for the data feeding the historical/analytics side
of the app — the raw DynamoDB table shape, the derived star schema used for
BI, and exactly what ETL work has been done so far. Written ahead of the
actual Power BI build so the model is agreed before wiring up visuals.

---

## 1. Source tables (OLTP)

Two tables now feed the analytics side, both DynamoDB, region `eu-west-1`:

- **`TransportRequestsHistorySynthetic`** — the synthetic seeded 2010-2026
  backstory (below). Static; only changes if someone re-runs the seed script.
- **`TransportRequests`** — the **live operational table** the app itself
  reads/writes for real-time dispatch. Finished dispatches
  (`COMPLETED`/`CANCELLED`, `entity = EMG`) are pulled into the same star
  schema as genuine historical rows. **This table grows every day the app is
  used** — the Power BI dataset's row count increases on its own as real
  usage accumulates, via the nightly scheduled ETL Lambda (§3).

Every fact row in the merged output carries a `synthetic` flag
(`True`/`False`) so a chart can filter to real data only where that
distinction matters. See `infra/etl/README.md`'s "Known gap between the two
sources" section for exactly what's coarser on live rows (resolution-type
detail, reassignment counting, weather/demographic capture).

### `TransportRequestsHistorySynthetic` fields

As of now: **17,000 rows**, spanning **2010-01-01 to 2026-07-08**, generated
by `infra/seed-history.mjs` following a shared platform-wide historical
timeline (real calendar events: COVID waves, flood years, steel-industry
cycles, festival lulls/spikes, etc. — see that script's header comment for
the full narrative this data follows).

### Fields

| field | type | notes |
|---|---|---|
| `id` | string | PK, e.g. `SIM-003003` |
| `kind` | string | `medical` \| `fire` \| `blood` |
| `case_type` | string\|null | Cardiac/Trauma/General/Maternity/Pediatric/Respiratory (medical only) |
| `severity` | string | Critical/Urgent/Normal |
| `pickup_zone_id` | string | one of 5 zones (Bistupur, Sakchi, Kadma, Sonari, Factory Area) |
| `pickup` | map | `{ name, ref, lat, lng }` |
| `hospital_id` | string\|null | destination hospital (medical only, one of 10) |
| `assigned_vehicle_id` | string | `sim-veh-<zone>-<fire\|amb>-<n>` |
| `assigned_driver_id` | string | `sim-drv-<zone>-<n>` |
| `status` | string | `COMPLETED` \| `CANCELLED` |
| `distance_km` | number | |
| `eta_to_pickup_min` | number | estimated time to reach the scene, at dispatch |
| `eta_min` | number | estimated **total** trip duration, at dispatch |
| `patients_count` | number | usually 1, occasionally 2-3 (mass-casualty tag) |
| `event_tag` | string\|null | ties the row to a named historical window (see below) |
| `source` | string | always `SIM_SEED` (this is a fixed constant on the *raw* row — `requester_source`, below, is the real varied dimension) |
| `synthetic` | bool | always `true` |
| `created_at` | ISO datetime | dispatch timestamp |

**Added today** (previously missing — see §3, all 17,000 existing rows have
been backfilled with these):

| field | type | notes |
|---|---|---|
| `completed_at` | ISO datetime\|null | `created_at` + `eta_min` + a handover buffer; null if cancelled. Enables a **real** response-duration measure instead of only the at-dispatch estimate. |
| `traffic_factor` | number | congestion multiplier applied to this trip |
| `resolution_type` | string | outcome bucket — `Treated & Transported`, `Treated on Scene`, `False Alarm`, `Refused Transport` (medical); `Fire Extinguished`, `False Alarm`, `Assisted / No Fire Found` (fire); `Cancelled` |
| `requester_source` | string | `HOSPITAL`, `PORTAL`, `CONSOLE`, `VOICE`, `FIRE` — who/what originated the dispatch |
| `sla_breach` | bool | did `eta_to_pickup_min` exceed the severity's SLA threshold |
| `sla_threshold_min` | number | the threshold checked (10/15/20 min by severity) |
| `cost_estimate` | number | modeled operating cost (₹) |
| `fuel_used_l` | number | modeled fuel burn |
| `reassigned_count` | number | usually 0, occasionally 1-2 |
| `weather_condition` | string | e.g. `Clear`, `Heavy Rain`, `Flood`, `Foggy`, `Hot & Dry` — tied to real monsoon/flood calendar windows |
| `age_band` | string\|null | medical only, non-clinical (e.g. `26-40`) — see §4 for why this is safe |
| `gender` | string\|null | medical only — `F`/`M`/`O` |

### Known `event_tag` values

Tie rows to specific historical windows: `PORTAL_GOLIVE_MIGRATION_2010`,
`COVID_LOCKDOWN_WAVE1_2020`, `COVID_DELTA_WAVE_2021`,
`COVID_VACCINATION_DRIVE_2021`, `COVID_OMICRON_WAVE_2022`,
`MONSOON_FLOOD_EVENT`, `BHUSHAN_STEEL_TRANSFER_COHORT_2018`,
`DIWALI_FIRE_SEASON`, `NEW_YEAR_EVE`, `STEEL_CRISIS_BUDGET_TIGHTENING_2016`,
or `null`/absent for an ordinary day.

---

## 2. Derived model (OLAP): star schema

Built by `infra/etl/oltp_to_olap.py`. Full column-by-column reference,
Power BI connection steps, and example DAX are in
**[`infra/etl/README.md`](../infra/etl/README.md)** — this section is the
short version.

**`fact_dispatch`** — one row per finished dispatch from **either** source
(17,369 rows as of 2026-07-12: 17,000 synthetic + 369 live), all the measures
above plus `date_key`/`hour_of_day` (derived from `created_at`),
`response_duration_min` (derived from `created_at`/`completed_at`),
`pickup_lat`/`pickup_lng` (point-level geo — resolved from the live table's
`pickup.ref` against `ReferenceData` for older records that predate a
backend fix which now stores lat/lng directly), `demographic_key` (FK into
`dim_demographic`), and `synthetic` (source flag).

**Dimensions**: `dim_date` (1,665+ days, grows as live rows add new dates),
`dim_zone` (5, + `lat`/`lng`), `dim_hospital` (15, + `lat`/`lng`),
`dim_vehicle` (90, includes derived `vehicle_type` — both the synthetic
`sim-veh-*` and live `veh-*` id patterns), `dim_case_type`, `dim_severity`
(3), `dim_resolution`, `dim_source`, `dim_weather`, `dim_event`,
`dim_demographic` (24 age×gender combinations, synthetic rows only). Zone and
hospital coordinates are pulled live from `ReferenceData`, not hardcoded.

---

## 3. ETL work done so far

1. **Schema enrichment** — added the 12 new fact-level fields (§1, "Added
   today") to `infra/seed-history.mjs`'s row generator, so every *new* seed
   run produces them going forward.
2. **Backfill** — the 17,000 rows already in the table predated this schema.
   Wrote `infra/etl/backfill_history_columns.py`, which computes the new
   fields from each row's own existing data (deterministically, seeded per-row
   from a hash of the row's id — idempotent, safely re-runnable) and
   `UpdateItem`s them in place. Ran it for real: **17,000/17,000 rows
   backfilled**, verified afterward (dimension tables went from collapsing to
   1 row each — the "all Unknown" tell — to 5-24 rows each, matching the real
   variety the new fields should produce).
   - **Data-quality check performed**: cross-tabulated `case_type` against
     `age_band`/`gender` across all medical rows — confirmed zero
     age/case-type mismatches (e.g. no Cardiac case under 41, no Pediatric
     case outside 0-12, zero non-female Maternity rows out of ~1,500). This
     holds by construction: `age_band`/`gender` are derived *from*
     `case_type`, not drawn independently, so a mismatch isn't just unlikely,
     it's structurally impossible in this generator.
3. **ETL script** — `infra/etl/oltp_to_olap.py`, stdlib + `boto3` only (no
   pandas/pyarrow — no prebuilt wheels existed for Python 3.14 at the time
   this was built, and a dataframe library wasn't actually needed for what
   this script does). Scans the source table, builds the fact + 11 dimension
   tables, writes CSV (what Power BI's Web connector reads) for each. Run
   successfully end-to-end against the real, now-backfilled table — output
   row counts listed in §2.
4. **AI Insights page** — the app's own `/analytics/insights` endpoint and
   `AI Insights` page were extended to surface the new fields directly in the
   product (not just available for Power BI): a fleet cost & efficiency card
   (total modeled cost, fuel burned, reassignment rate, cost by kind), an
   outcome-mix breakdown (with a flagged callout if false-alarm rate runs
   high), a request-channel mix (including the voice line's share of
   dispatches), and a weather-impact table (response time and SLA compliance
   by condition, with a callout when bad weather measurably slows response).

5. **Live-table merge** — `oltp_to_olap.py` now scans both
   `TransportRequestsHistorySynthetic` and `TransportRequests` (finished
   `EMG` dispatches only), normalizes live records onto the exact same row
   shape as synthetic ones (computing `sla_breach`, `cost_estimate`,
   `fuel_used_l`, `resolution_type`, etc. from the live record's own fields,
   using the same formulas the seed script uses so both sources are
   comparable), and merges them into one `fact_dispatch`. Verified against
   real data: 369 live dispatches merged cleanly, all resolved to real
   pickup coordinates (older records that only stored a `pickup.ref` were
   resolved against `ReferenceData`, not left blank).
6. **Geo columns added** — `dim_zone`/`dim_hospital` now carry `lat`/`lng`
   (pulled live from `ReferenceData`), and `fact_dispatch` carries
   `pickup_lat`/`pickup_lng` for point-level geo analysis (ArcGIS Maps for
   Power BI, ready without any custom-visual install) — see
   `infra/etl/README.md`'s Geo analysis section.
7. **Scheduled automated refresh** — `infra/etl_lambda/` deploys the same
   transform (imports and calls `oltp_to_olap.run()`, no duplicated logic)
   as a nightly EventBridge-triggered Lambda that overwrites the S3 export.
   Combined with Power BI's own scheduled dataset refresh, the dashboard's
   data volume grows automatically as the app sees real use — no manual ETL
   run required going forward.

## 4. Not yet done

- The S3 bucket + first real upload (`oltp_to_olap.py --upload-s3-bucket
  <bucket>`, or deploy `infra/etl_lambda/` directly) hasn't been run in
  production yet — done in this repo/locally, not yet pointed at a live S3
  bucket + Power BI dataset.
- Power BI Desktop model (relationships, `dim_date` marked as date table,
  DAX measures, the geo/animated visuals documented in
  `infra/etl/README.md`) hasn't been built — this doc and the ETL README are
  the prep for that session.
- Live `reassigned_count` isn't populated from the `REASSIGNED` audit event
  rows yet (documented gap, see `infra/etl/README.md`).
