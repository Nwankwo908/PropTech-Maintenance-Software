#!/usr/bin/env bash
# Backend type correctness: native Deno check of every Edge Function entrypoint
# (and transitive shared deps) using supabase/functions/deno.json.
# --no-lock avoids rewriting Supabase-compatible lockfiles with a newer local Deno.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT"

export READINESS_BOUNDARIES="Proves Deno typechecking of edge entrypoints + imported shared/. Does not prove runtime SMS/payment/model calls."

CHECK_ID="backend-types"
LOG="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.log"
CONFIG="supabase/functions/deno.json"
readiness_mkdir

if ! readiness_require_cmd deno; then
  readiness_emit_result "$CHECK_ID" "blocked" 2 \
    "deno check --config $CONFIG --no-lock <entrypoints>" "" \
    "Requirement: Deno CLI on PATH (pinned local install OK; do not rewrite deno.lock to v5)."
  exit 2
fi

ENTRIES=()
while IFS= read -r f; do
  [[ -n "$f" ]] && ENTRIES+=("$f")
done < <(find supabase/functions -mindepth 2 -maxdepth 2 -name index.ts | sort)

# Deno-owned tests that live under shared/ (excluded from browser tsc via *_test.ts).
SHARED_DENO_TESTS=()
while IFS= read -r f; do
  [[ -n "$f" ]] && SHARED_DENO_TESTS+=("$f")
done < <(find shared -type f \( -name '*_test.ts' -o -name '*_test.tsx' \) | sort)

if [[ ${#ENTRIES[@]} -eq 0 ]]; then
  readiness_emit_result "$CHECK_ID" "failed" 1 \
    "deno check --config $CONFIG" "" \
    "No Edge Function entrypoints found under supabase/functions/*/index.ts."
  exit 1
fi

TARGETS=("${ENTRIES[@]}" "${SHARED_DENO_TESTS[@]}")
CMD="deno check --config $CONFIG --no-lock (${#ENTRIES[@]} entrypoints + ${#SHARED_DENO_TESTS[@]} shared Deno tests)"
set +e
deno check --config "$CONFIG" --no-lock "${TARGETS[@]}" >"$LOG" 2>&1
code=$?
set -e

status="$(readiness_status_from_exit "$code")"
readiness_emit_result "$CHECK_ID" "$status" "$code" "$CMD" "$LOG" \
  "Entrypoint count: ${#ENTRIES[@]}" \
  "Shared Deno *_test.ts count: ${#SHARED_DENO_TESTS[@]}" \
  "Config: $CONFIG (not browser tsc / deno-ambient.d.ts)" \
  "Lockfiles: --no-lock so local Deno 2.4+ does not emit bundler-incompatible v5 locks."
exit "$code"
