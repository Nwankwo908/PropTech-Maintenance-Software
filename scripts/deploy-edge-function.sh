#!/usr/bin/env bash
# Deploy one Edge Function only from a clean git tree; tag the deploy with HEAD SHA
# and record function_name / git_sha / import_graph_hash in public.edge_function_deploys.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "usage: scripts/deploy-edge-function.sh <function-slug> [supabase deploy args...]" >&2
  exit 2
fi

FN="$1"
shift

if [[ -n "$(git status --porcelain)" ]]; then
  echo "REFUSING deploy: working tree is dirty. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
PROJECT_REF="${SUPABASE_PROJECT_REF:-mzpqwuizhiaczxcnmxbt}"

HASH_JSON="$(node "$ROOT/scripts/edge-function-import-graph.mjs" "$FN")"
IMPORT_HASH="$(node -e "const j=JSON.parse(process.argv[1]); if(!j.hash) { console.error(j.error||'hash failed'); process.exit(1)}; console.log(j.hash)" "$HASH_JSON")"

echo "Deploying ${FN} at commit ${SHORT} (${SHA}) hash=${IMPORT_HASH:0:12}"
npx supabase functions deploy "$FN" --project-ref "$PROJECT_REF" "$@"

# Record deploy in DB (not a committed file — keeps the tree clean).
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$HOME/.supabase/access-token" ]]; then
  TOKEN="$(cat "$HOME/.supabase/access-token")"
fi
if [[ -n "$TOKEN" ]]; then
  ESC_FN="${FN//\'/\'\'}"
  ESC_SHA="${SHA//\'/\'\'}"
  ESC_HASH="${IMPORT_HASH//\'/\'\'}"
  QUERY="insert into public.edge_function_deploys (function_name, git_sha, import_graph_hash) values ('${ESC_FN}', '${ESC_SHA}', '${ESC_HASH}');"
  HTTP_CODE="$(curl -sS -o /tmp/ulo-edge-deploy-record.json -w '%{http_code}' \
    -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$(node -e "console.log(JSON.stringify({query:process.argv[1]}))" "$QUERY")")"
  if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "201" ]]; then
    echo "WARN: deploy succeeded but failed to record edge_function_deploys (HTTP ${HTTP_CODE}):" >&2
    cat /tmp/ulo-edge-deploy-record.json >&2 || true
    echo >&2
  else
    echo "Recorded edge_function_deploys function=${FN} commit=${SHA} hash=${IMPORT_HASH:0:12}"
  fi
else
  echo "WARN: no SUPABASE_ACCESS_TOKEN — deploy not recorded in edge_function_deploys" >&2
fi

echo "DEPLOY_OK function=${FN} commit=${SHA} hash=${IMPORT_HASH}"
