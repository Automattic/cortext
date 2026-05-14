#!/usr/bin/env bash
# One-time worktree setup: install deps and write the per-worktree wp-env
# config (port + local helper plugins). Safe to re-run.

set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install
composer install --no-interaction

hash_cmd=$(command -v shasum || command -v sha1sum)
hash=$(printf '%s' "$PWD" | "$hash_cmd" | awk '{print $1}')
port=$(( 8000 + 16#${hash:0:6} % 1000 ))

cat > .wp-env.override.json <<EOF
{ "port": ${port}, "plugins": [ ".", "./.wp-env-plugins/worktree-label", "./.wp-env-plugins/dev-autologin" ] }
EOF

"$(dirname "$0")/refresh-label.sh"

mkdir -p .wp-env-plugins/dev-autologin
cat > .wp-env-plugins/dev-autologin/dev-autologin.php <<'EOF'
<?php
/* Plugin Name: Cortext Dev Autologin */

add_action(
	'init',
	static function () {
		if ( is_user_logged_in() || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
			return;
		}

		$host = $_SERVER['HTTP_HOST'] ?? '';
		if ( ! preg_match( '/^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$/', $host ) ) {
			return;
		}

		$uri = $_SERVER['REQUEST_URI'] ?? '';
		if ( ! str_starts_with( $uri, '/wp-admin/' ) && ! str_starts_with( $uri, '/wp-login.php' ) ) {
			return;
		}

		$users = get_users(
			array(
				'role'   => 'administrator',
				'number' => 1,
				'fields' => array( 'ID' ),
			)
		);

		$user_id = $users ? (int) $users[0]->ID : 1;
		wp_set_current_user( $user_id );
		wp_set_auth_cookie( $user_id, true, is_ssl() );

		wp_safe_redirect( ( is_ssl() ? 'https://' : 'http://' ) . $host . $uri );
		exit;
	},
	1
);
EOF
