#!/usr/bin/env bash
# =====================================================================
# Deploy the policy-sync agent (ONE Lambda): policy PDF in S3 -> Bedrock
# reads it -> updates the backend Lambda's POLICY_CONFIG automatically.
#
# Run in AWS CloudShell from the folder with policy-sync.mjs:
#   POLICY_BUCKET=psiog-policy-docs \
#   TARGET_FUNCTION=psiog-transport-api \
#   BEDROCK_MODEL_ID=eu.amazon.nova-lite-v1:0 \
#   AWS_REGION=eu-west-1 ./deploy-policy-sync.sh
#
# Prereq: enable Bedrock model access for the chosen model in the same region,
#         and create the S3 bucket (the script creates it if missing).
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
FN="${FN:-psiog-policy-sync}"
ROLE="${FN}-role"
TARGET_FUNCTION="${TARGET_FUNCTION:-psiog-transport-api}"
MODEL="${BEDROCK_MODEL_ID:-eu.amazon.nova-lite-v1:0}"
POLICY_BUCKET="${POLICY_BUCKET:?Set POLICY_BUCKET (S3 bucket for policy PDFs)}"
POLICY_KEY="${POLICY_KEY:-policy.pdf}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
TARGET_ARN="arn:aws:lambda:${REGION}:${ACCOUNT}:function:${TARGET_FUNCTION}"

echo "Region=${REGION}  Function=${FN}  Target=${TARGET_FUNCTION}  Model=${MODEL}"

# ---- bucket ----
if ! aws s3api head-bucket --bucket "$POLICY_BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then aws s3api create-bucket --bucket "$POLICY_BUCKET" --region "$REGION" >/dev/null
  else aws s3api create-bucket --bucket "$POLICY_BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null; fi
  echo "Created bucket ${POLICY_BUCKET}"
fi

# ---- IAM role ----
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Waiting for role propagation..."; sleep 12
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"

# least-privilege inline policy: Bedrock invoke, read the policy bucket, update the target Lambda only
aws iam put-role-policy --role-name "$ROLE" --policy-name policy-sync --policy-document "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"bedrock:InvokeModel\"],\"Resource\":\"*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\"],\"Resource\":\"arn:aws:s3:::${POLICY_BUCKET}/*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"lambda:GetFunctionConfiguration\",\"lambda:UpdateFunctionConfiguration\"],\"Resource\":\"${TARGET_ARN}\"}
  ]}"

# ---- package + deploy ----
rm -f /tmp/policy-sync.zip
zip -j /tmp/policy-sync.zip policy-sync.mjs >/dev/null
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --zip-file fileb:///tmp/policy-sync.zip --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
else
  aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime nodejs20.x --role "$ROLE_ARN" --handler policy-sync.handler \
    --timeout 60 --memory-size 512 --zip-file fileb:///tmp/policy-sync.zip >/dev/null
  aws lambda wait function-active --function-name "$FN" --region "$REGION"
fi

# env
cat > /tmp/psenv.json <<JSON
{"Variables":{"BEDROCK_MODEL_ID":"${MODEL}","TARGET_FUNCTION":"${TARGET_FUNCTION}","POLICY_BUCKET":"${POLICY_BUCKET}","POLICY_KEY":"${POLICY_KEY}"}}
JSON
aws lambda update-function-configuration --function-name "$FN" --region "$REGION" --environment file:///tmp/psenv.json >/dev/null
aws lambda wait function-updated --function-name "$FN" --region "$REGION"

echo
echo "==================================================================="
echo "policy-sync deployed."
echo "1) Upload your policy PDF:   aws s3 cp EMERGENCY_SERVICES_POLICY.pdf s3://${POLICY_BUCKET}/${POLICY_KEY}"
echo "2) Run the agent:            aws lambda invoke --function-name ${FN} --region ${REGION} /tmp/out.json && cat /tmp/out.json"
echo "3) Verify backend updated:   curl -s https://<api>/health  (see the \"policy\" block)"
echo "Optional: add an S3 trigger so uploads run it automatically."
echo "==================================================================="
