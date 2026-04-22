<?php
/**
 * Admin menu item that points to the dedicated `/cortext/` shell URL.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Admin;

use Cortext\Shell\Shell;

final class MenuLink {

	private const MENU_SLUG = 'cortext';

	public function register(): void {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
	}

	public function register_menu(): void {
		$hook = add_menu_page(
			__( 'Cortext', 'cortext' ),
			__( 'Cortext', 'cortext' ),
			'edit_posts',
			self::MENU_SLUG,
			'__return_null',
			'dashicons-welcome-write-blog',
			3
		);

		add_action( 'load-' . $hook, array( $this, 'redirect_to_shell' ) );
	}

	public function redirect_to_shell(): void {
		wp_safe_redirect( home_url( '/' . Shell::ROUTE_PREFIX . '/' ) );
		exit;
	}
}
