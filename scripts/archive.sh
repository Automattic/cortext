#!/usr/bin/env bash
# Stop wp-env when the worktree is archived so the dev server and its
# ports don't leak. Only a running environment needs stopping; one that
# was never started or is already stopped has nothing to free.
set -euo pipefail
cd "$(dirname "$0")/.."

if pnpm exec wp-env status --json | grep -q '"status":"running"'; then
	pnpm exec wp-env stop
fi
