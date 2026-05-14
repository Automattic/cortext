#!/usr/bin/env bash
# Stop the detached Playground server so it doesn't leak when the
# worktree is archived.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec wp-env stop --runtime=playground
