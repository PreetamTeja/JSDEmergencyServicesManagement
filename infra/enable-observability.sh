#!/usr/bin/env bash
# =====================================================================
# enable-observability.sh — One-time setup for the extended CloudWatch
# dashboard (DynamoDB metrics, Bedrock token usage, X-Ray trace
# breakdown, cost estimates).
#
# Does two things, both additive (won't touch existing permissions):
#   1. Turns on Active X-Ray tracing on both Lambdas.
#   2. Adds a new inline policy (separate from whatever's already
#      attached) granting exactly the extra permissions the enriched
#      /infra/metrics endpoint needs: X-Ray write+read, and
#      lambda:GetFunctionConfiguration (for the cost-estimate memory
#      lookup) scoped to just these two functions.
#
# Safe to rerun. Run once from AWS CloudShell:
#   ./infra/enable-observability.sh
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
TRANSPORT_FN="${TRANSPORT_FN:-psiog-transport-api}"
VOICE_FN="${VOICE_FN:-psiog-voice-agent}"
TRANSPORT_ROLE="${TRANSPORT_ROLE:-psiog-transport-api-role}"
VOICE_ROLE="${VOICE_ROLE:-psiog-voice-agent-role}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account=${ACCOUNT}  Region=${REGION}"
echo "Functions: ${TRANSPORT_FN}, ${VOICE_FN}"

# ── 1) Active X-Ray tracing on both functions ────────────────────
for FN in "$TRANSPORT_FN" "$VOICE_FN"; do
  echo "Enabling Active tracing on ${FN}..."
  aws lambda update-function-configuration \
    --function-name "$FN" \
    --tracing-config Mode=Active \
    --region "$REGION" --output text >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
done

# ── 2) Extra permissions for the TransportApi role (it's the one that
#      calls GetTraceSummaries / GetFunctionConfiguration on both) ──
echo "Attaching observability policy to ${TRANSPORT_ROLE}..."
aws iam put-role-policy \
  --role-name "$TRANSPORT_ROLE" \
  --policy-name observability-extra \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "XRayReadWrite",
      "Effect": "Allow",
      "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetTraceSummaries",
        "xray:BatchGetTraces"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ReadOwnFunctionConfig",
      "Effect": "Allow",
      "Action": "lambda:GetFunctionConfiguration",
      "Resource": [
        "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${TRANSPORT_FN}",
        "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${VOICE_FN}"
      ]
    }
  ]
}
JSON
)"

# ── 3) VoiceAgent only needs to emit its own X-Ray segments ──────
echo "Attaching X-Ray write policy to ${VOICE_ROLE}..."
aws iam put-role-policy \
  --role-name "$VOICE_ROLE" \
  --policy-name xray-write \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "XRayWrite",
      "Effect": "Allow",
      "Action": ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
      "Resource": "*"
    }]
  }'

echo
echo "==================================================================="
echo "Done. Active tracing is on for both functions, and the extra"
echo "permissions are attached (as a separate inline policy — nothing"
echo "existing was touched or removed)."
echo
echo "New data will start appearing in /infra/metrics and the Infra"
echo "Health dashboard on the NEXT request after this — X-Ray traces"
echo "need a few requests to accumulate before GetTraceSummaries has"
echo "anything to return, so the trace breakdown may be empty for the"
echo "first minute or two."
echo "==================================================================="
