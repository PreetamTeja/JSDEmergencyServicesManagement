#!/usr/bin/env bash
# Run this yourself with an IAM identity that has dynamodb:CreateTable,
# lambda:UpdateFunctionConfiguration, and cloudfront:*Distribution* —
# the preetam-cli profile used by the assistant session does not.
set -euo pipefail

PROFILE=psiog
REGION=eu-west-1
FN_NAME=psiog-transport-api
DIST_ID=EWDLR6UB8TKE9

echo "1) Creating SsoReplayTokens table..."
aws dynamodb create-table --table-name SsoReplayTokens \
  --attribute-definitions AttributeName=jti,AttributeType=S \
  --key-schema AttributeName=jti,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --profile "$PROFILE" --region "$REGION"

aws dynamodb wait table-exists --table-name SsoReplayTokens --profile "$PROFILE" --region "$REGION"

aws dynamodb update-time-to-live --table-name SsoReplayTokens \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" \
  --profile "$PROFILE" --region "$REGION"

echo "2) Set SSO_SESSION_SECRET yourself — generate a value and merge it into"
echo "   the Lambda's existing env vars (do NOT overwrite the others):"
echo ""
echo "   aws lambda get-function-configuration --function-name $FN_NAME \\"
echo "     --profile $PROFILE --region $REGION --query 'Environment.Variables'"
echo ""
echo "   # then re-run update-function-configuration with that full map plus:"
echo "   #   SSO_SESSION_SECRET=<your own openssl rand -hex 32 output>"
echo ""

echo "3) CloudFront: add a behavior on distribution $DIST_ID routing"
echo "   /sso-callback, /api/me, /api/logout to the existing API Gateway origin."
echo "   Fetch current config first and review the diff before applying:"
echo ""
echo "   aws cloudfront get-distribution-config --id $DIST_ID \\"
echo "     --profile $PROFILE --region $REGION > /tmp/cf-config.json"
echo ""
echo "   Edit /tmp/cf-config.json: add cache behaviors for the three paths"
echo "   pointing at the API Gateway origin (same one the app already calls),"
echo "   ViewerProtocolPolicy=https-only, AllowedMethods including POST,"
echo "   then apply with the ETag from the get-distribution-config response:"
echo ""
echo "   aws cloudfront update-distribution --id $DIST_ID \\"
echo "     --distribution-config file:///tmp/cf-config.json --if-match <ETag> \\"
echo "     --profile $PROFILE --region $REGION"
