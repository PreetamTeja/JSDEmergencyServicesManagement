#!/usr/bin/env bash
# =====================================================================
# Deploy the voice emergency agent Lambda (Bedrock Claude + tool-use) with a
# public Function URL. Run in AWS CloudShell from the folder with voice-agent.mjs:
#   API_BASE=https://<your-api-id>.execute-api.<region>.amazonaws.com \
#   API_KEY=<CONSOLE_API_KEY> \
#   BEDROCK_MODEL_ID=eu.amazon.nova-lite-v1:0 \
#   AWS_REGION=eu-west-1 ./deploy-voice-agent.sh
#
# Prereq: enable model access for the chosen Claude model in the Bedrock console
#         (Bedrock -> Model access) IN THE SAME REGION.
# Prints the Function URL at the end (use as VITE_VOICE_URL in the frontend).
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
FN="${FN:-psiog-voice-agent}"
ROLE="${FN}-role"
API_BASE="${API_BASE:?Set API_BASE to your emergency API base URL}"
API_KEY="${API_KEY:?Set API_KEY (a key with scope to POST /emergencies)}"
MODEL="${BEDROCK_MODEL_ID:-eu.amazon.nova-lite-v1:0}"
# Security: the voice line verifies the caller's Cognito JWT and locks CORS.
COGNITO_REGION="${COGNITO_REGION:-eu-central-1}"
COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-<your-cognito-user-pool-id>}"
COGNITO_CLIENT_ID="${COGNITO_CLIENT_ID:-<your-cognito-client-id>}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-*}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

echo "Region=${REGION}  Function=${FN}  Model=${MODEL}"

# ---- 1) IAM role: logs + Bedrock invoke ----
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Waiting for role propagation..."; sleep 12
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"
aws iam put-role-policy --role-name "$ROLE" --policy-name bedrock-invoke \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["bedrock:InvokeModel"],"Resource":"*"}]}'

# ---- 2) package — include OKF knowledge bundle ----
rm -rf /tmp/voice-pkg && mkdir /tmp/voice-pkg
cp voice-agent.mjs /tmp/voice-pkg/
# knowledge bundle: ../knowledge relative to this script (infra/voice/ -> infra/knowledge/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "${SCRIPT_DIR}/../knowledge" ]; then
  cp -r "${SCRIPT_DIR}/../knowledge" /tmp/voice-pkg/knowledge
  echo "OKF knowledge bundle included ($(find /tmp/voice-pkg/knowledge -name '*.md' | wc -l) files)"
else
  echo "Warning: knowledge bundle not found at ${SCRIPT_DIR}/../knowledge — NLU will use flat location list"
fi
rm -f /tmp/voice.zip
(cd /tmp/voice-pkg && zip -r /tmp/voice.zip .) >/dev/null

# ---- 3) create or update function ----
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --zip-file fileb:///tmp/voice.zip --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
else
  aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime nodejs20.x --role "$ROLE_ARN" --handler voice-agent.handler \
    --timeout 30 --memory-size 512 --zip-file fileb:///tmp/voice.zip >/dev/null
  aws lambda wait function-active --function-name "$FN" --region "$REGION"
fi

# env (Bedrock + downstream API key + Cognito JWT verification + CORS).
# Use a JSON file so values containing commas (e.g. ALLOWED_ORIGINS) parse correctly.
jq -n --arg ab "$API_BASE" --arg ak "$API_KEY" --arg m "$MODEL" \
  --arg cr "$COGNITO_REGION" --arg cp "$COGNITO_USER_POOL_ID" --arg cc "$COGNITO_CLIENT_ID" \
  --arg ao "$ALLOWED_ORIGINS" \
  '{Variables:{API_BASE:$ab, API_KEY:$ak, BEDROCK_MODEL_ID:$m, COGNITO_REGION:$cr, COGNITO_USER_POOL_ID:$cp, COGNITO_CLIENT_ID:$cc, ALLOWED_ORIGINS:$ao}}' > /tmp/venv.json
aws lambda update-function-configuration --function-name "$FN" --region "$REGION" --environment file:///tmp/venv.json >/dev/null
aws lambda wait function-updated --function-name "$FN" --region "$REGION"

# ---- 4) public Function URL with CORS (idempotent: create or update + permission) ----
CORS_CFG='{"AllowOrigins":["*"],"AllowMethods":["POST"],"AllowHeaders":["content-type"]}'
if aws lambda get-function-url-config --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-url-config --function-name "$FN" --region "$REGION" \
    --auth-type NONE --cors "$CORS_CFG" >/dev/null
else
  aws lambda create-function-url-config --function-name "$FN" --region "$REGION" \
    --auth-type NONE --cors "$CORS_CFG" >/dev/null
fi
# Always (re)ensure public invoke permission for the Function URL.
aws lambda add-permission --function-name "$FN" --region "$REGION" \
  --statement-id fnurl-public --action lambda:InvokeFunctionUrl \
  --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
URL="$(aws lambda get-function-url-config --function-name "$FN" --region "$REGION" --query FunctionUrl --output text)"

echo
echo "==================================================================="
echo "Voice agent deployed."
echo "Function URL : ${URL}"
echo "Set in the frontend .env.local:  VITE_VOICE_URL=${URL}"
echo "Reminder: enable Bedrock model access for ${MODEL} in region ${REGION}."
echo "==================================================================="
