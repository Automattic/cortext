<?php
/**
 * Full-screen admin page for the Cortext shell.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Admin;

final class Page {

	private const MENU_SLUG  = 'cortext';
	private const SCRIPT_HANDLE = 'cortext-shell';

	private string $hook_suffix = '';

	public function register(): void {
		add_action( 'admin_menu', [ $this, 'register_menu' ] );
	}

	public function register_menu(): void {
		$this->hook_suffix = (string) add_menu_page(
			__( 'Cortext', 'cortext' ),
			__( 'Cortext', 'cortext' ),
			'edit_posts',
			self::MENU_SLUG,
			[ $this, 'render' ],
			'dashicons-welcome-write-blog',
			3
		);

		add_action( 'load-' . $this->hook_suffix, [ $this, 'on_load' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
	}

	public function on_load(): void {
		add_filter( 'admin_body_class', [ $this, 'add_fullscreen_body_class' ] );
	}

	public function add_fullscreen_body_class( string $classes ): string {
		return trim( $classes . ' is-fullscreen-mode' );
	}

	public function enqueue_assets( string $hook_suffix ): void {
		if ( $hook_suffix !== $this->hook_suffix ) {
			return;
		}

		$asset_path = CORTEXT_PATH . 'build/index.asset.php';
		if ( ! file_exists( $asset_path ) ) {
			return;
		}

		/** @var array{dependencies: string[], version: string} $asset */
		$asset = require $asset_path;

		wp_enqueue_script(
			self::SCRIPT_HANDLE,
			CORTEXT_URL . 'build/index.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_set_script_translations( self::SCRIPT_HANDLE, 'cortext' );

		// Pulls wp-components, wp-block-editor, wp-block-library styles transitively.
		wp_enqueue_style( 'wp-edit-blocks' );

		$style_path = CORTEXT_PATH . 'build/index.css';
		if ( file_exists( $style_path ) ) {
			wp_enqueue_style(
				self::SCRIPT_HANDLE,
				CORTEXT_URL . 'build/index.css',
				[],
				$asset['version']
			);
		}
	}

	public function render(): void {
		echo '<div id="cortext-root" class="cortext-root"></div>';
	}
}
