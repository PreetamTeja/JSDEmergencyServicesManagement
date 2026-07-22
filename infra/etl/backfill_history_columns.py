#!/usr/bin/env python3
"""
Backfills the BI-enrichment columns (completed_at, traffic_factor,
resolution_type, requester_source, sla_breach, sla_threshold_min,
cost_estimate, fuel_used_l, reassigned_count, weather_condition, age_band,
gender) onto historical dispatch rows that predate infra/seed-history.mjs's
schema enrichment.

Why this exists rather than just re-running seed-history.mjs: that script
draws from one global, sequential PRNG stream, so re-running it (even with
the same START_ID/COUNT) over id ranges seeded by an OLDER version of the
generator would silently regenerate the whole row (different case mix,
different event tags, different everything) — not just add the new columns.
This script instead computes every new field FROM the row's own existing
data (kind, case_type, distance_km, eta_min, status, created_at, severity),
seeding a per-row random.Random() from a stable hash of the row's id — so
re-running this script twice on the same data produces identical output
(idempotent), and nothing about the row's original fields is touched.

Usage:
    AWS_PROFILE=psiog python backfill_history_columns.py --region eu-west-1 \\
        --table TransportRequestsHistorySynthetic [--dry-run] [--limit 50]
"""
from __future__ import annotations

import argparse
import hashlib
import random
import sys
from datetime import datetime, timedelta
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr

ZONE_PEAK_HOUR = {
    "zone-bistupur": 9, "zone-sakchi": 18, "zone-kadma": 13, "zone-sonari": 22, "zone-factory": 8,
}

# Same flood windows as seed-history.mjs, for weather_condition.
FLOOD_WINDOWS = {(2017, 8), (2019, 9), (2023, 8)}


def item_rng(item_id: str) -> random.Random:
    """Deterministic per-row RNG so re-running this script is idempotent."""
    h = hashlib.sha256(item_id.encode()).hexdigest()
    return random.Random(int(h[:16], 16))


def weighted_pick(rng: random.Random, pairs: list[tuple[str, float]]) -> str:
    total = sum(w for _, w in pairs)
    r = rng.random() * total
    upto = 0.0
    for val, w in pairs:
        upto += w
        if r <= upto:
            return val
    return pairs[-1][0]


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def congestion_factor_for(created: datetime, zone_id: str | None) -> float:
    """Reconstructs an approximate congestion multiplier from the hour of day
    relative to the zone's peak hour — a lighter version of the seed script's
    congestionFactor(year), since we don't need year-level policy tightening
    here, just enough variance for a believable traffic_factor measure."""
    peak = ZONE_PEAK_HOUR.get(zone_id, 12)
    near_peak = abs(created.hour - peak) <= 1
    return 1.3 if near_peak else 1.0


def compute_new_fields(item: dict) -> dict:
    rng = item_rng(str(item.get("id", "")))
    kind = item.get("kind")
    status = item.get("status")
    severity = item.get("severity")
    case_type = item.get("case_type")
    hospital_id = item.get("hospital_id")
    distance_km = float(item.get("distance_km") or 0)
    eta_min = float(item.get("eta_min") or 0)
    eta_to_pickup_min = float(item.get("eta_to_pickup_min") or 0)
    created = parse_iso(item.get("created_at"))
    zone_id = item.get("pickup_zone_id")

    fields: dict = {}

    # completed_at: created_at + total ETA + a small handover buffer, only
    # for completed trips (mirrors seed-history.mjs's own logic).
    if status == "COMPLETED" and created:
        handover_min = 4 + rng.random() * 12
        fields["completed_at"] = (created + timedelta(minutes=eta_min + handover_min)).isoformat().replace("+00:00", "Z")
    else:
        fields["completed_at"] = None

    # traffic_factor: reconstructed from time-of-day vs zone peak hour.
    fields["traffic_factor"] = Decimal(str(round(congestion_factor_for(created, zone_id) if created else 1.0, 2)))

    # resolution_type
    if status == "CANCELLED":
        fields["resolution_type"] = "Cancelled"
    elif kind == "fire":
        fields["resolution_type"] = weighted_pick(rng, [
            ("Fire Extinguished", 60), ("False Alarm", 15), ("Assisted / No Fire Found", 25),
        ])
    elif hospital_id:
        fields["resolution_type"] = weighted_pick(rng, [
            ("Treated & Transported", 78), ("Treated on Scene", 14), ("False Alarm", 8),
        ])
    else:
        fields["resolution_type"] = weighted_pick(rng, [
            ("Treated on Scene", 55), ("False Alarm", 20), ("Refused Transport", 25),
        ])

    # requester_source
    fields["requester_source"] = (
        weighted_pick(rng, [("FIRE", 70), ("CONSOLE", 20), ("PORTAL", 10)]) if kind == "fire"
        else weighted_pick(rng, [("HOSPITAL", 40), ("PORTAL", 30), ("CONSOLE", 20), ("VOICE", 10)])
    )

    # sla_breach / sla_threshold_min — deterministic, no randomness needed.
    threshold = 10 if severity == "Critical" else 15 if severity == "Urgent" else 20
    fields["sla_threshold_min"] = threshold
    fields["sla_breach"] = eta_to_pickup_min > threshold

    # cost_estimate / fuel_used_l
    cost_per_km = 145 if kind == "fire" else 62
    base_fee = 800 if kind == "fire" else 250
    fields["cost_estimate"] = round(base_fee + distance_km * cost_per_km * (0.85 + rng.random() * 0.3))
    kmpl = 2.6 if kind == "fire" else 7.5
    fields["fuel_used_l"] = Decimal(str(round(distance_km / kmpl, 2))) if kmpl else None

    # reassigned_count
    fields["reassigned_count"] = 1 + (1 if rng.random() < 0.15 else 0) if rng.random() < 0.05 else 0

    # weather_condition
    if created:
        ym = (created.year, created.month)
        is_monsoon = created.month in (6, 7, 8, 9)
        if ym in FLOOD_WINDOWS:
            fields["weather_condition"] = "Flood"
        elif is_monsoon:
            fields["weather_condition"] = weighted_pick(rng, [("Heavy Rain", 40), ("Light Rain", 35), ("Overcast", 25)])
        elif created.month in (12, 1, 2):
            fields["weather_condition"] = weighted_pick(rng, [("Foggy", 30), ("Cold & Clear", 50), ("Clear", 20)])
        elif created.month in (3, 4, 5):
            fields["weather_condition"] = weighted_pick(rng, [("Hot & Dry", 55), ("Clear", 35), ("Hazy", 10)])
        else:
            fields["weather_condition"] = weighted_pick(rng, [("Clear", 60), ("Hazy", 25), ("Overcast", 15)])
    else:
        fields["weather_condition"] = "Unknown"

    # age_band / gender — medical only, non-clinical.
    if kind == "medical":
        if case_type == "Pediatric":
            fields["age_band"] = weighted_pick(rng, [("0-5", 55), ("6-12", 45)])
        elif case_type == "Maternity":
            fields["age_band"] = weighted_pick(rng, [("18-25", 35), ("26-35", 45), ("36-45", 20)])
        elif case_type == "Cardiac":
            fields["age_band"] = weighted_pick(rng, [("41-60", 35), ("61-75", 40), ("76+", 25)])
        else:
            fields["age_band"] = weighted_pick(rng, [("13-25", 15), ("26-40", 25), ("41-60", 30), ("61-75", 20), ("76+", 10)])
        fields["gender"] = "F" if case_type == "Maternity" else weighted_pick(rng, [("F", 48), ("M", 50), ("O", 2)])
    else:
        fields["age_band"] = None
        fields["gender"] = None

    return fields


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default="eu-west-1")
    ap.add_argument("--table", default="TransportRequestsHistorySynthetic")
    ap.add_argument("--dry-run", action="store_true", help="Compute + print, don't write.")
    ap.add_argument("--limit", type=int, default=None, help="Only process the first N rows (testing).")
    args = ap.parse_args()

    ddb = boto3.resource("dynamodb", region_name=args.region)
    table = ddb.Table(args.table)

    items: list[dict] = []
    # Only rows that haven't been backfilled yet (no resolution_type) — makes
    # this script safely re-runnable/resumable without redoing already-done
    # rows or drifting their values (idempotent seeding means it WOULD
    # produce the same values again anyway, but skipping is cheaper).
    scan_kwargs = {"FilterExpression": Attr("resolution_type").not_exists()}
    resp = table.scan(**scan_kwargs)
    items.extend(resp.get("Items", []))
    while "LastEvaluatedKey" in resp and (args.limit is None or len(items) < args.limit):
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"], **scan_kwargs)
        items.extend(resp.get("Items", []))
    if args.limit:
        items = items[: args.limit]

    print(f"{len(items)} rows need backfilling", file=sys.stderr)
    if not items:
        return

    if args.dry_run:
        for it in items[:5]:
            print(it.get("id"), compute_new_fields(it), file=sys.stderr)
        print(f"(dry run — {len(items)} rows would be updated, showing first 5)", file=sys.stderr)
        return

    done = 0
    with table.batch_writer() as batch:
        for it in items:
            new_fields = compute_new_fields(it)
            merged = {**it, **new_fields}
            batch.put_item(Item=merged)
            done += 1
            if done % 1000 == 0:
                print(f"  {done}/{len(items)}...", file=sys.stderr)
    print(f"Done. Backfilled {done} rows.", file=sys.stderr)


if __name__ == "__main__":
    main()
