#!/usr/bin/env bash
# =====================================================================
# Manage map locations in the dedicated Locations table (PK = location_id).
# Whatever is in here is what the app's map + pickup dropdowns show.
#
# Run in AWS CloudShell:
#   chmod +x manage-locations.sh
#   ./manage-locations.sh list
#   ./manage-locations.sh add "Hostel A1" 22.8047 86.2061 hostel
#   ./manage-locations.sh add "Block C" 22.8045 86.2057 quarters zone-sakchi
#   ./manage-locations.sh delete loc-hostel-a1
#   ./manage-locations.sh import places.csv      # columns: name,lat,lng[,type]
#
# zone_id is auto-resolved from the nearest zone (read from ReferenceData) when omitted.
# Re-running add with the same name (same location_id) UPDATES the row (upsert).
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
TABLE="${TBL_LOCATIONS:-Locations}"   # dedicated table, PK = location_id
REF="${TBL_REF:-ReferenceData}"       # zones still live here
CMD="${1:-help}"

slug() { echo "loc-$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"; }

# nearest zone id for a lat/lng (reads ZONE rows; haversine in node)
nearest_zone() {
  local lat="$1" lng="$2"
  local zones; zones="$(aws dynamodb query --table-name "$REF" --region "$REGION" \
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

put_location() {
  local name="$1" lat="$2" lng="$3" type="${4:-residential}" zone="${5:-}"
  [ -z "$zone" ] && zone="$(nearest_zone "$lat" "$lng")"
  local id; id="$(slug "$name")"
  cat > /tmp/loc.json <<JSON
{
  "location_id":{"S":"${id}"},
  "name":{"S":"${name}"}, "type":{"S":"${type}"},
  "lat":{"N":"${lat}"}, "lng":{"N":"${lng}"},
  "zone_id":{"S":"${zone}"}, "active":{"BOOL":true}
}
JSON
  aws dynamodb put-item --table-name "$TABLE" --region "$REGION" --item file:///tmp/loc.json
  echo "  saved ${id}  (${name}, ${type}, zone=${zone})"
}

case "$CMD" in
  list)
    aws dynamodb scan --table-name "$TABLE" --region "$REGION" \
      --query 'Items[].{id:location_id.S,name:name.S,type:type.S,zone:zone_id.S}' --output table
    ;;
  add)
    shift
    [ "$#" -ge 3 ] || { echo "usage: add \"Name\" <lat> <lng> [type] [zone_id]"; exit 1; }
    put_location "$@"
    ;;
  delete)
    id="${2:?usage: delete <id>}"
    aws dynamodb delete-item --table-name "$TABLE" --region "$REGION" \
      --key "{\"location_id\":{\"S\":\"${id}\"}}"
    echo "  deleted ${id}"
    ;;
  import)
    file="${2:?usage: import <file.csv>  (columns: name,lat,lng[,type])}"
    first=1
    while IFS=, read -r name lat lng type _; do
      [ -z "${name:-}" ] && continue
      if [ "$first" = 1 ] && echo "$name" | grep -qi '^name$'; then first=0; continue; fi
      first=0
      name="$(echo "$name" | sed -E 's/^"|"$//g')"
      put_location "$name" "$(echo "$lat"|xargs)" "$(echo "$lng"|xargs)" "$(echo "${type:-residential}"|xargs)"
    done < "$file"
    ;;
  *)
    echo "Commands:"
    echo "  ./manage-locations.sh list"
    echo "  ./manage-locations.sh add \"Name\" <lat> <lng> [type] [zone_id]"
    echo "  ./manage-locations.sh delete <id>"
    echo "  ./manage-locations.sh import places.csv     # name,lat,lng[,type]"
    ;;
esac
