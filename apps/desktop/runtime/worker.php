<?php
/**
 * Experimental FrankenPHP worker for the desktop runtime spike.
 *
 * WordPress is not designed as a long-running worker. This file keeps core,
 * plugins, and autoloaders in memory, then re-enters the requested PHP script
 * for each request. It deliberately lives behind CORTEXT_RUNTIME=franken.
 */

if ( ! function_exists( 'frankenphp_handle_request' ) ) {
	require __DIR__ . '/index.php';
	return;
}

define( 'CORTEXT_FRANKENPHP_WORKER', true );

function cortext_desktop_worker_reset_request_state() {
	$GLOBALS['cortext_desktop_request_start'] = microtime( true );

	unset( $GLOBALS['wp_did_header'] );

	foreach ( array( 'wp_query', 'wp_the_query', 'wp', 'post', 'id', 'authordata' ) as $name ) {
		unset( $GLOBALS[ $name ] );
	}

	if ( class_exists( 'WP' ) ) {
		$GLOBALS['wp'] = new WP();
	}
	if ( class_exists( 'WP_Query' ) ) {
		$GLOBALS['wp_the_query'] = new WP_Query();
		$GLOBALS['wp_query']     = $GLOBALS['wp_the_query'];
	}
	if ( function_exists( 'wp_set_current_user' ) ) {
		wp_set_current_user( 0 );
	}
	if ( function_exists( 'wp_cache_flush_runtime' ) ) {
		wp_cache_flush_runtime();
	}
}

function cortext_desktop_worker_script_for_request() {
	$path = parse_url( $_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH );
	$path = is_string( $path ) && $path !== '' ? $path : '/';

	if ( $path !== '/' ) {
		$requested = realpath( __DIR__ . '/' . ltrim( $path, '/' ) );
		$root      = realpath( __DIR__ );
		if (
			$requested &&
			$root &&
			str_starts_with( $requested, $root ) &&
			is_file( $requested ) &&
			str_ends_with( $requested, '.php' )
		) {
			return $requested;
		}
	}

	return __DIR__ . '/index.php';
}

$handler = static function () {
	cortext_desktop_worker_reset_request_state();
	require cortext_desktop_worker_script_for_request();
};

$max_requests = (int) ( $_SERVER['MAX_REQUESTS'] ?? 500 );
for ( $handled = 0; $max_requests < 1 || $handled < $max_requests; ++$handled ) {
	$keep_running = frankenphp_handle_request( $handler );
	gc_collect_cycles();
	if ( ! $keep_running ) {
		break;
	}
}
