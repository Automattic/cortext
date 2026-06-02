<?php
/**
 * Plugin Name: Cortext desktop autologin
 * Description: Skips wp-login for the desktop runtime.
 *              Mu-plugins load before pluggable.php. Defining
 *              `auth_redirect()` here stops core from redirecting to
 *              wp-login, and the `determine_current_user` filter maps each
 *              request to the local admin so wp-admin works without a
 *              session cookie.
 *
 * Desktop-only. Do not load this on a public site; it disables auth. The
 * desktop snapshot build copies it into place.
 *
 * @package Cortext
 */

// Inert unless this is the desktop app. The desktop wp-config defines
// CORTEXT_DESKTOP; anywhere else this file must do nothing.
if ( ! defined( 'CORTEXT_DESKTOP' ) || ! CORTEXT_DESKTOP ) {
	return;
}

if ( ! function_exists( 'auth_redirect' ) ) {
	function auth_redirect() {
		return;
	}
}

add_filter(
	'determine_current_user',
	function ( $user_id ) {
		if ( $user_id ) {
			return $user_id;
		}
		if ( function_exists( 'wp_installing' ) && wp_installing() ) {
			return $user_id;
		}
		$admin = get_user_by( 'login', 'admin' );
		return $admin ? $admin->ID : $user_id;
	},
	9999
);
