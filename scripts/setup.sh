#!/usr/bin/env bash
# One-time worktree setup: install deps and write the per-worktree wp-env
# config (port + local helper plugins). Safe to re-run.

set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install
composer install --no-interaction

"$(dirname "$0")/write-wp-env-override.sh"
"$(dirname "$0")/refresh-label.sh"
"$(dirname "$0")/write-dev-autologin.sh"
