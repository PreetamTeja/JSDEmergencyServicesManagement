#!/usr/bin/env python3
"""
OLTP -> OLAP ETL for the JSD Emergency Services dispatch data.

Two sources feed one star schema:

  1. TransportRequestsHistorySynthetic — the seeded 2010-2026 synthetic
     backstory (infra/seed-history.mjs). Gives the dashboard 16 years of
     trend/seasonality/event-window data that doesn't exist in real usage
     yet.
  2. TransportRequests — the LIVE operational table. Every real dispatch the
     app ever makes lands here; finished ones (COMPLETED/CANCELLED) are
     pulled in as genuine historical rows, `synthetic=False`. This table
     grows every day the app is used, so re-running this ETL (see the
     scheduled Lambda in infra/etl_lambda/) picks up yesterday's real
     dispatches automatically — the dashboard's data volume increases on
     its own as the app sees more use, with no manual step.

Both sources are normalized to the SAME row shape before being merged, so
every dimension/fact builder below runs once over the combined set. A
`synthetic` boolean on every fact row lets Power BI filter to "real data
only" for any chart where mixing in the seeded backstory would mislead
(e.g. anything about *current* operational performance) versus "everything"
for long-range trend charts where the seed's job — giving 16 years of shape
— is exactly the point.

Target (OLAP): a star schema — one fact table (fact_dispatch, one row per
dispatch, all the numeric measures + pickup lat/lng for point-level geo
analysis) plus a handful of dimension tables (dim_date, dim_zone,
dim_hospital, dim_vehicle, dim_case_type, dim_severity, dim_resolution,
dim_source, dim_weather, dim_event, dim_demographic) that the fact table's
foreign keys point into. dim_zone and dim_hospital carry lat/lng (pulled
live from the ReferenceData table) so Power BI's map visuals have something
to plot without a separate lookup.

Known gap between the two sources — documented, not hidden: the live table
has no false-alarm/outcome classification (the app's operational status
vocabulary is just EN_ROUTE/COMPLETED/CANCELLED, nothing richer), no
reassignment counter, and no weather/demographic capture at intake. Live
rows get a coarser `resolution_type` (Cancelled, or a kind-based "…
Completed" label) and `weather_condition`/`age_band`/`gender` of
Unknown/None. The synthetic seed keeps its richer distributions. Filter on
`synthetic` in Power BI if a specific chart needs the finer synthetic-only
breakdown.

Deliberately dependency-light: stdlib only (csv, json, boto3 for the
DynamoDB read). No pandas/pyarrow. CSV-only output; the Power BI Web
connector reads CSV directly.

Usage:
    pip install -r requirements.txt
    python oltp_to_olap.py --region eu-west-1
    python oltp_to_olap.py --upload-s3-bucket psiog-analytics-export

    # Synthetic seed only (old behavior):
    python oltp_to_olap.py --skip-live

    # Live table only (e.g. once the seed is fully superseded):
    python oltp_to_olap.py --skip-synthetic

Output: one CSV per table under --output-dir (default ./olap_export/).
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

import boto3
from boto3.dynamodb.conditions import Attr, Key

# ---------------------------------------------------------------------------
# Static fallback labels — used only if a live ReferenceData lookup fails
# (e.g. running this ETL with a reduced-scope IAM role). The live lookup
# (fetch_reference) is preferred since it can't drift out of sync with the
# app's actual reference data the way a hardcoded copy would.
# ---------------------------------------------------------------------------
ZONE_NAMES = {
    "zone-bistupur": "Bistupur", "zone-sakchi": "Sakchi", "zone-kadma": "Kadma",
    "zone-sonari": "Sonari", "zone-factory": "Factory Area",
}

HOSPITAL_NAMES = {
    "hosp-tata-steel-advanced-multi-spec": "Tata Steel Advanced Multi-Speciality",
    "hosp-subarnarekha-super-speciality-": "Subarnarekha Super Speciality",
    "hosp-sakchi-community-hospital": "Sakchi Community Hospital",
    "hosp-steel-city-general-hospital": "Steel City General Hospital",
    "hosp-foundry-area-medical-centre": "Foundry Area Medical Centre",
    "hosp-jubilee-care-hospital": "Jubilee Care Hospital",
    "hosp-jrd-family-health-clinic": "JRD Family Health Clinic",
    "hosp-iron-valley-children-s-clinic": "Iron Valley Children's Clinic",
    "hosp-millennium-women-s-care-clinic": "Millennium Women's Care Clinic",
    "hosp-township-maternity-clinic": "Township Maternity Clinic",
}

# Approximate public-holiday-ish dates already meaningful in the seed
# timeline (New Year window) — used only for the is_holiday flag on
# dim_date; not a legal holiday calendar.
HOLIDAY_MONTH_DAY = {(1, 1), (1, 2), (12, 31)}

VEHICLE_ID_RE = re.compile(r"(?:sim-veh|veh)-([a-z]+)-(fire|amb)-(\d+)")

# Live table's status vocabulary that counts as "finished" — anything else
# (EN_ROUTE, QUEUED, NO_HOSPITAL, NO_BLOODBANK, PREEMPTED) is still an
# in-flight operational record, not history yet.
FINISHED_LIVE_STATUSES = {"COMPLETED", "CANCELLED"}

# Same SLA thresholds infra/seed-history.mjs already encodes into the
# synthetic rows — reused here so a live row's sla_breach is computed on the
# identical policy, not a second, silently-different one. (Note: the app's
# own /analytics/coverage-gaps endpoint uses a different default table
# (8/15/30) for a different purpose — this ETL intentionally matches the
# *seed data's* convention so synthetic and live rows are comparable.)
SLA_THRESHOLD_MIN = {"Critical": 10, "Urgent": 15, "Normal": 20}


def num(v, default=0.0):
    """DynamoDB's boto3 resource layer returns Decimal for numbers; every
    downstream consumer here wants a plain float (csv.writer, arithmetic)."""
    if v is None:
        return default
    if isinstance(v, Decimal):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def hospital_name(hospital_id, hospital_ref):
    if not hospital_id:
        return None
    if hospital_id in hospital_ref:
        return hospital_ref[hospital_id]["name"]
    if hospital_id in HOSPITAL_NAMES:
        return HOSPITAL_NAMES[hospital_id]
    return hospital_id.replace("hosp-", "").replace("-", " ").title()


def vehicle_type_and_zone(vehicle_id):
    """(sim-veh|veh)-<zone>-<fire|amb>-<n> -> ('Fire Truck'|'Ambulance', zone_id)."""
    if not vehicle_id:
        return None, None
    m = VEHICLE_ID_RE.match(vehicle_id)
    if not m:
        return None, None
    zone_short, kind_short, _ = m.groups()
    vtype = "Fire Truck" if kind_short == "fire" else "Ambulance"
    return vtype, f"zone-{zone_short}"


def parse_iso(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Extract
# ---------------------------------------------------------------------------
def scan_table(region: str, table_name: str, filter_expr=None) -> list[dict]:
    ddb = boto3.resource("dynamodb", region_name=region)
    table = ddb.Table(table_name)
    items: list[dict] = []
    kwargs = {"FilterExpression": filter_expr} if filter_expr is not None else {}
    resp = table.scan(**kwargs)
    items.extend(resp.get("Items", []))
    while "LastEvaluatedKey" in resp:
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"], **kwargs)
        items.extend(resp.get("Items", []))
    print(f"Scanned {len(items)} items from {table_name}", file=sys.stderr)
    return items


def fetch_reference(region: str) -> tuple[dict, dict, dict]:
    """Zones, hospitals, and named locations with lat/lng, straight from the
    live ReferenceData table (PK=ZONE / PK=HOSP / PK=LOC, SK=id) — this is
    what the app itself reads, so it can't drift out of sync with reality
    the way a hardcoded copy would. The locations map is also used to fill
    in pickup lat/lng for older live records (see normalize_live_item) that
    predate a backend fix and only stored a `pickup.ref` location id, no
    coordinates. Falls back to empty dicts (callers fall back to the static
    labels above, and unresolvable pickups stay blank) if the caller's IAM
    role doesn't have access to this table."""
    try:
        ddb = boto3.resource("dynamodb", region_name=region)
        table = ddb.Table("ReferenceData")
        zones, hospitals, locations = {}, {}, {}
        for pk, target in (("ZONE", zones), ("HOSP", hospitals), ("LOC", locations)):
            resp = table.query(KeyConditionExpression=Key("PK").eq(pk))
            rows = list(resp.get("Items", []))
            while "LastEvaluatedKey" in resp:
                resp = table.query(KeyConditionExpression=Key("PK").eq(pk), ExclusiveStartKey=resp["LastEvaluatedKey"])
                rows.extend(resp.get("Items", []))
            for r in rows:
                target[r["SK"]] = {"name": r.get("name") or r["SK"], "lat": num(r.get("lat"), None), "lng": num(r.get("lng"), None)}
        print(f"Loaded {len(zones)} zones, {len(hospitals)} hospitals, {len(locations)} locations from ReferenceData", file=sys.stderr)
        return zones, hospitals, locations
    except Exception as e:  # noqa: BLE001 - best-effort, never fatal
        print(f"WARN: could not load ReferenceData ({e}) — falling back to static zone/hospital labels, no lat/lng", file=sys.stderr)
        return {}, {}, {}


def normalize_live_item(it: dict, location_ref: dict) -> dict | None:
    """Live TransportRequests EMG record -> the same row shape the synthetic
    seed rows already carry, so every downstream builder is source-agnostic.
    Returns None for records that aren't finished dispatches yet (still
    EN_ROUTE/QUEUED/etc) or aren't emergencies at all (REQ/BK entities) —
    those aren't "history" until they resolve."""
    if it.get("entity") != "EMG":
        return None
    status = it.get("status")
    if status not in FINISHED_LIVE_STATUSES:
        return None

    kind = it.get("kind") or "medical"
    severity = it.get("severity") or "Urgent"
    distance_km = num(it.get("distance_km"))
    eta_to_pickup_min = num(it.get("eta_to_pickup_min"))
    sla_threshold_min = SLA_THRESHOLD_MIN.get(severity, 15)

    cost_per_km = 145 if kind == "fire" else 62
    base_fee = 800 if kind == "fire" else 250
    kmpl = 2.6 if kind == "fire" else 7.5

    resolution_type = (
        "Cancelled" if status == "CANCELLED"
        else "Fire Response Completed" if kind == "fire"
        else "Blood Delivered" if kind == "blood"
        else "Treated & Transported"
    )

    pickup = it.get("pickup") or {}
    pickup_lat, pickup_lng = num(pickup.get("lat"), None), num(pickup.get("lng"), None)
    if pickup_lat is None and pickup.get("ref") in location_ref:
        # Older live records (before a backend fix normalized pt.Lat/Lng onto
        # every dispatch) only stored a `pickup.ref` location id, no
        # coordinates — resolve it the same way the app itself would.
        loc = location_ref[pickup["ref"]]
        pickup_lat, pickup_lng = loc.get("lat"), loc.get("lng")

    return {
        "id": it.get("id"),
        "kind": kind,
        "case_type": it.get("case_type"),
        "severity": severity,
        "pickup_zone_id": it.get("pickup_zone_id"),
        "pickup": {"lat": pickup_lat, "lng": pickup_lng},
        "hospital_id": it.get("hospital_id"),
        "assigned_vehicle_id": it.get("assigned_vehicle_id"),
        "status": status,
        "distance_km": distance_km,
        "eta_to_pickup_min": eta_to_pickup_min,
        "eta_min": num(it.get("eta_min")),
        "patients_count": int(num(it.get("patients_count"), 1)) or 1,
        "event_tag": None,
        "source": "LIVE",
        "synthetic": False,
        "created_at": it.get("created_at"),
        "completed_at": it.get("updated_at") if status == "COMPLETED" else None,
        "traffic_factor": num(it.get("traffic_factor"), 1.0),
        "resolution_type": resolution_type,
        # requester_source: the app's own `source` field already carries this
        # vocabulary (HOSPITAL/PORTAL/CONSOLE/VOICE/FIRE) — no remapping needed.
        "requester_source": it.get("source") or "CONSOLE",
        "sla_breach": eta_to_pickup_min > sla_threshold_min,
        "sla_threshold_min": sla_threshold_min,
        "cost_estimate": round(base_fee + distance_km * cost_per_km, 0),
        "fuel_used_l": round(distance_km / kmpl, 2),
        # Not tracked as a counter on live records today (a REASSIGNED audit
        # event row exists per reassignment but isn't scanned here) — real
        # gap, not a fabricated zero; a future increment could count EVT#
        # rows per PK instead.
        "reassigned_count": 0,
        "weather_condition": None,
        "age_band": None,
        "gender": None,
    }


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------
def build_dim_date(items: list[dict]) -> list[dict]:
    # A real date dimension must be a contiguous calendar — every single day
    # between the earliest and latest dispatch, including days with zero
    # activity — not just the distinct dates that happen to appear in the
    # data. Power BI's "Mark as date table" explicitly requires no gaps
    # (it powers time-intelligence DAX like SAMEPERIODLASTYEAR/DATESYTD,
    # which need to walk an unbroken day-by-day axis); a sparse table built
    # from only observed dates fails that check outright.
    seen_dates = {parse_iso(it.get("created_at")).date() for it in items if parse_iso(it.get("created_at"))}
    if not seen_dates:
        return []
    start, end = min(seen_dates), max(seen_dates)
    dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    rows = []
    for d in dates:
        dow = d.weekday()  # 0=Mon
        fiscal_year = d.year if d.month >= 4 else d.year - 1  # Apr-Mar FY
        rows.append({
            "date_key": int(d.strftime("%Y%m%d")),
            "full_date": d.isoformat(),
            "year": d.year,
            "quarter": (d.month - 1) // 3 + 1,
            "month": d.month,
            "month_name": d.strftime("%B"),
            "day": d.day,
            "day_of_week": dow,
            "day_name": d.strftime("%A"),
            "is_weekend": dow >= 5,
            "is_holiday": (d.month, d.day) in HOLIDAY_MONTH_DAY,
            "fiscal_year": f"FY{fiscal_year}-{str(fiscal_year + 1)[-2:]}",
        })
    return rows


def build_dim_zone(items: list[dict], zone_ref: dict) -> list[dict]:
    ids = sorted({it.get("pickup_zone_id") for it in items if it.get("pickup_zone_id")})
    rows = []
    for z in ids:
        ref = zone_ref.get(z, {})
        rows.append({
            "zone_id": z,
            "zone_name": ref.get("name") or ZONE_NAMES.get(z, z),
            "lat": ref.get("lat"),
            "lng": ref.get("lng"),
        })
    return rows


def build_dim_hospital(items: list[dict], hospital_ref: dict) -> list[dict]:
    ids = sorted({it.get("hospital_id") for it in items if it.get("hospital_id")})
    rows = []
    for h in ids:
        ref = hospital_ref.get(h, {})
        rows.append({
            "hospital_id": h,
            "hospital_name": hospital_name(h, hospital_ref),
            "lat": ref.get("lat"),
            "lng": ref.get("lng"),
        })
    return rows


def build_dim_vehicle(items: list[dict]) -> list[dict]:
    ids = sorted({it.get("assigned_vehicle_id") for it in items if it.get("assigned_vehicle_id")})
    rows = []
    for v in ids:
        vtype, zone_id = vehicle_type_and_zone(v)
        rows.append({"vehicle_id": v, "vehicle_type": vtype, "home_zone_id": zone_id})
    return rows


def build_simple_dim(items: list[dict], col: str, key_name: str, none_label: str) -> list[dict]:
    """One-column dims (case_type, severity, resolution_type, requester_source,
    weather_condition, event_tag) — a lookup table mainly so the fact table can
    store a short key while the dimension carries the display label, and so
    Power BI treats it as a proper dimension (with its own card/slicer) rather
    than a raw text column repeated on every fact row."""
    vals = {it.get(col) or none_label for it in items}
    ordered = sorted(vals, key=lambda x: (x == none_label, x))
    return [{key_name: v, "label": v} for v in ordered]


def build_dim_demographic(items: list[dict]) -> list[dict]:
    pairs = sorted({
        (it.get("age_band"), it.get("gender"))
        for it in items
        if it.get("kind") == "medical" and it.get("age_band") and it.get("gender")
    })
    return [{"demographic_key": i + 1, "age_band": a, "gender": g} for i, (a, g) in enumerate(pairs)]


def build_fact(items: list[dict], dim_demographic: list[dict]) -> list[dict]:
    demo_key = {(d["age_band"], d["gender"]): d["demographic_key"] for d in dim_demographic}
    rows = []
    for it in items:
        created = parse_iso(it.get("created_at"))
        completed = parse_iso(it.get("completed_at"))
        response_duration_min = (
            (completed - created).total_seconds() / 60.0
            if created and completed else None
        )
        pickup = it.get("pickup") or {}
        rows.append({
            "dispatch_id": it.get("id"),
            "date_key": int(created.strftime("%Y%m%d")) if created else None,
            "hour_of_day": created.hour if created else None,
            "kind": it.get("kind"),
            "case_type": it.get("case_type") or "N/A",
            "severity": it.get("severity") or "Unknown",
            "pickup_zone_id": it.get("pickup_zone_id"),
            "pickup_lat": pickup.get("lat"),
            "pickup_lng": pickup.get("lng"),
            "hospital_id": it.get("hospital_id"),
            "assigned_vehicle_id": it.get("assigned_vehicle_id"),
            "status": it.get("status"),
            "resolution_type": it.get("resolution_type") or "N/A",
            "requester_source": it.get("requester_source") or "Unknown",
            "weather_condition": it.get("weather_condition") or "Unknown",
            "event_tag": it.get("event_tag") or "None",
            "demographic_key": demo_key.get((it.get("age_band"), it.get("gender"))),
            "distance_km": it.get("distance_km"),
            "eta_to_pickup_min": it.get("eta_to_pickup_min"),
            "eta_min": it.get("eta_min"),
            "response_duration_min": round(response_duration_min, 2) if response_duration_min is not None else None,
            "traffic_factor": it.get("traffic_factor"),
            "sla_breach": it.get("sla_breach"),
            "sla_threshold_min": it.get("sla_threshold_min"),
            "cost_estimate": it.get("cost_estimate"),
            "fuel_used_l": it.get("fuel_used_l"),
            "reassigned_count": it.get("reassigned_count"),
            "patients_count": it.get("patients_count"),
            "synthetic": it.get("synthetic"),
        })
    return rows


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------
def write_csv(rows: list[dict], name: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{name}.csv"
    if not rows:
        path.write_text("", encoding="utf-8")
        print(f"  {name}:      0 rows -> {path.name} (empty)", file=sys.stderr)
        return path
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
    print(f"  {name}: {len(rows):>6} rows -> {path.name}", file=sys.stderr)
    return path


def upload_to_s3(paths: list[Path], bucket: str, prefix: str, region: str):
    s3 = boto3.client("s3", region_name=region)
    for p in paths:
        key = f"{prefix.rstrip('/')}/{p.name}"
        s3.upload_file(str(p), bucket, key, ExtraArgs={"ContentType": "text/csv"})
        print(f"  uploaded s3://{bucket}/{key}", file=sys.stderr)


def run(
    region: str,
    synthetic_table: str | None,
    live_table: str | None,
    out_dir: Path,
    upload_s3_bucket: str | None = None,
    s3_prefix: str = "analytics/dispatch",
) -> dict[str, int]:
    """Core ETL, importable directly (used by the scheduled Lambda handler)
    as well as by main() below. Returns row counts per table for logging."""
    items: list[dict] = []

    # Fetched once, up front: dim_zone/dim_hospital lat-lng AND (via
    # location_ref) resolving pickup coordinates for older live records that
    # only stored a `pickup.ref` — see normalize_live_item.
    zone_ref, hospital_ref, location_ref = fetch_reference(region)

    if synthetic_table:
        print(f"Extracting synthetic seed from {synthetic_table} ({region})...", file=sys.stderr)
        items.extend(scan_table(region, synthetic_table))

    if live_table:
        print(f"Extracting live dispatches from {live_table} ({region})...", file=sys.stderr)
        raw_live = scan_table(
            region, live_table,
            filter_expr=Attr("entity").eq("EMG") & Attr("status").is_in(list(FINISHED_LIVE_STATUSES)),
        )
        normalized = [normalize_live_item(it, location_ref) for it in raw_live]
        live_items = [x for x in normalized if x is not None]
        print(f"  {len(live_items)} finished live dispatches normalized", file=sys.stderr)
        items.extend(live_items)

    if not items:
        raise SystemExit("No items found in either source — nothing to ETL.")

    print("Building dimensions...", file=sys.stderr)
    dim_date = build_dim_date(items)
    dim_zone = build_dim_zone(items, zone_ref)
    dim_hospital = build_dim_hospital(items, hospital_ref)
    dim_vehicle = build_dim_vehicle(items)
    dim_case_type = build_simple_dim(items, "case_type", "case_type_key", "N/A")
    dim_severity = build_simple_dim(items, "severity", "severity_key", "Unknown")
    dim_resolution = build_simple_dim(items, "resolution_type", "resolution_key", "N/A")
    dim_source = build_simple_dim(items, "requester_source", "source_key", "Unknown")
    dim_weather = build_simple_dim(items, "weather_condition", "weather_key", "Unknown")
    dim_event = build_simple_dim(items, "event_tag", "event_key", "None")
    dim_demographic = build_dim_demographic(items)

    print("Building fact table...", file=sys.stderr)
    fact_dispatch = build_fact(items, dim_demographic)

    print(f"Writing output to {out_dir}/ ...", file=sys.stderr)
    tables = [
        ("fact_dispatch", fact_dispatch),
        ("dim_date", dim_date),
        ("dim_zone", dim_zone),
        ("dim_hospital", dim_hospital),
        ("dim_vehicle", dim_vehicle),
        ("dim_case_type", dim_case_type),
        ("dim_severity", dim_severity),
        ("dim_resolution", dim_resolution),
        ("dim_source", dim_source),
        ("dim_weather", dim_weather),
        ("dim_event", dim_event),
        ("dim_demographic", dim_demographic),
    ]
    all_paths: list[Path] = []
    counts: dict[str, int] = {}
    for name, rows in tables:
        all_paths.append(write_csv(rows, name, out_dir))
        counts[name] = len(rows)

    if upload_s3_bucket:
        print(f"Uploading to s3://{upload_s3_bucket}/{s3_prefix}/ ...", file=sys.stderr)
        upload_to_s3(all_paths, upload_s3_bucket, s3_prefix, region)

    print("Done.", file=sys.stderr)
    return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default="eu-west-1")
    ap.add_argument("--synthetic-table", default="TransportRequestsHistorySynthetic")
    ap.add_argument("--live-table", default="TransportRequests")
    ap.add_argument("--skip-synthetic", action="store_true", help="Live table only.")
    ap.add_argument("--skip-live", action="store_true", help="Synthetic seed only (old behavior).")
    ap.add_argument("--output-dir", default="./olap_export")
    ap.add_argument("--upload-s3-bucket", default=None, help="If set, also upload every CSV to this bucket.")
    ap.add_argument("--s3-prefix", default="analytics/dispatch", help="Key prefix to upload under.")
    args = ap.parse_args()

    run(
        region=args.region,
        synthetic_table=None if args.skip_synthetic else args.synthetic_table,
        live_table=None if args.skip_live else args.live_table,
        out_dir=Path(args.output_dir),
        upload_s3_bucket=args.upload_s3_bucket,
        s3_prefix=args.s3_prefix,
    )


if __name__ == "__main__":
    main()
