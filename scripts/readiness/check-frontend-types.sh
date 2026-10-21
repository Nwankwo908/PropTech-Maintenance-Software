#!/usr/bin/env bash
# Frontend type correctness: browser/shared/node tooling under intended TS configs.
# Real no-emit checks — independent of Vite packaging.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT"

export READINESS_BOUNDARIES="shared/ production modules are covered here for browser consumers. Deno-only shared/**/*_test.ts and supabase/functions are excluded (see backend-types)."

CHECK_ID="frontend-types"
LOG="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.log"
CMD="npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.node.json --noEmit && npx tsc -p tsconfig.vitest.json --noEmit"
readiness_mkdir
: >"$LOG"

code=0
run_tsc() {
  local project="$1"
  echo "=== ${project} ===" >>"$LOG"
  set +e
  npx --no-install tsc -p "$project" --noEmit --pretty false >>"$LOG" 2>&1
  local c=$?
  set -e
  echo "(exit ${c})" >>"$LOG"
  if [[ "$c" -ne 0 ]]; then
    code="$c"
  fi
}

run_tsc tsconfig.app.json
run_tsc tsconfig.node.json
run_tsc tsconfig.vitest.json

status="$(readiness_status_from_exit "$code")"
readiness_emit_result "$CHECK_ID" "$status" "$code" "$CMD" "$LOG" \
  "Does not typecheck supabase/functions or shared/**/*_test.ts (Deno gate)." \
  "shared/ ownership: included via tsconfig.app.json paths @shared/*."
exit "$code"
