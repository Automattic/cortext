<?php
/**
 * Plugin Name: Cortext desktop runtime probe
 * Description: Reports local php -S runtime tuning state.
 *
 * @package Cortext
 */

if ( getenv( 'CORTEXT_DESKTOP_RUNTIME_PROBE' ) !== '1' ) {
	return;
}

function cortext_desktop_probe_ini_bool( string $name ): bool {
	return in_array( strtolower( (string) ini_get( $name ) ), array( '1', 'on', 'true', 'yes' ), true );
}

function cortext_desktop_probe_count_files( string $dir ): int {
	if ( $dir === '' || ! is_dir( $dir ) ) {
		return 0;
	}

	$count = 0;
	$files = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS )
	);

	foreach ( $files as $file ) {
		if ( $file->isFile() ) {
			++$count;
		}
	}

	return $count;
}

function cortext_desktop_probe_opcache(): array {
	$file_cache = (string) ini_get( 'opcache.file_cache' );
	$status     = function_exists( 'opcache_get_status' )
		? @opcache_get_status( false )
		: false;
	$marker     = getenv( 'CORTEXT_DESKTOP_PRELOAD_MARKER' ) ?: '';
	$preload    = null;

	if ( $marker && is_readable( $marker ) ) {
		$preload = json_decode( (string) file_get_contents( $marker ), true );
	}

	return array(
		'extension_loaded'         => extension_loaded( 'Zend OPcache' ),
		'enable'                   => cortext_desktop_probe_ini_bool( 'opcache.enable' ),
		'enable_cli'               => cortext_desktop_probe_ini_bool( 'opcache.enable_cli' ),
		'validate_timestamps'      => cortext_desktop_probe_ini_bool( 'opcache.validate_timestamps' ),
		'file_cache'               => $file_cache,
		'file_cache_files'         => cortext_desktop_probe_count_files( $file_cache ),
		'preload'                  => (string) ini_get( 'opcache.preload' ),
		'preload_marker'           => $preload,
		'jit'                      => (string) ini_get( 'opcache.jit' ),
		'jit_buffer_size'          => (string) ini_get( 'opcache.jit_buffer_size' ),
		'status_available'         => is_array( $status ),
		'opcache_enabled'          => is_array( $status ) ? (bool) ( $status['opcache_enabled'] ?? false ) : false,
		'cached_scripts'           => is_array( $status ) ? (int) ( $status['opcache_statistics']['num_cached_scripts'] ?? 0 ) : 0,
		'jit_enabled'              => is_array( $status ) ? (bool) ( $status['jit']['enabled'] ?? false ) : false,
		'jit_on'                   => is_array( $status ) ? (bool) ( $status['jit']['on'] ?? false ) : false,
		'jit_buffer_used'          => is_array( $status ) ? (int) ( $status['jit']['buffer_used'] ?? 0 ) : 0,
	);
}

function cortext_desktop_probe_apcu(): array {
	$key             = 'cortext_desktop_runtime_probe_' . md5( ABSPATH );
	$previous_found  = false;
	$previous_value  = false;
	$current_value   = uniqid( 'probe_', true );
	$store_succeeded = false;

	if ( function_exists( 'apcu_fetch' ) ) {
		$previous_value = apcu_fetch( $key, $previous_found );
	}
	if ( function_exists( 'apcu_store' ) ) {
		$store_succeeded = apcu_store( $key, $current_value, 300 );
	}

	return array(
		'extension_loaded'      => extension_loaded( 'apcu' ),
		'apc_enabled'           => cortext_desktop_probe_ini_bool( 'apc.enabled' ),
		'apc_enable_cli'        => cortext_desktop_probe_ini_bool( 'apc.enable_cli' ),
		'functions_available'   => function_exists( 'apcu_fetch' ) && function_exists( 'apcu_store' ),
		'store_succeeded'       => (bool) $store_succeeded,
		'previous_value_found'  => (bool) $previous_found,
		'previous_value_sample' => $previous_found ? (string) $previous_value : null,
	);
}

function cortext_desktop_probe_object_cache(): array {
	global $wp_object_cache;

	$found          = false;
	$key            = 'runtime_probe';
	$group          = 'cortext_desktop_probe';
	$previous_value = wp_cache_get( $key, $group, false, $found );
	$current_value  = uniqid( 'wp_cache_', true );
	$set_succeeded  = wp_cache_set( $key, $current_value, $group, 300 );
	$stats          = method_exists( $wp_object_cache, 'cortext_stats' )
		? $wp_object_cache->cortext_stats()
		: null;

	return array(
		'using_external_object_cache' => wp_using_ext_object_cache(),
		'class'                       => is_object( $wp_object_cache ) ? get_class( $wp_object_cache ) : null,
		'set_succeeded'               => (bool) $set_succeeded,
		'previous_value_found'        => (bool) $found,
		'previous_value_sample'       => $found ? (string) $previous_value : null,
		'stats'                       => $stats,
	);
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'cortext-desktop/v1',
			'/runtime-probe',
			array(
				'methods'             => 'GET',
				'permission_callback' => '__return_true',
				'callback'            => function () {
					return rest_ensure_response(
						array(
							'php'          => array(
								'version'  => PHP_VERSION,
								'sapi'     => PHP_SAPI,
								'binary'   => PHP_BINARY,
								'pid'      => getmypid(),
								'pcre_jit' => cortext_desktop_probe_ini_bool( 'pcre.jit' ),
							),
							'opcache'      => cortext_desktop_probe_opcache(),
							'apcu'         => cortext_desktop_probe_apcu(),
							'object_cache' => cortext_desktop_probe_object_cache(),
						)
					);
				},
			)
		);
	}
);
