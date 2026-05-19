<?php
/**
 * OPcache preload entrypoint for the Desktop runtime exploration.
 *
 * @package Cortext
 */

$manifest_path = __DIR__ . '/cortext-preload-manifest.php';
$compiled      = array();
$failed        = array();

if ( is_readable( $manifest_path ) && function_exists( 'opcache_compile_file' ) ) {
	$manifest = require $manifest_path;

	foreach ( $manifest as $relative_path ) {
		$file = __DIR__ . '/' . ltrim( $relative_path, '/' );

		if ( ! is_readable( $file ) ) {
			$failed[] = $relative_path;
			continue;
		}

		if ( @opcache_compile_file( $file ) ) {
			$compiled[] = $relative_path;
		} else {
			$failed[] = $relative_path;
		}
	}
}

$marker_path = getenv( 'CORTEXT_DESKTOP_PRELOAD_MARKER' ) ?: '';
if ( $marker_path ) {
	@file_put_contents(
		$marker_path,
		json_encode(
			array(
				'manifest'       => basename( $manifest_path ),
				'compiled_count' => count( $compiled ),
				'failed_count'   => count( $failed ),
				'failed'         => $failed,
				'generated_at'   => gmdate( 'c' ),
			),
			JSON_PRETTY_PRINT
		) . "\n"
	);
}
