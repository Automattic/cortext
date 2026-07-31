<?php
/**
 * Router for PHP's built-in server.
 *
 * Serves real files from disk and sends everything else through index.php,
 * matching the rewrite behavior WordPress expects from Apache or nginx.
 * The desktop snapshot copies this file into the bundled site.
 */

$expected_token  = getenv( 'CORTEXT_DESKTOP_AUTH_TOKEN' );
$expected_host   = getenv( 'CORTEXT_DESKTOP_RUNTIME_HOST' );
$expected_origin = getenv( 'CORTEXT_DESKTOP_RUNTIME_ORIGIN' );
$provided_token  = $_SERVER['HTTP_X_CORTEXT_DESKTOP_TOKEN'] ?? '';
$provided_host   = $_SERVER['HTTP_HOST'] ?? '';
$provided_origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if (
	! is_string( $expected_token ) ||
	$expected_token === '' ||
	! is_string( $expected_host ) ||
	$expected_host === '' ||
	! is_string( $expected_origin ) ||
	$expected_origin === '' ||
	! is_string( $provided_token ) ||
	! hash_equals( $expected_token, $provided_token ) ||
	! is_string( $provided_host ) ||
	! hash_equals( $expected_host, $provided_host ) ||
	! is_string( $provided_origin ) ||
	(
		$provided_origin !== '' &&
		! hash_equals( $expected_origin, $provided_origin )
	)
) {
	http_response_code( 403 );
	header( 'Cache-Control: no-store' );
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo 'Forbidden';
	exit;
}

require_once __DIR__ . '/cortext-runtime-bootstrap.php';

$uri = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
if ( $uri !== '/' && file_exists( __DIR__ . $uri ) ) {
	return false;
}
require_once __DIR__ . '/index.php';
