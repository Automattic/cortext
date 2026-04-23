#!/usr/bin/env bash
# One-time worktree setup: install deps and write the per-worktree wp-env
# config (port + plugin that labels the site with the branch name). Safe to
# re-run.

set -euo pipefail
cd "$(dirname "$0")/.."

npm install
composer install --no-interaction

hash_cmd=$(command -v shasum || command -v sha1sum)
hash=$(printf '%s' "$PWD" | "$hash_cmd" | awk '{print $1}')
port=$(( 8000 + 16#${hash:0:6} % 1000 ))

cat > .wp-env.override.json <<EOF
{ "port": ${port}, "plugins": [ ".", "./.wp-env-plugins/worktree-label" ] }
EOF

"$(dirname "$0")/refresh-label.sh"
