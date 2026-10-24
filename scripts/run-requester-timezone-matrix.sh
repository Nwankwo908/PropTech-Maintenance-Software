#!/usr/bin/env bash
# Run requester-timezone fixtures in separate processes under four server zones.
# Usage: ./scripts/run-requester-timezone-matrix.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "======== deno check (parse module + requester TZ tests) ========"
# Same config as the behavior gate. Deno 2.1.4 otherwise looks for npm:unpdf
# in node_modules, which the connected-workflows job does not install.
deno check --config supabase/functions/deno.json --no-lock \
  supabase/functions/_shared/vendor_availability_parse.ts \
  supabase/functions/_shared/vendor_availability_requester_timezone_test.ts

ZONES=(UTC America/New_York America/Los_Angeles Asia/Tokyo)
FAILED=0

for zone in "${ZONES[@]}"; do
  echo "======== TZ=${zone} ========"
  if ! TZ="$zone" deno test --config supabase/functions/deno.json --no-check --no-lock --allow-env --allow-read \
    supabase/functions/_shared/vendor_availability_requester_timezone_test.ts \
    --filter 'tomorrow 4:30pm' \
    supabase/functions/_shared/scheduleAskGuards_test.ts; then
    echo "FAILED under TZ=${zone}"
    FAILED=1
  fi
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "Requester timezone matrix: FAILED"
  exit 1
fi
echo "Requester timezone matrix: OK (UTC, New_York, Los_Angeles, Tokyo)"
