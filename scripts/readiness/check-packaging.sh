#!/usr/bin/env bash
# Packaging: can the production application be packaged?
# Vite production build only — not a type check.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT"

export READINESS_BOUNDARIES="Does not prove TypeScript correctness, lint, tests, or live integrations."

CHECK_ID="packaging"
LOG="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.log"
CMD="npm run build"
readiness_mkdir

set +e
npm run build >"$LOG" 2>&1
code=$?
set -e

status="$(readiness_status_from_exit "$code")"
readiness_emit_result "$CHECK_ID" "$status" "$code" "$CMD" "$LOG" \
  "Vite production build (transpile/bundle). Transpilation success is not a type gate."
exit "$code"
