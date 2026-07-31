<?php
/**
 * Defines the per-profile desktop runtime origin before WordPress loads.
 *
 * Existing desktop sites keep their generated wp-config.php across app
 * upgrades. Defining these guarded constants here lets those sites move away
 * from the legacy fixed port without replacing salts or other user config.
 */

$cortext_desktop_runtime_origin = getenv( 'CORTEXT_DESKTOP_RUNTIME_ORIGIN' );

if (
	! is_string( $cortext_desktop_runtime_origin ) ||
	! preg_match(
		'/\Ahttp:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\z/D',
		$cortext_desktop_runtime_origin,
		$cortext_desktop_runtime_origin_match
	) ||
	(int) $cortext_desktop_runtime_origin_match[1] > 65535
) {
	throw new RuntimeException( 'Invalid Cortext desktop runtime origin.' );
}

if ( ! defined( 'WP_HOME' ) ) {
	define( 'WP_HOME', $cortext_desktop_runtime_origin );
}
if ( ! defined( 'WP_SITEURL' ) ) {
	define( 'WP_SITEURL', $cortext_desktop_runtime_origin );
}

unset(
	$cortext_desktop_runtime_origin,
	$cortext_desktop_runtime_origin_match
);
