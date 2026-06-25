#!/usr/bin/env bash
# Reset operational state: clear all requests/emergencies/bookings and free the
# fleet (re-seed sets every vehicle back to idle). Reference data is untouched.
# Run in CloudShell from the folder containing seed-data.mjs.
#   AWS_REGION=eu-west-1 ./reset-ops.sh
set -euo pipefail
REGION="${AWS_REGION:-eu-west-1}"

echo "Clearing TransportRequests (requests / emergencies / bookings + audit rows)..."
aws dynamodb scan --table-name TransportRequests --region "$REGION" \
  --projection-expression "PK,SK" --output json \
  | jq -c '.Items[]' | while read -r it; do
      pk=$(jq -r '.PK.S' <<<"$it"); sk=$(jq -r '.SK.S' <<<"$it")
      aws dynamodb delete-item --table-name TransportRequests --region "$REGION" \
        --key "{\"PK\":{\"S\":\"$pk\"},\"SK\":{\"S\":\"$sk\"}}" >/dev/null
    done

echo "Re-seeding fleet (resets every vehicle to idle) + reference data..."
node seed-data.mjs >/dev/null

echo "Done. All ambulances/vehicles are idle; operational tables cleared."
