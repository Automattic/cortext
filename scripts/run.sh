#!/usr/bin/env bash
# Long-running dev loop: refresh the branch-derived site label, boot
# wp-env, seed the local demo workspace, and start the JS watcher.
set -euo pipefail
cd "$(dirname "$0")/.."
"$(dirname "$0")/refresh-label.sh"

public_port=$(node ./scripts/resolve-dev-port.mjs)
backend_port=$(node -p 'require("./.wp-env.override.json").port')
expected_backend_port=$(node ./scripts/resolve-dev-port.mjs --backend)
token_path=$(node ./scripts/resolve-dev-port.mjs --token-file)

if [[ "$backend_port" != "$expected_backend_port" ]]; then
	echo "Local ports changed. Run ./scripts/setup.sh before starting Cortext." >&2
	exit 1
fi

exec node ./scripts/dev-server.mjs \
	--public-port "$public_port" \
	--backend-port "$backend_port" \
	--proxy-token-file "$token_path"
