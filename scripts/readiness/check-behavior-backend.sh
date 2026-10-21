#!/usr/bin/env bash
# Automated behavior (backend): native Deno test suites.
# Type correctness is a separate gate (check-backend-types). This run uses
# --no-check only for execution speed after that gate — it never stands in for it.
# Excludes *_live_test.ts (optional live sandbox; see connected-workflows).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT"

export READINESS_BOUNDARIES="Deterministic Deno unit/contract tests. Live *_live_test.ts and provider smoke are not included here."

CHECK_ID="behavior-backend"
LOG="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.log"
CONFIG="supabase/functions/deno.json"
readiness_mkdir

if ! readiness_require_cmd deno; then
  readiness_emit_result "$CHECK_ID" "blocked" 2 \
    "deno test --config $CONFIG --no-lock ..." "" \
    "Requirement: Deno CLI on PATH."
  exit 2
fi

TESTS=()
while IFS= read -r f; do
  [[ -n "$f" ]] && TESTS+=("$f")
done < <(
  {
    find supabase/functions -type f \( -name '*_test.ts' -o -name '*_test.tsx' \) \
      ! -name '*_live_test.ts' \
      ! -path '*/node_modules/*'
    find shared -type f \( -name '*_test.ts' -o -name '*_test.tsx' \) \
      ! -name '*_live_test.ts'
  } | sort
)

if [[ ${#TESTS[@]} -eq 0 ]]; then
  readiness_emit_result "$CHECK_ID" "failed" 1 \
    "deno test (no files)" "" \
    "Zero discovered Deno *_test.ts files — not a passing result."
  exit 1
fi

CMD="deno test --config $CONFIG --no-lock --allow-env --allow-read --allow-net (${#TESTS[@]} files; --no-check for runtime only)"
# Allow-net: some tests import remote assert modules; no live product calls intended.
set +e
deno test \
  --config "$CONFIG" \
  --no-lock \
  --no-check \
  --allow-env \
  --allow-read \
  --allow-net \
  "${TESTS[@]}" >"$LOG" 2>&1
code=$?
set -e

# Parse "ok | N passed" / "FAILED | …" style summaries when present.
passed="$(grep -Eo '[0-9]+ passed' "$LOG" | tail -1 | grep -Eo '[0-9]+' || echo 0)"
failed="$(grep -Eo '[0-9]+ failed' "$LOG" | tail -1 | grep -Eo '[0-9]+' || echo 0)"

notes=(
  "deno_test_files=${#TESTS[@]}"
  "deno_summary_passed=${passed}"
  "deno_summary_failed=${failed}"
  "Excluded: *_live_test.ts (connected/live sandbox only)."
  "Type gate is check-backend-types.sh — this invocation uses --no-check for behavior only."
)

if [[ "$code" -eq 0 && "$passed" == "0" && "$failed" == "0" ]]; then
  # Some Deno versions still exit 0 with no runnable tests if filters empty — treat as fail.
  if ! grep -q 'ok|' "$LOG" && ! grep -q 'passed' "$LOG"; then
    readiness_emit_result "$CHECK_ID" "failed" 1 "$CMD" "$LOG" \
      "${notes[@]}" \
      "No runnable Deno test results detected — not a passing result."
    exit 1
  fi
fi

status="$(readiness_status_from_exit "$code")"
readiness_emit_result "$CHECK_ID" "$status" "$code" "$CMD" "$LOG" "${notes[@]}"
exit "$code"
