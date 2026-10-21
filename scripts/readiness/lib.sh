#!/usr/bin/env bash
# Shared helpers for independently visible readiness checks.
# Status vocabulary: passed | failed | blocked | not_run
set -euo pipefail

READINESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
READINESS_ARTIFACT_ROOT="${READINESS_ARTIFACT_DIR:-$READINESS_ROOT/.readiness}"

readiness_mkdir() {
  mkdir -p "$READINESS_ARTIFACT_ROOT"
}

readiness_git_commit() {
  git -C "$READINESS_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown"
}

readiness_runtime_versions() {
  {
    echo "node=$(node -v 2>/dev/null || echo missing)"
    echo "npm=$(npm -v 2>/dev/null || echo missing)"
    echo "tsc=$(cd "$READINESS_ROOT" && npx --no-install tsc -v 2>/dev/null || echo missing)"
    echo "deno=$(deno --version 2>/dev/null | head -1 || echo missing)"
    echo "vite=$(cd "$READINESS_ROOT" && npx --no-install vite --version 2>/dev/null || echo missing)"
    if command -v psql >/dev/null 2>&1; then
      echo "psql=$(psql --version 2>/dev/null | head -1)"
    else
      echo "psql=missing"
    fi
  } || true
}

readiness_status_from_exit() {
  local code="$1"
  if [[ "$code" -eq 0 ]]; then
    echo passed
  else
    echo failed
  fi
}

# Emit machine + human artifacts for one check. Never alters exit status of the caller.
# Usage: readiness_emit_result CHECK_ID STATUS EXIT_CODE COMMAND LOG_FILE [note ...]
readiness_emit_result() {
  local check_id="$1"
  local status="$2"
  local exit_code="$3"
  local command="$4"
  local log_file="${5:-}"
  shift 5 || true
  local notes=("$@")

  readiness_mkdir
  local commit finished_at
  commit="$(readiness_git_commit)"
  finished_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local summary="$READINESS_ARTIFACT_ROOT/${check_id}.summary.txt"
  local out="$READINESS_ARTIFACT_ROOT/${check_id}.json"
  local runtimes
  runtimes="$(readiness_runtime_versions)"

  {
    echo "check=${check_id}"
    echo "status=${status}"
    echo "exit_code=${exit_code}"
    echo "commit=${commit}"
    echo "command=${command}"
    echo "finished_at=${finished_at}"
    echo "artifact_root=${READINESS_ARTIFACT_ROOT}"
    if [[ -n "$log_file" ]]; then
      echo "log=${log_file}"
    fi
    echo "runtimes:"
    printf '%s\n' "$runtimes" | sed 's/^/  /'
    if [[ -n "${READINESS_BOUNDARIES:-}" ]]; then
      echo "boundaries:"
      printf '%s\n' "$READINESS_BOUNDARIES" | sed 's/^/  /'
    fi
    if ((${#notes[@]})); then
      echo "notes:"
      for n in "${notes[@]}"; do
        printf '  - %s\n' "$n"
      done
    fi
  } >"$summary"

  CHECK_ID="$check_id" STATUS="$status" EXIT_CODE="$exit_code" COMMIT="$commit" \
  COMMAND="$command" FINISHED_AT="$finished_at" LOG="$log_file" \
  RUNTIMES="$runtimes" NOTES="$(printf '%s\n' "${notes[@]}")" \
  BOUNDARIES="${READINESS_BOUNDARIES:-}" \
  python3 - "$out" <<'PY'
import json, os, sys
path = sys.argv[1]
payload = {
  "check": os.environ["CHECK_ID"],
  "status": os.environ["STATUS"],
  "exitCode": int(os.environ["EXIT_CODE"]),
  "commit": os.environ["COMMIT"],
  "command": os.environ["COMMAND"],
  "finishedAt": os.environ["FINISHED_AT"],
  "log": os.environ.get("LOG") or None,
  "runtimes": [line for line in os.environ.get("RUNTIMES", "").splitlines() if line],
  "notes": [n for n in os.environ.get("NOTES", "").split("\n") if n],
  "boundaries": [b for b in os.environ.get("BOUNDARIES", "").split("\n") if b],
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
PY

  echo ""
  echo "======== readiness:${check_id} → ${status} (exit ${exit_code}) ========"
  cat "$summary"
}

readiness_require_cmd() {
  command -v "$1" >/dev/null 2>&1
}
