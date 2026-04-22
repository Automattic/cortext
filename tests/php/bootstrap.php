<?php
/**
 * PHPUnit bootstrap for Cortext.
 *
 * @package Cortext
 */

declare( strict_types=1 );

$cortext_root = dirname( __DIR__, 2 );

require_once $cortext_root . '/vendor/autoload.php';

// Constants normally defined by cortext.php (main plugin file).
define( 'CORTEXT_PATH', $cortext_root . '/' );
define( 'CORTEXT_URL', 'http://example.org/wp-content/plugins/cortext/' );

\WorDBless\Load::load();
