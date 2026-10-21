#!/usr/bin/env bash
# Run requester-timezone fixtures in separate processes under four server zones.
# Usage: ./scripts/run-requester-timezone-matrix.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "======== deno check (parse module + requester TZ tests) ========"
deno check --no-lock \
  supabase/functions/_shared/vendor_availability_parse.ts \
  supabase/functions/_shared/vendor_availability_requester_timezone_test.ts

ZONES=(UTC America/New_York America/Los_Angeles Asia/Tokyo)
FAILED=0

for zone in "${ZONES[@]}"; do
  echo "======== TZ=${zone} ========"
  if ! TZ="$zone" deno test --no-check --no-lock --allow-env --allow-read \
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
