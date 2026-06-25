#!/usr/bin/env bash
# =====================================================================
# Create a dedicated Locations table keyed by location_id (unique PK),
# then migrate existing locations out of ReferenceData (PK="LOC").
# Run once in AWS CloudShell:  ./setup-locations-table.sh
# Re-runnable (create is skipped if the table exists; migrate upserts).
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
TABLE="${TBL_LOCATIONS:-Locations}"
REF="${TBL_REF:-ReferenceData}"

echo "Region=${REGION}  Table=${TABLE}"

# ---- 1) create table: PK location_id, GSI on zone_id ----
if ! aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "Creating ${TABLE} ..."
  aws dynamodb create-table --table-name "$TABLE" --region "$REGION" \
    --billing-mode PAY_PER_REQUEST \
    --attribute-definitions \
      AttributeName=location_id,AttributeType=S \
      AttributeName=zone_id,AttributeType=S \
    --key-schema AttributeName=location_id,KeyType=HASH \
    --global-secondary-indexes '[{
      "IndexName":"zone-index",
      "KeySchema":[{"AttributeName":"zone_id","KeyType":"HASH"},{"AttributeName":"location_id","KeyType":"RANGE"}],
      "Projection":{"ProjectionType":"ALL"}
    }]' >/dev/null
  echo "Waiting for table to become ACTIVE ..."
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
else
  echo "${TABLE} already exists; skipping create."
fi

# ---- 2) migrate existing LOC rows from ReferenceData ----
echo "Migrating locations from ${REF} (PK=LOC) ..."
LOCS="$(aws dynamodb query --table-name "$REF" --region "$REGION" \
  --key-condition-expression 'PK = :p' --expression-attribute-values '{":p":{"S":"LOC"}}' \
  --output json)"

COUNT="$(echo "$LOCS" | TABLE="$TABLE" REGION="$REGION" node -e '
const {execSync}=require("child_process");
const fs=require("fs");
const items=JSON.parse(fs.readFileSync(0,"utf8")).Items||[];
let n=0;
for(const it of items){
  const id=(it.id&&it.id.S)||(it.SK&&it.SK.S);
  if(!id) continue;
  const row={location_id:{S:id}};
  for(const k of ["name","type","zone_id"]) if(it[k]&&it[k].S) row[k]={S:it[k].S};
  for(const k of ["lat","lng"]) if(it[k]&&it[k].N) row[k]={N:it[k].N};
  if(it.parent_id&&it.parent_id.S) row.parent_id={S:it.parent_id.S};
  if(it.unit&&it.unit.S) row.unit={S:it.unit.S};
  row.active={BOOL: it.active&&typeof it.active.BOOL==="boolean" ? it.active.BOOL : true};
  fs.writeFileSync("/tmp/_loc.json", JSON.stringify(row));
  execSync(`aws dynamodb put-item --table-name ${process.env.TABLE} --region ${process.env.REGION} --item file:///tmp/_loc.json`,{stdio:"ignore"});
  n++;
}
process.stdout.write(String(n));
')"
echo "  migrated ${COUNT} locations into ${TABLE}"
echo
echo "Done. Next: redeploy the Lambda (reads from ${TABLE}) and update seeds/scripts."
