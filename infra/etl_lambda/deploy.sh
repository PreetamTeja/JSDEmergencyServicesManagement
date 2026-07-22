#!/usr/bin/env bash
# =====================================================================
# PSIOG Analytics ETL - scheduled Lambda that keeps the Power BI S3 export
# up to date automatically.
#
# What it deploys:
#   1. An IAM role scoped to exactly what the transform needs: read the two
#      source DynamoDB tables + ReferenceData, write to the analytics S3
#      bucket/prefix.
#   2. A Python 3.12 Lambda running infra/etl_lambda/handler.py (which wraps
#      infra/etl/oltp_to_olap.py's run() — same code path as the manual
#      CloudShell/laptop run, see infra/etl/README.md).
#   3. An EventBridge (CloudWatch Events) rule on a nightly cron that
#      invokes it — Power BI's own scheduled refresh then always has
#      yesterday's live dispatches folded in, no manual step.
#
# Run in AWS CloudShell from the repo root:
#   AWS_REGION=eu-west-1 S3_BUCKET=psiog-analytics-export ./infra/etl_lambda/deploy.sh
# Re-runnable: updates function code / schedule if they already exist.
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
FN="${FN:-psiog-analytics-etl}"
ROLE="${FN}-role"
RUNTIME="python3.12"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

S3_BUCKET="${S3_BUCKET:?Set S3_BUCKET to the analytics export bucket (create it first if new: aws s3 mb s3://<name> --region $REGION)}"
S3_PREFIX="${S3_PREFIX:-analytics/dispatch}"
SYNTHETIC_TABLE="${SYNTHETIC_TABLE:-TransportRequestsHistorySynthetic}"
LIVE_TABLE="${LIVE_TABLE:-TransportRequests}"
REF_TABLE="${REF_TABLE:-ReferenceData}"
# 20:00 UTC = 01:30 IST — well after midnight IST so "yesterday" (IST) is
# always fully captured; low-traffic window for a DynamoDB full scan.
SCHEDULE="${SCHEDULE:-cron(0 20 * * ? *)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Build artifacts live under the script's own dir with plain relative
# filenames, NOT /tmp/absolute-path — the AWS CLI here runs as a native
# Windows binary, and a leading-slash path inside a file:// URI doesn't get
# MSYS/Git-Bash's usual path translation applied (it silently can't find
# the file), unlike a bare relative path resolved against the shell's cwd.
BUILD_DIR="$SCRIPT_DIR/.build"
mkdir -p "$BUILD_DIR"
ZIP_PATH="$BUILD_DIR/${FN}.zip"
POLICY_PATH="$BUILD_DIR/${FN}-policy.json"

echo "Region=${REGION}  Function=${FN}  Account=${ACCOUNT}  Bucket=${S3_BUCKET}/${S3_PREFIX}"

# ---- 1) IAM role ----
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "Creating role ${ROLE}"
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
fi

cat > "$POLICY_PATH" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Scan", "dynamodb:Query"],
      "Resource": [
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${SYNTHETIC_TABLE}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${LIVE_TABLE}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${REF_TABLE}"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::${S3_BUCKET}/${S3_PREFIX}/*"
    }
  ]
}
EOF
( cd "$BUILD_DIR" && aws iam put-role-policy --role-name "$ROLE" --policy-name "${FN}-policy" --policy-document "file://$(basename "$POLICY_PATH")" )
echo "Waiting for IAM role propagation..."
sleep 8

# ---- 2) Package (handler.py + oltp_to_olap.py; boto3 ships with the
# Lambda Python runtime, no third-party deps to vendor) ----
echo "Packaging..."
rm -f "$ZIP_PATH"
# python3's zipfile module instead of a `zip` binary — not guaranteed to be
# installed (e.g. plain Git Bash on Windows has no `zip`), whereas python3
# is already a hard requirement for infra/etl/ elsewhere in this repo.
python3 - "$ZIP_PATH" "$SCRIPT_DIR/handler.py" "$SCRIPT_DIR/../etl/oltp_to_olap.py" <<'PY'
import sys, zipfile
zip_path, *files = sys.argv[1:]
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        import os
        z.write(f, os.path.basename(f))
PY

ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"
ENV_VARS="Variables={REGION=${REGION},SYNTHETIC_TABLE=${SYNTHETIC_TABLE},LIVE_TABLE=${LIVE_TABLE},S3_BUCKET=${S3_BUCKET},S3_PREFIX=${S3_PREFIX}}"
ZIP_NAME="$(basename "$ZIP_PATH")"

# ---- 3) Create or update the function ----
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  echo "Updating function code..."
  ( cd "$BUILD_DIR" && aws lambda update-function-code --function-name "$FN" --zip-file "fileb://${ZIP_NAME}" --region "$REGION" >/dev/null )
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
  echo "Updating function config..."
  aws lambda update-function-configuration --function-name "$FN" --region "$REGION" \
    --timeout 300 --memory-size 512 --environment "$ENV_VARS" >/dev/null
else
  echo "Creating function..."
  ( cd "$BUILD_DIR" && aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime "$RUNTIME" --role "$ROLE_ARN" --handler handler.handler \
    --timeout 300 --memory-size 512 --zip-file "fileb://${ZIP_NAME}" \
    --environment "$ENV_VARS" >/dev/null )
  aws lambda wait function-active --function-name "$FN" --region "$REGION"
fi

# ---- 4) EventBridge nightly schedule ----
RULE="${FN}-nightly"
echo "Creating/updating schedule ${RULE} (${SCHEDULE})..."
aws events put-rule --name "$RULE" --schedule-expression "$SCHEDULE" --region "$REGION" >/dev/null
FN_ARN="$(aws lambda get-function --function-name "$FN" --region "$REGION" --query 'Configuration.FunctionArn' --output text)"
aws events put-targets --rule "$RULE" --region "$REGION" \
  --targets "Id=1,Arn=${FN_ARN}" >/dev/null
aws lambda add-permission --function-name "$FN" --region "$REGION" \
  --statement-id "${RULE}-invoke" --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${REGION}:${ACCOUNT}:rule/${RULE}" >/dev/null 2>&1 || true

echo ""
echo "Done. ${FN} runs nightly (${SCHEDULE}) and writes to s3://${S3_BUCKET}/${S3_PREFIX}/"
echo "Test it now:  aws lambda invoke --function-name ${FN} --region ${REGION} ${FN}-out.json && cat ${FN}-out.json"
