<?php
/**
 * Plugin Name: Cortext desktop update lock
 * Description: Keeps the desktop runtime unchanged between app releases.
 *
 * @package Cortext
 */

// The desktop wp-config defines CORTEXT_DESKTOP. Anywhere else, leave WordPress
// alone.
if ( ! defined( 'CORTEXT_DESKTOP' ) || ! CORTEXT_DESKTOP ) {
	return;
}

if ( ! defined( 'AUTOMATIC_UPDATER_DISABLED' ) ) {
	define( 'AUTOMATIC_UPDATER_DISABLED', true );
}
if ( ! defined( 'WP_AUTO_UPDATE_CORE' ) ) {
	define( 'WP_AUTO_UPDATE_CORE', false );
}
if ( ! defined( 'DISALLOW_FILE_MODS' ) ) {
	define( 'DISALLOW_FILE_MODS', true );
}
if ( ! defined( 'DISALLOW_FILE_EDIT' ) ) {
	define( 'DISALLOW_FILE_EDIT', true );
}

add_filter( 'automatic_updater_disabled', '__return_true', PHP_INT_MAX );
add_filter( 'auto_update_core', '__return_false', PHP_INT_MAX );
add_filter( 'allow_dev_auto_core_updates', '__return_false', PHP_INT_MAX );
add_filter( 'allow_minor_auto_core_updates', '__return_false', PHP_INT_MAX );
add_filter( 'allow_major_auto_core_updates', '__return_false', PHP_INT_MAX );
add_filter( 'auto_update_plugin', '__return_false', PHP_INT_MAX );
add_filter( 'auto_update_theme', '__return_false', PHP_INT_MAX );
add_filter( 'auto_update_translation', '__return_false', PHP_INT_MAX );
add_filter( 'file_mod_allowed', '__return_false', PHP_INT_MAX );
add_filter( 'admin_title', static fn (): string => 'Cortext', PHP_INT_MAX );

$empty_core_update_transient = static function (): stdClass {
	$transient                  = new stdClass();
	$transient->last_checked    = time();
	$transient->version_checked = function_exists( 'get_bloginfo' )
		? get_bloginfo( 'version' )
		: '';
	$transient->updates         = array();

	return $transient;
};

$empty_extension_update_transient = static function (): stdClass {
	$transient               = new stdClass();
	$transient->last_checked = time();
	$transient->checked      = array();
	$transient->response     = array();
	$transient->no_update    = array();
	$transient->translations = array();

	return $transient;
};

add_filter( 'pre_site_transient_update_core', $empty_core_update_transient, PHP_INT_MAX, 0 );
add_filter( 'pre_site_transient_update_plugins', $empty_extension_update_transient, PHP_INT_MAX, 0 );
add_filter( 'pre_site_transient_update_themes', $empty_extension_update_transient, PHP_INT_MAX, 0 );

add_filter(
	'user_has_cap',
	static function ( array $allcaps ): array {
		foreach (
			array(
				'delete_plugins',
				'delete_themes',
				'edit_files',
				'edit_plugins',
				'edit_themes',
				'install_plugins',
				'install_themes',
				'update_core',
				'update_languages',
				'update_plugins',
				'update_themes',
				'upload_plugins',
				'upload_themes',
			) as $capability
		) {
			$allcaps[ $capability ] = false;
		}

		return $allcaps;
	},
	PHP_INT_MAX
);

add_action(
	'init',
	static function (): void {
		remove_action( 'wp_version_check', 'wp_version_check' );
		remove_action( 'wp_update_plugins', 'wp_update_plugins' );
		remove_action( 'wp_update_themes', 'wp_update_themes' );
	},
	PHP_INT_MAX
);

add_action(
	'admin_init',
	static function (): void {
		remove_action( 'admin_notices', 'update_nag', 3 );
		remove_action( 'network_admin_notices', 'update_nag', 3 );
		remove_action( 'admin_notices', 'maintenance_nag' );
		remove_action( 'network_admin_notices', 'maintenance_nag' );
	},
	PHP_INT_MAX
);
