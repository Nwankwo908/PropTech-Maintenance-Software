#!/usr/bin/env bash
# Coding standards: ESLint for frontend/shared and Deno lint for edge.
# Reports errors and warnings separately; preserves underlying exit status.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT"

export READINESS_BOUNDARIES="Lint is static style/correctness only — not packaging, types, or behavior."

CHECK_ID="lint"
LOG="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.log"
JSON_OUT="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.eslint.json"
readiness_mkdir
: >"$LOG"

fe_code=0
be_code=0
fe_errors=0
fe_warnings=0
be_errors=0
be_warnings=0

{
  echo "=== frontend/shared ESLint (src, shared, vite configs) ==="
  set +e
  npx --no-install eslint \
    --no-error-on-unmatched-pattern \
    "src/**/*.{ts,tsx}" \
    "shared/**/*.{ts,tsx}" \
    "vite.config.ts" \
    "vite/**/*.{ts,tsx}" \
    "scripts/**/*.{ts,mjs,js}" \
    -f json \
    -o "$JSON_OUT"
  fe_code=$?
  set -e

  if [[ -f "$JSON_OUT" ]]; then
    eval "$(python3 - "$JSON_OUT" <<'PY'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    print("fe_errors=0; fe_warnings=0")
    raise SystemExit(0)
err = warn = 0
for f in data:
    err += int(f.get("errorCount") or 0)
    warn += int(f.get("warningCount") or 0)
print(f"fe_errors={err}; fe_warnings={warn}")
PY
)"
  fi
  echo "frontend eslint: errors=${fe_errors} warnings=${fe_warnings} exit=${fe_code}"

  echo "=== backend Deno lint (supabase/functions) ==="
  if command -v deno >/dev/null 2>&1; then
    set +e
    deno_lint_out="$(deno lint --config supabase/functions/deno.json supabase/functions 2>&1)"
    be_code=$?
    set -e
    printf '%s\n' "$deno_lint_out"
    # Deno lint prints "Found N problems" — count error/warn lines loosely.
    be_errors="$(printf '%s\n' "$deno_lint_out" | grep -c 'error\[' || true)"
    be_warnings="$(printf '%s\n' "$deno_lint_out" | grep -c 'warning\[' || true)"
    echo "backend deno lint: errors=${be_errors} warnings=${be_warnings} exit=${be_code}"
  else
    be_code=2
    echo "backend deno lint: BLOCKED — deno not on PATH"
  fi
} >>"$LOG" 2>&1

code=0
notes=(
  "frontend_eslint_errors=${fe_errors}"
  "frontend_eslint_warnings=${fe_warnings}"
  "backend_deno_lint_errors=${be_errors}"
  "backend_deno_lint_warnings=${be_warnings}"
)

if [[ "$fe_code" -ne 0 ]]; then
  code="$fe_code"
fi
if [[ "$be_code" -eq 2 && "$fe_code" -eq 0 ]]; then
  # Deno missing → blocked overall if frontend passed
  readiness_emit_result "$CHECK_ID" "blocked" 2 \
    "eslint (frontend/shared) + deno lint (edge)" "$LOG" \
    "${notes[@]}" \
    "Requirement: Deno CLI for backend lint coverage."
  exit 2
fi
if [[ "$be_code" -ne 0 ]]; then
  code="$be_code"
fi

# Warnings alone: ESLint may exit 0 with warnings depending on config.
# Surface counts; fail only when underlying tools fail (or max-warnings if set).
status="$(readiness_status_from_exit "$code")"
if [[ "$status" == "passed" && ( "$fe_warnings" -gt 0 || "$be_warnings" -gt 0 ) ]]; then
  notes+=("Warnings are reported separately and did not fail the tool exit status.")
fi

CMD="eslint src/shared/vite/scripts + deno lint supabase/functions"
readiness_emit_result "$CHECK_ID" "$status" "$code" "$CMD" "$LOG" "${notes[@]}"
exit "$code"
