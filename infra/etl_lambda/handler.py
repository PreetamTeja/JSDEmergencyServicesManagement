"""
Scheduled Lambda: runs the same OLTP->OLAP transform as
infra/etl/oltp_to_olap.py, on a nightly EventBridge cron, and overwrites the
Power BI S3 export in place.

Why a separate deployable from infra/etl/oltp_to_olap.py rather than two
copies of the transform logic: this file just re-imports and calls run()
from the real script (bundled alongside it in the same zip — see
infra/etl_lambda/deploy.sh) so there is exactly one implementation of the
transform, tested/run the same way locally (CloudShell/laptop) and on the
schedule.

Env vars (set via the deploy script / Lambda console):
  REGION              default eu-west-1
  SYNTHETIC_TABLE      default TransportRequestsHistorySynthetic (set to "" to skip)
  LIVE_TABLE           default TransportRequests (set to "" to skip)
  S3_BUCKET            required — where the CSVs land for Power BI's Web connector
  S3_PREFIX            default analytics/dispatch
"""
import os
import sys
from pathlib import Path

# oltp_to_olap.py is bundled alongside this file in the deployed zip (see
# deploy.sh's packaging step) rather than pip-installed, so it's importable
# straight from the Lambda's own directory.
sys.path.insert(0, os.path.dirname(__file__))
from oltp_to_olap import run  # noqa: E402


def handler(event, context):
    region = os.environ.get("REGION", "eu-west-1")
    synthetic_table = os.environ.get("SYNTHETIC_TABLE", "TransportRequestsHistorySynthetic") or None
    live_table = os.environ.get("LIVE_TABLE", "TransportRequests") or None
    bucket = os.environ["S3_BUCKET"]
    prefix = os.environ.get("S3_PREFIX", "analytics/dispatch")

    # /tmp is the only writable path in a Lambda execution environment.
    out_dir = Path("/tmp/olap_export")

    counts = run(
        region=region,
        synthetic_table=synthetic_table,
        live_table=live_table,
        out_dir=out_dir,
        upload_s3_bucket=bucket,
        s3_prefix=prefix,
    )
    return {"ok": True, "row_counts": counts, "bucket": bucket, "prefix": prefix}
