#!/usr/bin/env bash
# Long-running dev loop: refresh the branch-derived site label, boot
# wp-env, seed the local demo workspace, and start the JS watcher.
set -euo pipefail
cd "$(dirname "$0")/.."
"$(dirname "$0")/refresh-label.sh"

port=$(node -p 'require("./.wp-env.override.json").port')
cortext_url="http://localhost:${port}/wp-admin/admin.php?page=cortext"
echo "Cortext admin: ${cortext_url}"

npm run env:start 2>&1 | sed "s#WordPress development site started at http://localhost:${port}#Cortext admin: ${cortext_url}#"
npm run env:seed
echo "Cortext admin: ${cortext_url}"

exec npm run dev
