#!/usr/bin/env bash
# Deploy one Edge Function only from a clean git tree; tag the deploy with HEAD SHA.
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

echo "Deploying ${FN} at commit ${SHORT} (${SHA})"
npx supabase functions deploy "$FN" --project-ref "$PROJECT_REF" "$@"
echo "DEPLOY_OK function=${FN} commit=${SHA}"
