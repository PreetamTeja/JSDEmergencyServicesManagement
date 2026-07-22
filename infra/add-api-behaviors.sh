#!/usr/bin/env bash
# Adds CloudFront cache behaviors routing the app's authenticated API paths
# to the existing apigw-transport-api origin, so same-origin fetch() calls
# from the frontend carry the sso_session cookie (SameSite=Strict blocks it
# cross-origin). /track is deliberately excluded — it's both a public data
# endpoint and a client-side SPA route, and must keep falling through to S3
# for direct page loads.
set -euo pipefail
DIST_ID=EWDLR6UB8TKE9
REGION=eu-west-1

aws cloudfront get-distribution-config --id "$DIST_ID" --region "$REGION" > /tmp/cf-current.json
ETAG=$(jq -r '.ETag' /tmp/cf-current.json)
jq '.DistributionConfig' /tmp/cf-current.json > /tmp/cf-base.json

PATHS='["emergencies*","requests*","bookings*","powerbi*","policy*","reference*","employees*","allotments*","fuel*","fleet*","cards*","ops*","infra*","analytics*","health*"]'

jq --argjson paths "$PATHS" '
  .CacheBehaviors.Items += ($paths | map({
    "PathPattern": .,
    "TargetOriginId": "apigw-transport-api",
    "TrustedSigners": {"Enabled": false, "Quantity": 0},
    "TrustedKeyGroups": {"Enabled": false, "Quantity": 0},
    "ViewerProtocolPolicy": "https-only",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET","HEAD","OPTIONS","PUT","PATCH","POST","DELETE"],
      "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}
    },
    "SmoothStreaming": false,
    "Compress": true,
    "LambdaFunctionAssociations": {"Quantity": 0},
    "FunctionAssociations": {"Quantity": 0},
    "FieldLevelEncryptionId": "",
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  })) |
  .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
' /tmp/cf-base.json > /tmp/cf-updated.json

aws cloudfront update-distribution --id "$DIST_ID" \
  --distribution-config file:///tmp/cf-updated.json \
  --if-match "$ETAG" --region "$REGION" \
  --query 'Distribution.Status' --output text

echo "Now poll: aws cloudfront get-distribution --id $DIST_ID --region $REGION --query 'Distribution.Status' --output text"
