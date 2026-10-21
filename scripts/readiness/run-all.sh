#!/usr/bin/env bash
# Run every independently required readiness check and write an overall summary.
# A passing packaging build never upgrades failed type/lint/behavior/connected results.
#
# Exit codes:
#   0 — every required check passed
#   1 — at least one required check failed
#   2 — no failures, but at least one required check blocked/not_run
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
readiness_mkdir

CHECKS=(
  packaging
  frontend-types
  backend-types
  lint
  behavior-frontend
  behavior-backend
  connected-workflows
)

declare -a RESULTS=()
overall_failed=0
overall_blocked=0

for id in "${CHECKS[@]}"; do
  script="$(dirname "$0")/check-${id}.sh"
  chmod +x "$script" 2>/dev/null || true
  echo ""
  echo "######## RUNNING check: ${id} ########"
  set +e
  "$script"
  code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    RESULTS+=("${id}=passed")
  elif [[ "$code" -eq 2 ]]; then
    RESULTS+=("${id}=blocked")
    overall_blocked=1
  else
    RESULTS+=("${id}=failed")
    overall_failed=1
  fi
done

commit="$(readiness_git_commit)"
summary="$READINESS_ARTIFACT_ROOT/summary.txt"
json="$READINESS_ARTIFACT_ROOT/summary.json"
finished="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ "$overall_failed" -eq 1 ]]; then
  overall="failed"
  exit_code=1
elif [[ "$overall_blocked" -eq 1 ]]; then
  overall="blocked"
  exit_code=2
else
  overall="passed"
  exit_code=0
fi

{
  echo "ulo_readiness_summary"
  echo "commit=${commit}"
  echo "finished_at=${finished}"
  echo "overall=${overall}"
  echo "exit_code=${exit_code}"
  echo "checks:"
  for r in "${RESULTS[@]}"; do
    echo "  - ${r}"
  done
  echo "layers:"
  echo "  packaging=Vite production build (not a type gate)"
  echo "  static=frontend-types + backend-types + lint"
  echo "  mocked_behavior=behavior-frontend (Vitest) + behavior-backend (Deno, excludes *_live_test)"
  echo "  isolated_integrations=connected-workflows (disposable PG / TZ matrix; optional home_check/browser/live)"
  echo "  live_sandbox=only when READINESS_RUN_LIVE_DENO_TESTS / browser flags + credentials are set"
  echo "note=A green packaging result does not imply application readiness."
  echo "artifacts=${READINESS_ARTIFACT_ROOT}"
} | tee "$summary"

python3 - "$json" <<PY
import json, os, sys
path = sys.argv[1]
results = """$(printf '%s\n' "${RESULTS[@]}")""".strip().splitlines()
checks = []
for line in results:
    if "=" not in line:
        continue
    k, v = line.split("=", 1)
    checks.append({"id": k, "status": v})
payload = {
  "commit": """${commit}""",
  "finishedAt": """${finished}""",
  "overall": """${overall}""",
  "exitCode": int("""${exit_code}"""),
  "checks": checks,
  "layers": {
    "packaging": "Vite production build (not a type gate)",
    "static": "frontend-types + backend-types + lint",
    "mockedBehavior": "behavior-frontend + behavior-backend",
    "isolatedIntegrations": "connected-workflows",
    "liveSandbox": "opt-in via READINESS_RUN_* + credentials",
  },
  "artifactRoot": """${READINESS_ARTIFACT_ROOT}""",
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
PY

echo ""
echo "Overall readiness: ${overall} (exit ${exit_code})"
exit "$exit_code"
