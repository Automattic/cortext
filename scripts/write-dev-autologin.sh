#!/usr/bin/env bash
# Write the local-only autologin plugin for the dev wp-env. Run on every
# `scripts/run.sh` so existing worktrees pick up changes without a setup.
set -euo pipefail
cd "$(dirname "$0")/.."

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
		if ( ! preg_match( '/^((?:[a-z0-9-]+\.)?localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$/i', $host ) ) {
			return;
		}

		$uri = $_SERVER['REQUEST_URI'] ?? '';
		if ( ! str_starts_with( $uri, '/wp-admin/' ) && ! str_starts_with( $uri, '/wp-login.php' ) ) {
			return;
		}

		// Send other local hosts to the site's own host so no cookies land on
		// the localhost jar every worktree shares.
		$home = wp_parse_url( home_url() );
		$home_host = $home['host'] . ( isset( $home['port'] ) ? ':' . $home['port'] : '' );
		if ( strtolower( $host ) !== $home_host ) {
			wp_redirect( $home['scheme'] . '://' . $home_host . $uri );
			exit;
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
