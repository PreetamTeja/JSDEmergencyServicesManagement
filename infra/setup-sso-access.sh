#!/usr/bin/env bash
# =====================================================================
# setup-sso-access.sh — Automates the scriptable parts of IAM Identity
# Center setup for local AWS CLI access (permission set, policy, user,
# assignment). Two things AWS does NOT expose via API and must be done
# once in the console first:
#
#   1. Enable IAM Identity Center:
#        https://console.aws.amazon.com/singlesignon -> Enable
#
#   2. After this script finishes, get your AWS access portal URL from:
#        IAM Identity Center -> Settings -> AWS access portal URL
#      (needed for `aws configure sso` on your laptop)
#
# Upload BOTH this file and sso-permission-set-policy.json to CloudShell
# (same directory), then run:
#
#   USER_EMAIL=you@example.com USER_FIRST=Preetam USER_LAST=Teja \
#   ./setup-sso-access.sh
#
# Safe to rerun — reuses the permission set / user if they already exist.
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
USER_EMAIL="${USER_EMAIL:?Set USER_EMAIL to your email}"
USER_FIRST="${USER_FIRST:?Set USER_FIRST to your first name}"
USER_LAST="${USER_LAST:?Set USER_LAST to your last name}"
PERMISSION_SET_NAME="${PERMISSION_SET_NAME:-psiog-deploy}"
POLICY_FILE="${POLICY_FILE:-sso-permission-set-policy.json}"

[ -f "$POLICY_FILE" ] || { echo "ERROR: $POLICY_FILE not found. Upload it alongside this script."; exit 1; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account=${ACCOUNT}  Region=${REGION}"

# ---- 0) Identity Center must already be enabled (console-only step) ----
# --no-paginate matters here: list-instances auto-paginates, and without it
# --query prints its result once PER PAGE — the (empty) final page prints a
# literal "None" on its own line, which then gets appended into the variable.
INSTANCES_JSON="$(aws sso-admin list-instances --no-paginate --output json)"
INSTANCE_ARN="$(echo "$INSTANCES_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin)["Instances"]; print(d[0]["InstanceArn"] if d else "")')"
IDENTITY_STORE_ID="$(echo "$INSTANCES_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin)["Instances"]; print(d[0]["IdentityStoreId"] if d else "")')"
if [ -z "$INSTANCE_ARN" ] || [ "$INSTANCE_ARN" = "None" ]; then
  echo
  echo "ERROR: IAM Identity Center isn't enabled yet — this one step has no"
  echo "CLI/API equivalent. Enable it once at:"
  echo "  https://console.aws.amazon.com/singlesignon  ->  Enable"
  echo "Then re-run this script."
  exit 1
fi
echo "Identity Center instance: ${INSTANCE_ARN}"

# ---- 1) create (or reuse) the permission set ----
PS_ARN=""
for arn in $(aws sso-admin list-permission-sets --instance-arn "$INSTANCE_ARN" --query "PermissionSets[]" --output text); do
  name="$(aws sso-admin describe-permission-set --instance-arn "$INSTANCE_ARN" --permission-set-arn "$arn" --query PermissionSet.Name --output text)"
  if [ "$name" = "$PERMISSION_SET_NAME" ]; then PS_ARN="$arn"; break; fi
done

if [ -n "$PS_ARN" ]; then
  echo "Reusing permission set ${PERMISSION_SET_NAME} (${PS_ARN})"
else
  echo "Creating permission set ${PERMISSION_SET_NAME}..."
  PS_ARN="$(aws sso-admin create-permission-set \
    --instance-arn "$INSTANCE_ARN" \
    --name "$PERMISSION_SET_NAME" \
    --description "Scoped deploy + debug access for the JSD Emergency project" \
    --session-duration "PT8H" \
    --query 'PermissionSet.PermissionSetArn' --output text)"
fi

# ---- 2) attach/update the inline policy ----
echo "Attaching inline policy from ${POLICY_FILE}..."
aws sso-admin put-inline-policy-to-permission-set \
  --instance-arn "$INSTANCE_ARN" \
  --permission-set-arn "$PS_ARN" \
  --inline-policy "file://${POLICY_FILE}"

# ---- 3) create (or reuse) the user ----
USER_ID="$(aws identitystore list-users --no-paginate --identity-store-id "$IDENTITY_STORE_ID" \
  --filters "AttributePath=UserName,AttributeValue=${USER_EMAIL}" --output json \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["Users"]; print(d[0]["UserId"] if d else "")' 2>/dev/null || true)"

if [ -n "$USER_ID" ] && [ "$USER_ID" != "None" ]; then
  echo "Reusing existing user ${USER_EMAIL} (${USER_ID})"
else
  echo "Creating user ${USER_EMAIL}..."
  USER_ID="$(aws identitystore create-user \
    --identity-store-id "$IDENTITY_STORE_ID" \
    --user-name "$USER_EMAIL" \
    --name "GivenName=${USER_FIRST},FamilyName=${USER_LAST}" \
    --display-name "${USER_FIRST} ${USER_LAST}" \
    --emails "Value=${USER_EMAIL},Type=work,Primary=true" \
    --query 'UserId' --output text)"
  echo "AWS will email ${USER_EMAIL} an invite to set a password."
fi

# ---- 4) assign the user to this account with the permission set ----
echo "Assigning ${USER_EMAIL} to account ${ACCOUNT} with ${PERMISSION_SET_NAME}..."
aws sso-admin create-account-assignment \
  --instance-arn "$INSTANCE_ARN" \
  --target-id "$ACCOUNT" --target-type AWS_ACCOUNT \
  --permission-set-arn "$PS_ARN" \
  --principal-type USER --principal-id "$USER_ID" >/dev/null || true

# ---- 5) push the (re)provisioned permission set out to the account ----
aws sso-admin provision-permission-set \
  --instance-arn "$INSTANCE_ARN" \
  --permission-set-arn "$PS_ARN" \
  --target-id "$ACCOUNT" --target-type AWS_ACCOUNT >/dev/null

echo
echo "==================================================================="
echo "Done. Permission set '${PERMISSION_SET_NAME}' is created and"
echo "assigned to ${USER_EMAIL} on account ${ACCOUNT}."
echo
echo "Two manual things left (no CLI equivalent exists for either):"
echo "  1. Check ${USER_EMAIL} for AWS's invite email, set your password."
echo "  2. Grab your portal URL: IAM Identity Center -> Settings ->"
echo "     'AWS access portal URL' (looks like https://d-xxxx.awsapps.com/start)"
echo
echo "Then on your laptop:  aws configure sso"
echo "==================================================================="
