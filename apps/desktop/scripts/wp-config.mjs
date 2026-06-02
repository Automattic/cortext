import { randomBytes } from 'node:crypto';

export function randomSalt() {
	// 64 ASCII chars, matching WP's generated salt length.
	return randomBytes( 48 ).toString( 'base64' ).slice( 0, 64 );
}

export function buildWpConfig() {
	const constants = [
		[ 'DB_NAME', 'database_name_here' ],
		[ 'DB_USER', 'username_here' ],
		[ 'DB_PASSWORD', 'password_here' ],
		[ 'DB_HOST', 'localhost' ],
		[ 'DB_CHARSET', 'utf8mb4' ],
		[ 'DB_COLLATE', '' ],
	];
	const saltKeys = [
		'AUTH_KEY',
		'SECURE_AUTH_KEY',
		'LOGGED_IN_KEY',
		'NONCE_KEY',
		'AUTH_SALT',
		'SECURE_AUTH_SALT',
		'LOGGED_IN_SALT',
		'NONCE_SALT',
	];
	const lines = [ '<?php' ];
	for ( const [ name, value ] of constants ) {
		lines.push( `define( '${ name }', '${ value }' );` );
	}
	for ( const key of saltKeys ) {
		lines.push( `define( '${ key }', '${ randomSalt() }' );` );
	}
	lines.push( "$table_prefix = 'wp_';" );
	const guardedConstants = [
		[ 'WP_HOME', "'http://127.0.0.1:9402'" ],
		[ 'WP_SITEURL', "'http://127.0.0.1:9402'" ],
		[ 'CORTEXT_DESKTOP', 'true' ],
		[ 'DISABLE_WP_CRON', 'true' ],
		// The mu-plugin repeats these for desktop sites created by older builds.
		[ 'AUTOMATIC_UPDATER_DISABLED', 'true' ],
		[ 'WP_AUTO_UPDATE_CORE', 'false' ],
		[ 'DISALLOW_FILE_MODS', 'true' ],
		[ 'DISALLOW_FILE_EDIT', 'true' ],
	];
	for ( const [ name, literal ] of guardedConstants ) {
		lines.push(
			`if ( ! defined( '${ name }' ) ) { define( '${ name }', ${ literal } ); }`
		);
	}
	lines.push(
		"$GLOBALS['cortext_desktop_request_start'] = microtime( true );"
	);
	lines.push(
		"if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', __DIR__ . '/' ); }"
	);
	lines.push( "require_once ABSPATH . 'wp-settings.php';" );
	return lines.join( '\n' ) + '\n';
}
