#!/usr/bin/env bash
# =====================================================================
# PSIOG Transport API - deploy single Lambda behind an HTTP API.
# Run in AWS CloudShell from the folder containing handler.mjs:
#   (put handler.mjs next to this script, or cd backend)
#   AWS_REGION=eu-west-1 ./deploy-backend.sh
# Re-runnable: updates the function code if it already exists.
# Prints the API base URL at the end (use it as VITE_API_URL).
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
FN="${FN:-psiog-transport-api}"
ROLE="${FN}-role"
RUNTIME="nodejs20.x"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
# Shared org Employees table (HR/IAM-owned). Override EMP_TABLE if the name differs.
EMP_TABLE="${EMP_TABLE:-jamshedpur-users}"
EMP_ARN="arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${EMP_TABLE}"

# ---- security config (Cognito JWT verification + CORS) ----
COGNITO_REGION="${COGNITO_REGION:-eu-central-1}"
COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-<your-cognito-user-pool-id>}"
COGNITO_CLIENT_ID="${COGNITO_CLIENT_ID:-<your-cognito-client-id>}"
ADMIN_GROUPS="${ADMIN_GROUPS:-transport-admin}"
# Lock to your CloudFront URL(s), comma-separated. Default '*' for local/dev only.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-*}"
# Policy upload -> policy-sync agent (admin uploads the policy PDF from the UI).
POLICY_BUCKET="${POLICY_BUCKET:-psiog-policy-docs}"
POLICY_SYNC_FUNCTION="${POLICY_SYNC_FUNCTION:-psiog-policy-sync}"

echo "Region=${REGION}  Function=${FN}  Account=${ACCOUNT}  EmployeesTable=${EMP_TABLE}"

# ---- 1) IAM role ----
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "Creating role ${ROLE}"
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Waiting for role propagation..."; sleep 12
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"

# DynamoDB access (re-applied every run; includes the shared Employees table, read).
aws iam put-role-policy --role-name "$ROLE" --policy-name ddb-access \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\",\"dynamodb:DeleteItem\",\"dynamodb:Query\",\"dynamodb:Scan\"],\"Resource\":[\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/TransportRequests\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/TransportRequests/index/*\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/Fleet\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/Fleet/index/*\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/ShuttleCards\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/ShuttleCards/index/*\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/ReferenceData\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/ReferenceData/index/*\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/Locations\",\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/Locations/index/*\",\"${EMP_ARN}\"]}]}"

# Policy upload: store the PDF in the policy bucket + invoke the policy-sync agent.
aws iam put-role-policy --role-name "$ROLE" --policy-name policy-upload \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\"],\"Resource\":\"arn:aws:s3:::${POLICY_BUCKET}/*\"},{\"Effect\":\"Allow\",\"Action\":[\"lambda:InvokeFunction\"],\"Resource\":\"arn:aws:lambda:${REGION}:${ACCOUNT}:function:${POLICY_SYNC_FUNCTION}\"}]}"

# Requester notifications: SMS via SNS, email via SES.
aws iam put-role-policy --role-name "$ROLE" --policy-name notifications \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["sns:Publish","ses:SendEmail"],"Resource":"*"}]}'

# CloudWatch read access for /infra/metrics (admin dashboard only — no write permissions).
aws iam put-role-policy --role-name "$ROLE" --policy-name cloudwatch-read \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudwatch:GetMetricData","cloudwatch:GetMetricStatistics","logs:FilterLogEvents","logs:GetLogEvents","logs:DescribeLogGroups"],"Resource":"*"}]}'

# ---- 2) package ----
echo "Packaging..."
rm -f /tmp/fn.zip
# handler.mjs imports ./auth.mjs — both must be in the zip.
zip -j /tmp/fn.zip handler.mjs auth.mjs >/dev/null

# ---- 3) create or update function ----
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  echo "Updating function code"
  aws lambda update-function-code --function-name "$FN" --zip-file fileb:///tmp/fn.zip --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
else
  echo "Creating function"
  aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime "$RUNTIME" --role "$ROLE_ARN" --handler handler.handler \
    --timeout 15 --memory-size 256 --zip-file fileb:///tmp/fn.zip >/dev/null
  aws lambda wait function-active --function-name "$FN" --region "$REGION"
fi
# ---- API keys: preserve existing, else generate console + hospital keys ----
EXIST_KEYS="$(aws lambda get-function-configuration --function-name "$FN" --region "$REGION" --query 'Environment.Variables.API_KEYS' --output text 2>/dev/null || true)"
if [ -z "$EXIST_KEYS" ] || [ "$EXIST_KEYS" = "None" ]; then
  CONSOLE_KEY="$(openssl rand -hex 16)"; HOSPITAL_KEY="$(openssl rand -hex 16)"; FUEL_KEY="$(openssl rand -hex 16)"
  API_KEYS_JSON="$(jq -n --arg c "$CONSOLE_KEY" --arg h "$HOSPITAL_KEY" --arg f "$FUEL_KEY" -c '{($c):"CONSOLE",($h):"HOSPITAL",($f):"FUEL"}')"
else
  API_KEYS_JSON="$EXIST_KEYS"
fi
# Set function env (Employees table + API keys + Cognito + CORS) via a JSON file (safe escaping).
# Preserve POLICY_CONFIG across redeploys so an applied policy isn't wiped.
EXIST_POLICY="$(aws lambda get-function-configuration --function-name "$FN" --region "$REGION" --query 'Environment.Variables.POLICY_CONFIG' --output text 2>/dev/null || true)"
[ "$EXIST_POLICY" = "None" ] && EXIST_POLICY=""
# Power BI service principal (App-owns-data). Prefer a value exported in this shell,
# otherwise keep whatever is already set on the function (so secrets persist).
for V in PBI_TENANT_ID PBI_CLIENT_ID PBI_CLIENT_SECRET PBI_WORKSPACE_ID PBI_REPORT_ID SES_FROM APP_BASE_URL; do
  CUR="$(aws lambda get-function-configuration --function-name "$FN" --region "$REGION" --query "Environment.Variables.$V" --output text 2>/dev/null || true)"
  [ "$CUR" = "None" ] && CUR=""
  eval "export $V=\"\${$V:-$CUR}\""
done
jq -n --arg emp "$EMP_TABLE" --arg keys "$API_KEYS_JSON" \
  --arg cr "$COGNITO_REGION" --arg cp "$COGNITO_USER_POOL_ID" --arg cc "$COGNITO_CLIENT_ID" \
  --arg ag "$ADMIN_GROUPS" --arg ao "$ALLOWED_ORIGINS" \
  --arg pb "$POLICY_BUCKET" --arg pf "$POLICY_SYNC_FUNCTION" --arg pc "$EXIST_POLICY" \
  --arg pt "$PBI_TENANT_ID" --arg pci "$PBI_CLIENT_ID" --arg pcs "$PBI_CLIENT_SECRET" --arg pw "$PBI_WORKSPACE_ID" --arg pr "$PBI_REPORT_ID" \
  --arg sf "${SES_FROM:-}" --arg ab "${APP_BASE_URL:-}" \
  '{Variables:({EMP_TABLE:$emp, API_KEYS:$keys, COGNITO_REGION:$cr, COGNITO_USER_POOL_ID:$cp, COGNITO_CLIENT_ID:$cc, ADMIN_GROUPS:$ag, ALLOWED_ORIGINS:$ao, POLICY_BUCKET:$pb, POLICY_SYNC_FUNCTION:$pf}
    + (if $sf=="" then {} else {SES_FROM:$sf} end)
    + (if $ab=="" then {} else {APP_BASE_URL:$ab} end)
    + (if $pc=="" then {} else {POLICY_CONFIG:$pc} end)
    + (if $pt=="" then {} else {PBI_TENANT_ID:$pt} end)
    + (if $pci=="" then {} else {PBI_CLIENT_ID:$pci} end)
    + (if $pcs=="" then {} else {PBI_CLIENT_SECRET:$pcs} end)
    + (if $pw=="" then {} else {PBI_WORKSPACE_ID:$pw} end)
    + (if $pr=="" then {} else {PBI_REPORT_ID:$pr} end))}' > /tmp/env.json
aws lambda update-function-configuration --function-name "$FN" --region "$REGION" --environment file:///tmp/env.json >/dev/null
aws lambda wait function-updated --function-name "$FN" --region "$REGION"
FN_ARN="$(aws lambda get-function --function-name "$FN" --region "$REGION" --query Configuration.FunctionArn --output text)"

# ---- 4) HTTP API (create if missing) ----
API_ID="$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='${FN}'].ApiId | [0]" --output text)"
if [ "$API_ID" = "None" ] || [ -z "$API_ID" ]; then
  echo "Creating HTTP API"
  API_ID="$(aws apigatewayv2 create-api --name "$FN" --protocol-type HTTP \
    --target "$FN_ARN" --region "$REGION" \
    --cors-configuration AllowOrigins='*',AllowMethods='GET,POST,OPTIONS',AllowHeaders='*' \
    --query ApiId --output text)"
  # create-api with --target wires a default ANY /{proxy+} route + integration automatically
  aws lambda add-permission --function-name "$FN" --region "$REGION" \
    --statement-id apigw-invoke --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${API_ID}/*/*" >/dev/null 2>&1 || true
fi

# ---- 5) stage throttling (rate limit) + locked CORS ----
aws apigatewayv2 update-stage --api-id "$API_ID" --stage-name '$default' --region "$REGION" \
  --default-route-settings 'ThrottlingBurstLimit=20,ThrottlingRateLimit=10' >/dev/null 2>&1 || true
if [ "$ALLOWED_ORIGINS" != "*" ]; then
  aws apigatewayv2 update-api --api-id "$API_ID" --region "$REGION" \
    --cors-configuration AllowOrigins="$ALLOWED_ORIGINS",AllowMethods='GET,POST,OPTIONS',AllowHeaders='content-type,authorization,x-api-key' >/dev/null 2>&1 || true
fi

API_URL="$(aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" --query ApiEndpoint --output text)"
echo
echo "==================================================================="
echo "API deployed (JWT auth + scoped API keys, throttled 10 rps / burst 20)."
echo "Base URL : ${API_URL}"
echo "Health   : ${API_URL}/health   (shows \"jwt\":true when JWT verification is on)"
echo
echo "Frontend .env.local needs ONLY:"
echo "  VITE_API_URL=${API_URL}"
echo "  (no VITE_API_KEY — the browser authenticates with the Cognito JWT)"
echo
echo "Server-to-server API keys (send in the 'x-api-key' header):"
echo "$API_KEYS_JSON" | jq -r 'to_entries[] | "  \(.value)\t\(.key)"'
echo
echo "Give the HOSPITAL key to the hospital team (server-side only)."
echo "Cognito: pool=${COGNITO_USER_POOL_ID} admin groups=${ADMIN_GROUPS}"
echo "Set ALLOWED_ORIGINS=https://<your-cloudfront> before a real launch (currently ${ALLOWED_ORIGINS})."
echo "==================================================================="
