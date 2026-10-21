#!/usr/bin/env bash
# Connected workflows: isolated DB transaction tests + optional browser/API
# integration against configured sandbox/mock services.
#
# Subchecks report passed | failed | blocked | not_run independently.
# Overall exit: failed (1) if any required subcheck failed;
#               blocked (2) if none failed but a required subcheck is blocked;
#               passed (0) only when all required subchecks passed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT"

export READINESS_BOUNDARIES="Isolated Postgres suites prove RPC/transaction invariants only (no Twilio/Stripe/LLM). Requester TZ matrix proves schedule parsing under multiple process timezones (no SMS send). Home Check browser is mocked API contract smoke — not authenticated production workflows. Live Supabase *_live_test / provider smoke require explicit sandbox credentials and stay optional."

CHECK_ID="connected-workflows"
LOG="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.log"
SUB="$READINESS_ARTIFACT_ROOT/${CHECK_ID}.subchecks.jsonl"
readiness_mkdir
: >"$LOG"
: >"$SUB"

record_sub() {
  local id="$1" status="$2" note="$3"
  printf '%s\n' "{\"id\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$id"),\"status\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$status"),\"note\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$note")}" >>"$SUB"
  echo "[subcheck] $id → $status — $note" | tee -a "$LOG"
}

# --- 1) Onboarding inventory consistency (disposable Postgres) ---
ONBOARD_SCRIPT="$ROOT/scripts/run-onboarding-inventory-pg-test.sh"
chmod +x "$ONBOARD_SCRIPT" 2>/dev/null || true
if [[ -f "$ONBOARD_SCRIPT" ]]; then
  set +e
  "$ONBOARD_SCRIPT" >>"$LOG" 2>&1
  oc=$?
  set -e
  if [[ "$oc" -eq 0 ]]; then
    record_sub "onboarding_inventory_pg" "passed" \
      "Proves draft/canonical inventory RPCs + rollback on disposable Postgres (migration + suite)."
  elif grep -qi 'postgresql@16 not found\|initdb: command not found\|pg_ctl: command not found\|not found at' "$LOG"; then
    record_sub "onboarding_inventory_pg" "blocked" \
      "Requirement: PostgreSQL 16+ (PG_BIN or PATH with initdb/pg_ctl/psql). See scripts/run-onboarding-inventory-pg-test.sh."
  else
    record_sub "onboarding_inventory_pg" "failed" \
      "Disposable onboarding inventory suite failed (exit $oc). See log."
  fi
else
  record_sub "onboarding_inventory_pg" "not_run" \
    "scripts/run-onboarding-inventory-pg-test.sh missing."
fi

# --- 2) Home Check SQL (requires pre-migrated isolated DB URL) ---
if [[ -n "${READINESS_HOME_CHECK_DATABASE_URL:-}" ]]; then
  if ! readiness_require_cmd psql; then
    record_sub "home_check_sql" "blocked" "Requirement: psql on PATH plus READINESS_HOME_CHECK_DATABASE_URL."
  else
    set +e
    psql "$READINESS_HOME_CHECK_DATABASE_URL" -v ON_ERROR_STOP=1 \
      -f "$ROOT/supabase/tests/home_check.sql" >>"$LOG" 2>&1
    hc=$?
    set -e
    if [[ "$hc" -eq 0 ]]; then
      record_sub "home_check_sql" "passed" \
        "Proves home_check transactional RPCs against configured isolated DB (rolled back in-suite)."
    else
      record_sub "home_check_sql" "failed" \
        "home_check.sql failed (exit $hc) against READINESS_HOME_CHECK_DATABASE_URL."
    fi
  fi
else
  record_sub "home_check_sql" "blocked" \
    "Requirement: READINESS_HOME_CHECK_DATABASE_URL pointing at an isolated DB with Home Check migrations applied (no outbound workers)."
fi

# --- 3) Requester timezone scheduling matrix (deterministic Deno) ---
TZ_SCRIPT="$ROOT/scripts/run-requester-timezone-matrix.sh"
chmod +x "$TZ_SCRIPT" 2>/dev/null || true
if [[ -f "$TZ_SCRIPT" ]]; then
  if readiness_require_cmd deno; then
    set +e
    "$TZ_SCRIPT" >>"$LOG" 2>&1
    tzc=$?
    set -e
    if [[ "$tzc" -eq 0 ]]; then
      record_sub "requester_timezone_matrix" "passed" \
        "Proves availability parse + schedule guards under UTC/NY/LA/Tokyo process TZ (no outbound SMS)."
    else
      record_sub "requester_timezone_matrix" "failed" \
        "Timezone matrix failed (exit $tzc)."
    fi
  else
    record_sub "requester_timezone_matrix" "blocked" \
      "Requirement: Deno CLI on PATH."
  fi
else
  record_sub "requester_timezone_matrix" "not_run" \
    "scripts/run-requester-timezone-matrix.sh missing."
fi

# --- 4) Home Check browser (mocked; needs Playwright + local fixture app) ---
if [[ -n "${READINESS_RUN_HOME_CHECK_BROWSER:-}" ]]; then
  if [[ -z "${HOME_CHECK_BROWSER_DRIVER:-}" ]]; then
    record_sub "home_check_browser" "blocked" \
      "Requirement: HOME_CHECK_BROWSER_DRIVER (Playwright install outside checkout) + local Vite fixture server (see supabase/HOME_CHECK.md)."
  else
    set +e
    node "$ROOT/scripts/test-home-check-browser.mjs" >>"$LOG" 2>&1
    bc=$?
    set -e
    if [[ "$bc" -eq 0 ]]; then
      record_sub "home_check_browser" "passed" \
        "Proves Home Check UI contract against mocked APIs on local fixture host (no SMS/vision providers)."
    else
      record_sub "home_check_browser" "failed" \
        "Home Check browser smoke failed (exit $bc)."
    fi
  fi
else
  record_sub "home_check_browser" "not_run" \
    "Set READINESS_RUN_HOME_CHECK_BROWSER=1 with Playwright + fixture server to run. Mocked contract only."
fi

# --- 5) Optional live Deno tests (sandbox credentials) ---
if [[ -n "${READINESS_RUN_LIVE_DENO_TESTS:-}" ]]; then
  if [[ -z "${SUPABASE_URL:-}${VITE_SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    record_sub "live_deno_sandbox" "blocked" \
      "Requirement: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY for staging/sandbox only — never production outbound."
  elif ! readiness_require_cmd deno; then
    record_sub "live_deno_sandbox" "blocked" "Requirement: Deno CLI on PATH."
  else
    LIVE=()
    while IFS= read -r f; do
      [[ -n "$f" ]] && LIVE+=("$f")
    done < <(find supabase/functions -type f -name '*_live_test.ts' | sort)
    if [[ ${#LIVE[@]} -eq 0 ]]; then
      record_sub "live_deno_sandbox" "failed" "READINESS_RUN_LIVE_DENO_TESTS set but no *_live_test.ts found."
    else
      set +e
      deno test --config supabase/functions/deno.json --no-lock --no-check \
        --allow-env --allow-read --allow-net "${LIVE[@]}" >>"$LOG" 2>&1
      lc=$?
      set -e
      if [[ "$lc" -eq 0 ]]; then
        record_sub "live_deno_sandbox" "passed" \
          "Live sandbox Deno tests passed (${#LIVE[@]} files). Still not production SMS/payment smoke."
      else
        record_sub "live_deno_sandbox" "failed" "Live Deno tests failed (exit $lc)."
      fi
    fi
  fi
else
  record_sub "live_deno_sandbox" "not_run" \
    "Optional. Set READINESS_RUN_LIVE_DENO_TESTS=1 with sandbox credentials to run *_live_test.ts."
fi

# Aggregate required vs optional
overall="passed"
exit_code=0
has_failed=0
has_blocked_required=0

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  id="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "$line")"
  st="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['status'])" "$line")"
  case "$id" in
    onboarding_inventory_pg|requester_timezone_matrix)
      if [[ "$st" == "failed" || "$st" == "not_run" ]]; then
        has_failed=1
      elif [[ "$st" == "blocked" ]]; then
        has_blocked_required=1
      fi
      ;;
    *)
      if [[ "$st" == "failed" ]]; then
        has_failed=1
      fi
      ;;
  esac
done <"$SUB"

if [[ "$has_failed" -eq 1 ]]; then
  overall="failed"
  exit_code=1
elif [[ "$has_blocked_required" -eq 1 ]]; then
  overall="blocked"
  exit_code=2
else
  overall="passed"
  exit_code=0
fi

notes=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  notes+=("$(python3 -c "import json,sys; o=json.loads(sys.argv[1]); print(o['id']+'='+o['status'])" "$line")")
done <"$SUB"
notes+=("subchecks_jsonl=${SUB}")
notes+=("home_check_sql / browser / live_deno remain blocked or not_run unless prerequisites are intentionally configured.")
notes+=("Does not cover: emergency alerting E2E, payment ledger against Stripe, live SMS delivery.")

CMD="connected workflow subchecks (see ${CHECK_ID}.subchecks.jsonl)"
readiness_emit_result "$CHECK_ID" "$overall" "$exit_code" "$CMD" "$LOG" "${notes[@]}"
exit "$exit_code"
