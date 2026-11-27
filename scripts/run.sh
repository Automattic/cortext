#!/usr/bin/env bash
# Long-running dev loop: refresh the branch-derived site label, boot
# wp-env, seed the local demo workspace, and start the JS watcher.
set -euo pipefail
cd "$(dirname "$0")/.."
"$(dirname "$0")/write-wp-env-override.sh"
"$(dirname "$0")/refresh-label.sh"
"$(dirname "$0")/write-dev-autologin.sh"

site_url=$(node -p 'require("./.wp-env.override.json").config.WP_HOME')
cortext_url="${site_url}/wp-admin/admin.php?page=cortext"
echo "Cortext admin: ${cortext_url}"

pnpm run env:start 2>&1 | sed "s#WordPress development site started at ${site_url}#Cortext admin: ${cortext_url}#"
pnpm run env:seed
echo "Cortext admin: ${cortext_url}"
if command -v open >/dev/null; then
	open "${cortext_url}"
fi

exec pnpm run dev
