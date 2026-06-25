#!/usr/bin/env bash
# =====================================================================
# Deploy the Emergency SPA to S3 + CloudFront (HTTPS).
# Run from the repo root (folder with package.json), with AWS CLI configured:
#   BUCKET=psiog-emergency-app AWS_REGION=eu-west-1 ./infra/deploy-frontend.sh
# Re-runnable: builds, syncs to S3, and invalidates the CloudFront cache.
# Prints the public HTTPS URL at the end (use it as VITE_TRANSPORT_AMBULANCE_URL).
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
BUCKET="${BUCKET:?Set BUCKET to a globally-unique S3 bucket name}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

echo "Region=${REGION}  Bucket=${BUCKET}  Account=${ACCOUNT}"

# ---- 1) build (env vars are baked in at build time; set them in .env.local first) ----
echo "Building..."
npm run build

# ---- 2) S3 bucket (private; served only via CloudFront OAC) ----
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Creating bucket ${BUCKET}"
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
fi

echo "Uploading dist/ ..."
# hashed assets: long cache; index.html: no-cache so new deploys show immediately
aws s3 sync dist/ "s3://${BUCKET}/" --delete --cache-control "public,max-age=31536000,immutable" --exclude "index.html"
aws s3 cp dist/index.html "s3://${BUCKET}/index.html" --cache-control "no-cache"

# ---- 3) CloudFront distribution (create once, reuse after) ----
DIST_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='${BUCKET}'].Id | [0]" --output text 2>/dev/null || true)"

if [ "$DIST_ID" = "None" ] || [ -z "$DIST_ID" ]; then
  echo "Creating CloudFront distribution + Origin Access Control..."
  OAC_ID="$(aws cloudfront create-origin-access-control --origin-access-control-config \
    "Name=${BUCKET}-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query 'OriginAccessControl.Id' --output text)"

  ORIGIN_DOMAIN="${BUCKET}.s3.${REGION}.amazonaws.com"
  cat > /tmp/cf.json <<JSON
{
  "CallerReference": "${BUCKET}-$(date +%s)",
  "Comment": "${BUCKET}",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": { "Quantity": 1, "Items": [ {
    "Id": "s3-${BUCKET}", "DomainName": "${ORIGIN_DOMAIN}",
    "OriginAccessControlId": "${OAC_ID}",
    "S3OriginConfig": { "OriginAccessIdentity": "" }
  } ] },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-${BUCKET}", "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true, "AllowedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] }
  },
  "CustomErrorResponses": { "Quantity": 2, "Items": [
    { "ErrorCode": 403, "ResponseCode": "200", "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 10 },
    { "ErrorCode": 404, "ResponseCode": "200", "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 10 }
  ] }
}
JSON
  CREATE="$(aws cloudfront create-distribution --distribution-config file:///tmp/cf.json)"
  DIST_ID="$(echo "$CREATE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Distribution"]["Id"])')"

  # bucket policy: allow only this CloudFront distribution to read
  aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
    \"Version\":\"2012-10-17\",\"Statement\":[{
      \"Sid\":\"AllowCloudFront\",\"Effect\":\"Allow\",
      \"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},
      \"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::${BUCKET}/*\",
      \"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::${ACCOUNT}:distribution/${DIST_ID}\"}}
    }]}"
else
  echo "Reusing CloudFront distribution ${DIST_ID}; invalidating cache..."
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
fi

DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text)"
echo
echo "==================================================================="
echo "Deployed.  https://${DOMAIN}"
echo "First-time distributions take ~5-10 min to go live."
echo "Set this in the MAIN app:  VITE_TRANSPORT_AMBULANCE_URL=https://${DOMAIN}"
echo "==================================================================="
