#!/usr/bin/env bash
# =====================================================================
# PSIOG Transport - DynamoDB table provisioning (AWS CloudShell)
# Creates: TransportRequests, Fleet, ShuttleCards, ReferenceData
# Idempotent: skips tables that already exist; waits until ACTIVE.
# Usage:
#   chmod +x create-tables.sh
#   ./create-tables.sh                 # uses default region from CloudShell
#   AWS_REGION=ap-south-1 ./create-tables.sh
#   PREFIX=dev- ./create-tables.sh     # name tables dev-TransportRequests, etc.
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-$(aws configure get region || echo ap-south-1)}"
PREFIX="${PREFIX:-}"
BILLING="PAY_PER_REQUEST"

echo "Region : ${REGION}"
echo "Prefix : '${PREFIX}'"
echo

table_exists() {
  aws dynamodb describe-table --table-name "$1" --region "$REGION" >/dev/null 2>&1
}

wait_active() {
  echo "  waiting for $1 to become ACTIVE..."
  aws dynamodb wait table-exists --table-name "$1" --region "$REGION"
}

create() {
  local name="$1"; shift
  if table_exists "$name"; then
    echo "SKIP  ${name} (already exists)"
    return 0
  fi
  echo "CREATE ${name}"
  aws dynamodb create-table --table-name "$name" --region "$REGION" \
    --billing-mode "$BILLING" "$@" >/dev/null
  wait_active "$name"
  echo "OK    ${name}"
}

# ---------------------------------------------------------------------
# 1) TransportRequests  (requests / emergencies / bookings + audit rows)
# ---------------------------------------------------------------------
create "${PREFIX}TransportRequests" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S AttributeName=GSI2SK,AttributeType=S \
    AttributeName=GSI3PK,AttributeType=S AttributeName=GSI3SK,AttributeType=S \
    AttributeName=GSI4PK,AttributeType=S AttributeName=GSI4SK,AttributeType=S \
    AttributeName=GSI5PK,AttributeType=S AttributeName=GSI5SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    'IndexName=GSI1-extref,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=KEYS_ONLY}' \
    'IndexName=GSI2-status,KeySchema=[{AttributeName=GSI2PK,KeyType=HASH},{AttributeName=GSI2SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    'IndexName=GSI3-zone,KeySchema=[{AttributeName=GSI3PK,KeyType=HASH},{AttributeName=GSI3SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    'IndexName=GSI4-source,KeySchema=[{AttributeName=GSI4PK,KeyType=HASH},{AttributeName=GSI4SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    'IndexName=GSI5-vehicle,KeySchema=[{AttributeName=GSI5PK,KeyType=HASH},{AttributeName=GSI5SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES

# ---------------------------------------------------------------------
# 2) Fleet  (vehicles / drivers / fuel logs)
# ---------------------------------------------------------------------
create "${PREFIX}Fleet" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S AttributeName=GSI2SK,AttributeType=S \
    AttributeName=GSI3PK,AttributeType=S AttributeName=GSI3SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    'IndexName=GSI1-zoneveh,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    'IndexName=GSI2-zonedrv,KeySchema=[{AttributeName=GSI2PK,KeyType=HASH},{AttributeName=GSI2SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    'IndexName=GSI3-status,KeySchema=[{AttributeName=GSI3PK,KeyType=HASH},{AttributeName=GSI3SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES

# ---------------------------------------------------------------------
# 3) ShuttleCards  (shared cards / members / monthly counter / rides)
# ---------------------------------------------------------------------
create "${PREFIX}ShuttleCards" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    'IndexName=GSI1-emp,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}'

# ---------------------------------------------------------------------
# 4) ReferenceData  (locations / zones / hospitals / policy)
# ---------------------------------------------------------------------
create "${PREFIX}ReferenceData" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S AttributeName=GSI2SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    'IndexName=GSI1-loczone,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    'IndexName=GSI2-loctype,KeySchema=[{AttributeName=GSI2PK,KeyType=HASH},{AttributeName=GSI2SK,KeyType=RANGE}],Projection={ProjectionType=ALL}'

# NOTE: Employees come from the shared org table (EP50-EMP-TABLE-D), owned by
# HR/IAM. Transport does NOT create or own it - it is granted read access in
# deploy-backend.sh and read via the EMP_TABLE env var.

# Enable TTL on TransportRequests for archival of terminal records.
echo
echo "Enabling TTL (expires_at) on ${PREFIX}TransportRequests ..."
aws dynamodb update-time-to-live --region "$REGION" \
  --table-name "${PREFIX}TransportRequests" \
  --time-to-live-specification "Enabled=true,AttributeName=expires_at" >/dev/null 2>&1 \
  && echo "OK    TTL enabled" || echo "NOTE  TTL not set (already enabled or table updating)"

echo
echo "All tables provisioned in ${REGION}:"
aws dynamodb list-tables --region "$REGION" \
  --query "TableNames[?contains(@, 'TransportRequests') || contains(@, 'Fleet') || contains(@, 'ShuttleCards') || contains(@, 'ReferenceData')]" \
  --output table
