<?php
/**
 * Router for PHP's built-in server.
 *
 * Serves real files from disk and sends everything else through index.php,
 * matching the rewrite behavior WordPress expects from Apache or nginx.
 * The desktop snapshot copies this file into the bundled site.
 */

$uri = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
if ( $uri !== '/' && file_exists( __DIR__ . $uri ) ) {
	return false;
}
require_once __DIR__ . '/index.php';
