<?php
/**
 * Plugin Name: Cortext Dev Autologin
 *
 * @package Cortext
 */

declare( strict_types=1 );

function cortext_dev_autologin_is_loopback_host( string $host ): bool {
	if (
		1 !== preg_match(
			'/\A(?:localhost|127\.0\.0\.1|\[::1\])(?::([0-9]+))?\z/',
			$host,
			$matches
		)
	) {
		return false;
	}

	if ( ! isset( $matches[1] ) ) {
		return true;
	}

	$port = (int) $matches[1];
	return $port >= 1 && $port <= 65535;
}

function cortext_dev_autologin_request_host(): string {
	$header = isset( $_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] )
		? 'HTTP_X_CORTEXT_FORWARDED_HOST'
		: 'HTTP_HOST';

	if ( ! isset( $_SERVER[ $header ] ) || ! is_string( $_SERVER[ $header ] ) ) {
		return '';
	}

	// The local proxy replaces this header and proves the request with its private token.
	// Keep the raw value so normalization cannot turn a malformed host into loopback.
	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized,WordPress.Security.ValidatedSanitizedInput.MissingUnslash
	return $_SERVER[ $header ];
}

function cortext_dev_autologin_request_proxy_token(): string {
	if (
		! isset( $_SERVER['HTTP_X_CORTEXT_DEV_PROXY'] ) ||
		! is_string( $_SERVER['HTTP_X_CORTEXT_DEV_PROXY'] )
	) {
		return '';
	}

	return sanitize_text_field(
		wp_unslash( $_SERVER['HTTP_X_CORTEXT_DEV_PROXY'] )
	);
}

function cortext_dev_autologin_proxy_token(): string {
	static $token = null;

	if ( null !== $token ) {
		return $token;
	}

	$token_path = __DIR__ . '/.proxy-token.php';
	if ( ! is_readable( $token_path ) ) {
		$token = '';
		return $token;
	}

	$contents = require $token_path;
	$token    = is_string( $contents ) ? $contents : '';

	return $token;
}

function cortext_dev_autologin_matches_proxy_token(
	string $provided,
	string $expected
): bool {
	return '' !== $expected && hash_equals( $expected, $provided );
}

function cortext_dev_autologin_is_trusted_local_proxy_request(): bool {
	return cortext_dev_autologin_is_loopback_host(
		cortext_dev_autologin_request_host()
	) && cortext_dev_autologin_matches_proxy_token(
		cortext_dev_autologin_request_proxy_token(),
		cortext_dev_autologin_proxy_token()
	);
}

function cortext_dev_autologin_content_security_policy( string $host ): ?string {
	if ( ! cortext_dev_autologin_is_loopback_host( $host ) ) {
		return null;
	}

	return "frame-ancestors 'self' http://localhost:*;";
}

function cortext_dev_autologin_should_handle_request(
	string $host,
	string $uri,
	string $e2e_marker,
	bool $trusted_proxy
): bool {
	if (
		! $trusted_proxy ||
		'1' === $e2e_marker ||
		! cortext_dev_autologin_is_loopback_host( $host )
	) {
		return false;
	}

	return str_starts_with( $uri, '/wp-admin/' ) || str_starts_with( $uri, '/wp-login.php' );
}

function cortext_dev_autologin_remove_frame_options_hooks( string $host ): bool {
	if ( ! cortext_dev_autologin_is_loopback_host( $host ) ) {
		return false;
	}

	remove_action( 'admin_init', 'send_frame_options_header', 10 );
	remove_action( 'login_init', 'send_frame_options_header', 10 );

	return true;
}

function cortext_dev_autologin_allow_local_framing(): void {
	if ( ! cortext_dev_autologin_is_trusted_local_proxy_request() ) {
		return;
	}

	$host   = cortext_dev_autologin_request_host();
	$policy = cortext_dev_autologin_content_security_policy( $host );

	if ( null === $policy ) {
		return;
	}

	if ( ! cortext_dev_autologin_remove_frame_options_hooks( $host ) ) {
		return;
	}

	header_remove( 'X-Frame-Options' );
	header( "Content-Security-Policy: {$policy}" );
}

function cortext_dev_autologin_set_request_auth_cookie(
	string $cookie,
	int $expire,
	int $expiration,
	int $user_id,
	string $scheme
): void {
	$_COOKIE[ 'secure_auth' === $scheme ? SECURE_AUTH_COOKIE : AUTH_COOKIE ] = $cookie;
}

function cortext_dev_autologin_set_request_logged_in_cookie( string $cookie ): void {
	$_COOKIE[ LOGGED_IN_COOKIE ] = $cookie;
}

function cortext_dev_autologin_maybe_login(): void {
	if ( is_user_logged_in() || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
		return;
	}

	$host       = cortext_dev_autologin_request_host();
	$uri        = isset( $_SERVER['REQUEST_URI'] )
		? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) )
		: '';
	$e2e_marker = isset( $_SERVER['HTTP_X_CORTEXT_E2E'] )
		? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_CORTEXT_E2E'] ) )
		: '';

	if (
		! cortext_dev_autologin_should_handle_request(
			$host,
			$uri,
			$e2e_marker,
			cortext_dev_autologin_is_trusted_local_proxy_request()
		)
	) {
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

	// auth_redirect() validates request cookies, including on the request that creates them.
	add_action( 'set_auth_cookie', 'cortext_dev_autologin_set_request_auth_cookie', 10, 5 );
	add_action( 'set_logged_in_cookie', 'cortext_dev_autologin_set_request_logged_in_cookie' );
	wp_set_auth_cookie( $user_id, true, is_ssl() );
	remove_action( 'set_auth_cookie', 'cortext_dev_autologin_set_request_auth_cookie', 10 );
	remove_action( 'set_logged_in_cookie', 'cortext_dev_autologin_set_request_logged_in_cookie' );
}

add_action( 'admin_init', 'cortext_dev_autologin_allow_local_framing', 0 );
add_action( 'login_init', 'cortext_dev_autologin_allow_local_framing', 0 );
add_action( 'init', 'cortext_dev_autologin_maybe_login', 1 );
