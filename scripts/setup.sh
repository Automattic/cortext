#!/usr/bin/env bash
# One-time worktree setup: install deps and write the per-worktree wp-env
# config (port + local helper plugins). Safe to re-run.

set -euo pipefail
cd "$(dirname "$0")/.."

public_port=$(node ./scripts/resolve-dev-port.mjs)
backend_port=$(node ./scripts/resolve-dev-port.mjs --backend)
token_path=$(node ./scripts/resolve-dev-port.mjs --token-file)

pnpm install
composer install --no-interaction

token_dir=$(dirname "$token_path")
if [[ -L "$token_dir" ]]; then
	echo "Refusing to use a symlink as the local proxy token directory." >&2
	exit 1
fi
mkdir -p "$token_dir"
chmod 700 "$token_dir"
if [[ -L "$token_path" ]]; then
	echo "Refusing to use a symlink as the local proxy token." >&2
	exit 1
fi
if [[ ! -s "$token_path" ]]; then
	umask 077
	node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex") + "\n")' > "$token_path"
fi
chmod 600 "$token_path"
proxy_token=$(< "$token_path")
if [[ ! "$proxy_token" =~ ^[a-f0-9]{64}$ ]]; then
	echo "The local proxy token is invalid. Remove it and run setup again: $token_path" >&2
	exit 1
fi

cat > .wp-env.override.json <<EOF
{ "port": ${backend_port}, "plugins": [ ".", "./.wp-env-plugins/worktree-label", "./.wp-env-plugins/dev-autologin" ] }
EOF

"$(dirname "$0")/refresh-label.sh"

mkdir -p .wp-env-plugins/dev-autologin
rm -f \
	.wp-env-plugins/dev-autologin/proxy-token \
	.wp-env-plugins/dev-autologin/.proxy-token.php
cat > .wp-env-plugins/dev-autologin/.proxy-token.php <<EOF
<?php
return '${proxy_token}';
EOF
chmod 600 .wp-env-plugins/dev-autologin/.proxy-token.php
cp ./scripts/dev-autologin.php .wp-env-plugins/dev-autologin/dev-autologin.php
