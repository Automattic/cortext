<?php
/**
 * Plugin Name: Cortext desktop timing
 * Description: Adds Server-Timing to desktop runtime responses for local spike measurements.
 *
 * @package Cortext
 */

$cortext_desktop_emit_timing = function () {
	static $sent = false;

	if ( $sent || headers_sent() ) {
		return;
	}

	$started = $GLOBALS['cortext_desktop_request_start'] ?? ( $_SERVER['REQUEST_TIME_FLOAT'] ?? null );
	if ( ! is_numeric( $started ) ) {
		return;
	}

	$sent     = true;
	$duration = max( 0, ( microtime( true ) - (float) $started ) * 1000 );
	header( 'Server-Timing: cortext_wp;dur=' . round( $duration, 3 ) );
};

if ( function_exists( 'header_register_callback' ) ) {
	header_register_callback( $cortext_desktop_emit_timing );
}

add_action( 'shutdown', $cortext_desktop_emit_timing, PHP_INT_MAX );
