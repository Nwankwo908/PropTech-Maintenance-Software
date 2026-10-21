#!/usr/bin/env bash
# Automated behavior (frontend/shared): Vitest suites under the Vite/node test env.
# Zero discovered tests is a failure, not a pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT"

export READINESS_BOUNDARIES="Mocked unit/contract tests only. Does not prove live storage, SMS, payments, or model extraction."

CHECK_ID="behavior-frontend"
LOG="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.log"
JSON_OUT="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.vitest.json"
CMD="npx vitest run --reporter=json --outputFile=$JSON_OUT"
readiness_mkdir

set +e
npx --no-install vitest run --reporter=default --reporter=json --outputFile="$JSON_OUT" >"$LOG" 2>&1
code=$?
set -e

test_count=0
fail_count=0
if [[ -f "$JSON_OUT" ]]; then
  eval "$(python3 - "$JSON_OUT" <<'PY'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    print("test_count=0; fail_count=0")
    raise SystemExit(0)
# Vitest JSON: numTotalTests / numFailedTests (v1+) or testResults
total = data.get("numTotalTests")
failed = data.get("numFailedTests")
if total is None:
    total = 0
    for suite in data.get("testResults") or []:
        for a in suite.get("assertionResults") or []:
            total += 1
            if a.get("status") == "failed":
                failed = (failed or 0) + 1
print(f"test_count={int(total or 0)}; fail_count={int(failed or 0)}")
PY
)"
fi

notes=(
  "vitest_tests=${test_count}"
  "vitest_failed=${fail_count}"
  "Focused suites also exist: scripts/vitest.{lease-scan,equipment-vision,home-check,sms-context}.config.ts (run via connected/focused jobs when needed)."
)

if [[ "$code" -eq 0 && "$test_count" -eq 0 ]]; then
  readiness_emit_result "$CHECK_ID" "failed" 1 "$CMD" "$LOG" \
    "${notes[@]}" \
    "Zero discovered Vitest tests — not a passing result."
  exit 1
fi

status="$(readiness_status_from_exit "$code")"
readiness_emit_result "$CHECK_ID" "$status" "$code" "$CMD" "$LOG" "${notes[@]}"
exit "$code"
