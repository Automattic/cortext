#!/usr/bin/env bash
# Long-running dev loop: refresh the branch-derived site label, boot
# WordPress Playground, and start the JS watcher.
set -euo pipefail
cd "$(dirname "$0")/.."
"$(dirname "$0")/refresh-label.sh"

port=$(node -p 'require("./.wp-env.override.json").port')
echo "Cortext admin: http://localhost:${port}/wp-admin/"

exec npm start
