#!/usr/bin/env bash
# Write the per-worktree wp-env config. Uses Conductor's allocated port when
# available so its preview URL matches. Outside Conductor it keeps the port
# already in the override, or derives a stable one from the worktree path.
#
# The site is served on <workspace>.localhost:<port>. Browsers resolve
# *.localhost to loopback and scope cookies by host, so each worktree keeps
# its own login cookies instead of piling them all onto localhost.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CONDUCTOR_PORT:-}" ]; then
	port=$CONDUCTOR_PORT
elif [ -f .wp-env.override.json ]; then
	port=$(node -p 'require("./.wp-env.override.json").port')
else
	hash_cmd=$(command -v shasum || command -v sha1sum)
	hash=$(printf '%s' "$PWD" | "$hash_cmd" | awk '{print $1}')
	port=$(( 8000 + 16#${hash:0:6} % 1000 ))
fi

name=${CONDUCTOR_WORKSPACE_NAME:-$(basename "$PWD")}
slug=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-63 | sed -E 's/-+$//')
site_url="http://${slug}.localhost:${port}"

cat > .wp-env.override.json <<JSON
{
	"port": ${port},
	"plugins": [ ".", "./.wp-env-plugins/worktree-label", "./.wp-env-plugins/dev-autologin" ],
	"config": { "WP_HOME": "${site_url}", "WP_SITEURL": "${site_url}" }
}
JSON
