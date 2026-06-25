#!/usr/bin/env bash
# =====================================================================
# Seed blood banks as location rows in ReferenceData (PK="LOC", SK=<id>),
# one per zone. Each row gets type="bloodbank" so it shows up as a blood-run
# destination. Zone is auto-resolved from the nearest ZONE (haversine).
#
# (Locations live in ReferenceData under PK="LOC" — there is no separate
#  Locations table in this account.)
#
# Run in AWS CloudShell from the infra/ folder:
#   chmod +x seed-bloodbanks.sh
#   ./seed-bloodbanks.sh            # upsert all
#   ./seed-bloodbanks.sh list       # show current blood banks
#
# Re-running is safe (same name -> same id -> upsert).
# Edit the BANKS list below to match your real blood banks / coordinates.
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
REF="${TBL_REF:-ReferenceData}"       # locations (PK=LOC) and zones (PK=ZONE) live here

# name|lat|lng   (one blood bank per zone — adjust to your real sites)
BANKS=(
  "Sakchi Blood Bank|22.7980|86.2030"
  "Bistupur Blood Bank|22.7860|86.1840"
  "Kadma Blood Bank|22.7790|86.1700"
  "Sonari Blood Bank|22.8000|86.1560"
  "Telco Blood Bank|22.8230|86.2440"
  "Mango Blood Bank|22.8330|86.2120"
  "Golmuri Blood Bank|22.8000|86.2240"
)

slug() { echo "loc-$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"; }

# nearest zone id for a lat/lng (reads ZONE rows; haversine in node)
nearest_zone() {
  local lat="$1" lng="$2" zones
  zones="$(aws dynamodb query --table-name "$REF" --region "$REGION" \
    --key-condition-expression 'PK = :p' --expression-attribute-values '{":p":{"S":"ZONE"}}' \
    --output json)"
  echo "$zones" | LAT="$lat" LNG="$lng" node -e '
    const d=JSON.parse(require("fs").readFileSync(0,"utf8")).Items||[];
    const lat=+process.env.LAT, lng=+process.env.LNG, R=6371;
    const hav=(a,b)=>{const dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180,
      la1=a.lat*Math.PI/180,la2=b.lat*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
      return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
    const z=d.map(z=>({id:z.SK.S,lat:+z.ref.M.lat.N,lng:+z.ref.M.lng.N}))
      .sort((a,b)=>hav({lat,lng},a)-hav({lat,lng},b))[0];
    process.stdout.write(z?z.id:"");'
}

if [ "${1:-}" = "list" ]; then
  aws dynamodb query --table-name "$REF" --region "$REGION" \
    --key-condition-expression 'PK = :p' \
    --filter-expression '#t = :b' \
    --expression-attribute-names '{"#t":"type"}' \
    --expression-attribute-values '{":p":{"S":"LOC"},":b":{"S":"bloodbank"}}' \
    --query 'Items[].{id:SK.S,name:name.S,zone:zone_id.S,lat:lat.N,lng:lng.N}' --output table
  exit 0
fi

echo "Seeding ${#BANKS[@]} blood banks into '${REF}' (PK=LOC, ${REGION})..."
for row in "${BANKS[@]}"; do
  IFS='|' read -r name lat lng <<< "$row"
  id="$(slug "$name")"
  zone="$(nearest_zone "$lat" "$lng")"
  cat > /tmp/bank.json <<JSON
{
  "PK":{"S":"LOC"}, "SK":{"S":"${id}"}, "id":{"S":"${id}"},
  "name":{"S":"${name}"}, "type":{"S":"bloodbank"},
  "lat":{"N":"${lat}"}, "lng":{"N":"${lng}"},
  "zone_id":{"S":"${zone}"}, "active":{"BOOL":true}
}
JSON
  aws dynamodb put-item --table-name "$REF" --region "$REGION" --item file:///tmp/bank.json
  echo "  saved ${id}  (${name}, zone=${zone:-<none>})"
done

echo
echo "Done. Verify:  ./seed-bloodbanks.sh list"
echo "If zone shows <none>, your ReferenceData has no ZONE rows in this region."
