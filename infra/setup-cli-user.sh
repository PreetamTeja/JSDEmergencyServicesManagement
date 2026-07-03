#!/usr/bin/env bash
# =====================================================================
# setup-cli-user.sh — Creates a dedicated IAM user scoped to this
# project (not root, not a blanket admin) for local AWS CLI access.
#
# Replaces the Identity Center/SSO approach: this AWS account runs
# Identity Center in "account instance" mode, which doesn't support
# Permission Sets — so we use a plain scoped IAM user + access key
# instead. Less "expires on its own" than SSO, but still far more
# limited than root, and works immediately with no Organizations setup.
#
# Run once from CloudShell (uses the same policy file as the SSO
# attempt — upload sso-permission-set-policy.json alongside this):
#
#   ./setup-cli-user.sh
#
# Safe to rerun — reuses the user if it already exists. Prints a NEW
# access key each run only if one doesn't already exist (IAM caps
# users at 2 active keys; rerunning won't create duplicates).
# =====================================================================
set -euo pipefail

USER_NAME="${USER_NAME:-preetam-cli}"
POLICY_FILE="${POLICY_FILE:-sso-permission-set-policy.json}"
POLICY_NAME="${POLICY_NAME:-psiog-deploy}"

[ -f "$POLICY_FILE" ] || { echo "ERROR: $POLICY_FILE not found. Upload it alongside this script."; exit 1; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account=${ACCOUNT}  User=${USER_NAME}"

# ---- 1) create (or reuse) the user ----
if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  echo "Reusing existing user ${USER_NAME}"
else
  echo "Creating user ${USER_NAME}..."
  aws iam create-user --user-name "$USER_NAME" >/dev/null
fi

# ---- 2) attach the scoped policy as a MANAGED policy, not inline ----
# Inline user policies cap at 2048 bytes; this project's policy already
# outgrew that. Managed policies allow up to 6144 bytes and are easier to
# version (each update creates a new policy version instead of silently
# overwriting).
MANAGED_POLICY_NAME="${POLICY_NAME}-managed"
POLICY_ARN="arn:aws:iam::${ACCOUNT}:policy/${MANAGED_POLICY_NAME}"

if aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
  echo "Updating existing managed policy ${MANAGED_POLICY_NAME}..."
  # A managed policy keeps up to 5 versions; prune the oldest non-default one
  # before adding a new one so repeated reruns don't hit that cap.
  OLD_VERSION="$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" \
    --query "Versions[?IsDefaultVersion==\`false\`] | sort_by(@, &CreateDate)[0].VersionId" --output text)"
  if [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" != "None" ]; then
    aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$OLD_VERSION" || true
  fi
  aws iam create-policy-version --policy-arn "$POLICY_ARN" --policy-document "file://${POLICY_FILE}" --set-as-default >/dev/null
else
  echo "Creating managed policy ${MANAGED_POLICY_NAME}..."
  aws iam create-policy --policy-name "$MANAGED_POLICY_NAME" --policy-document "file://${POLICY_FILE}" >/dev/null
fi

aws iam attach-user-policy --user-name "$USER_NAME" --policy-arn "$POLICY_ARN"

# Clean up the old inline policy from earlier runs of this script, if present.
aws iam delete-user-policy --user-name "$USER_NAME" --policy-name "$POLICY_NAME" 2>/dev/null || true

# ---- 3) create an access key, but only if one doesn't already exist ----
EXISTING_KEYS="$(aws iam list-access-keys --user-name "$USER_NAME" --query 'length(AccessKeyMetadata)' --output text)"
if [ "$EXISTING_KEYS" != "0" ]; then
  echo
  echo "==================================================================="
  echo "User ${USER_NAME} already has ${EXISTING_KEYS} access key(s)."
  echo "Not creating a new one (IAM caps users at 2 active keys, and the"
  echo "secret can only be shown once — at creation time). If you lost the"
  echo "secret, delete the old key and rerun this script:"
  echo "  aws iam delete-access-key --user-name ${USER_NAME} --access-key-id <id>"
  echo "==================================================================="
  exit 0
fi

echo "Creating access key..."
KEY_JSON="$(aws iam create-access-key --user-name "$USER_NAME" --output json)"
ACCESS_KEY_ID="$(echo "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessKey"]["AccessKeyId"])')"
SECRET_KEY="$(echo "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessKey"]["SecretAccessKey"])')"

echo
echo "==================================================================="
echo "Done. Save these NOW — the secret key is shown only this once:"
echo
echo "  AWS Access Key ID:     ${ACCESS_KEY_ID}"
echo "  AWS Secret Access Key: ${SECRET_KEY}"
echo
echo "On your laptop:"
echo "  aws configure --profile psiog"
echo "    AWS Access Key ID:     ${ACCESS_KEY_ID}"
echo "    AWS Secret Access Key: ${SECRET_KEY}"
echo "    Default region:        eu-west-1"
echo "    Default output format: json"
echo
echo "Then every command:  aws <cmd> --profile psiog"
echo "  (or once per terminal session: \$env:AWS_PROFILE = 'psiog')"
echo "==================================================================="
