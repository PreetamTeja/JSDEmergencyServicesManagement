#!/usr/bin/env bash
# =====================================================================
# setup-github-oidc.sh — One-time setup for GitHub Actions → AWS OIDC.
#
# Creates (or updates) an IAM role that GitHub Actions assumes via OIDC
# (no long-lived AWS keys stored in GitHub). The role gets permissions
# to deploy the frontend (S3 + CloudFront) and both Lambda functions.
#
# Run once from AWS CloudShell:
#   GITHUB_ORG=<your-github-username-or-org> \
#   GITHUB_REPO=<repo-name> \
#   ./infra/setup-github-oidc.sh
#
# Then copy the printed role ARN into GitHub:
#   Settings → Secrets and variables → Actions → Secrets → AWS_DEPLOY_ROLE_ARN
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
GITHUB_ORG="${GITHUB_ORG:?Set GITHUB_ORG to your GitHub username or org}"
GITHUB_REPO="${GITHUB_REPO:?Set GITHUB_REPO to your repo name (e.g. Psiog)}"
ROLE_NAME="${ROLE_NAME:-github-actions-deploy}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
OIDC_URL="https://token.actions.githubusercontent.com"
OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

echo "Account=${ACCOUNT}  Region=${REGION}"
echo "GitHub=${GITHUB_ORG}/${GITHUB_REPO}  Role=${ROLE_NAME}"

# ── 1) OIDC provider (idempotent) ────────────────────────────────
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "Creating GitHub OIDC provider..."
  aws iam create-open-id-connect-provider \
    --url "$OIDC_URL" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
    --client-id-list "sts.amazonaws.com" >/dev/null
  echo "  OIDC provider created."
else
  echo "  OIDC provider already exists."
fi

# ── 2) Trust policy — only this repo's main branch can assume the role ──
TRUST="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${OIDC_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/main"
      }
    }
  }]
}
JSON
)"

# ── 3) Create or update the role ─────────────────────────────────
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "Updating trust policy on existing role ${ROLE_NAME}..."
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "$TRUST" >/dev/null
else
  echo "Creating role ${ROLE_NAME}..."
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST" \
    --description "GitHub Actions deploy role for ${GITHUB_ORG}/${GITHUB_REPO}" >/dev/null
fi

# ── 4) Inline policy — S3 + CloudFront + Lambda ──────────────────
S3_BUCKET="${S3_BUCKET:-psiog-emergency-app}"

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name deploy-policy \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3Frontend",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${S3_BUCKET}",
        "arn:aws:s3:::${S3_BUCKET}/*"
      ]
    },
    {
      "Sid": "CloudFrontInvalidate",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "*"
    },
    {
      "Sid": "LambdaDeploy",
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunctionConfiguration",
        "lambda:PublishVersion"
      ],
      "Resource": [
        "arn:aws:lambda:${REGION}:${ACCOUNT}:function:psiog-transport-api",
        "arn:aws:lambda:${REGION}:${ACCOUNT}:function:psiog-voice-agent"
      ]
    }
  ]
}
JSON
)"

ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)"

echo
echo "==================================================================="
echo "OIDC role ready: ${ROLE_ARN}"
echo
echo "Add these to GitHub → Settings → Secrets and variables → Actions:"
echo
echo "  SECRETS:"
echo "    AWS_DEPLOY_ROLE_ARN  = ${ROLE_ARN}"
echo "    (no VITE_API_KEY needed — the browser authenticates with the Cognito JWT)"
echo
echo "  VARIABLES (not secrets — visible in logs):"
echo "    AWS_REGION                  = ${REGION}"
echo "    S3_BUCKET                   = ${S3_BUCKET}"
echo "    CLOUDFRONT_DISTRIBUTION_ID  = EWDLR6UB8TKE9"
echo "    VITE_API_URL                = https://cfnjgxlvfl.execute-api.eu-west-1.amazonaws.com"
echo "    VITE_APP_URL                = https://dkr9xqi0cx9b5.cloudfront.net"
echo "    VITE_MAIN_APP_URL           = https://d2mchs8gc8cv5v.cloudfront.net"
echo "    VITE_VOICE_URL              = https://fxxff1629a.execute-api.eu-west-1.amazonaws.com"
echo "    VITE_COGNITO_REGION         = eu-central-1"
echo "    VITE_COGNITO_USER_POOL_ID   = eu-central-1_74er6Yfnf"
echo "    VITE_COGNITO_CLIENT_ID      = 3t356v1nm5dq54kbthttjev21l"
echo "    VITE_COGNITO_DOMAIN         = https://eu-central-174er6yfnf.auth.eu-central-1.amazoncognito.com"
echo "    VITE_ADMIN_GROUPS           = transport-admin"
echo "==================================================================="
