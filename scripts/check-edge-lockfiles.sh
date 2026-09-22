#!/bin/sh
# Reject edge-function lockfiles the Supabase bundler cannot read.
#
# supabase/edge-runtime:v1.70.0 bundles with Deno 2.1.4, which understands
# lockfile v4 and older. Deno 2.4+ writes v5, so a local `deno` run inside a
# function directory silently breaks `supabase functions deploy`.
#
# Usage:
#   scripts/check-edge-lockfiles.sh            # every lockfile on disk (CI)
#   scripts/check-edge-lockfiles.sh --staged   # staged lockfiles (pre-commit)

MAX_LOCKFILE_VERSION=4
status=0
checked=0

if [ "$1" = "--staged" ]; then
  mode=staged
  locks=$(git diff --cached --name-only --diff-filter=ACM -- supabase/functions)
else
  mode=worktree
  locks=$(find supabase/functions -name deno.lock 2>/dev/null)
fi

read_version() {
  if [ "$mode" = staged ]; then
    git show ":$1"
  else
    cat "$1"
  fi | sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\{0,1\}\([0-9]\{1,\}\)"\{0,1\}.*/\1/p' | head -1
}

while IFS= read -r lock; do
  [ -n "$lock" ] || continue
  case "$lock" in
    */deno.lock) ;;
    *) continue ;;
  esac

  version=$(read_version "$lock")
  [ -n "$version" ] || continue
  checked=$((checked + 1))
  [ "$version" -le "$MAX_LOCKFILE_VERSION" ] && continue

  status=1
  cat >&2 <<EOF

Blocked: $lock is lockfile version $version.

The Supabase edge bundler runs Deno 2.1.4 and can only read version
$MAX_LOCKFILE_VERSION or older, so this would break \`supabase functions deploy\`.

Regenerate it with a matching Deno (your local Deno is newer):

  curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/v2.1.4/deno-\$(uname -m)-apple-darwin.zip"
  unzip -oq /tmp/deno.zip -d /tmp/deno214
  rm "$lock"
  (cd "$(dirname "$lock")" && DENO_DIR=/tmp/deno214-cache /tmp/deno214/deno cache index.ts)
  git add "$lock"

EOF
done <<EOF
$locks
EOF

if [ "$status" -eq 0 ] && [ "$checked" -gt 0 ]; then
  echo "Edge function lockfiles OK ($checked checked, version <= $MAX_LOCKFILE_VERSION)."
fi

exit $status
