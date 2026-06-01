<?php
/**
 * Wp-admin top-level page that hosts the Cortext React shell.
 *
 * Lives under `wp-admin/admin.php?page=cortext` so `is_admin()` is true and
 * the editor inherits admin defaults: `wp_should_load_separate_core_block_assets()`
 * is false (full block CSS lands on `wp-block-library` + `global-styles`),
 * the admin bar belongs to wp-admin chrome we hide via body class, and the
 * REST nonce / user context are already set up.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Admin;

use Cortext\Runtime\Features;
use Cortext\Theming\Preferences;

final class Screen {

	public const MENU_SLUG      = 'cortext';
	public const HOOK_SUFFIX    = 'toplevel_page_' . self::MENU_SLUG;
	private const SCRIPT_HANDLE = 'cortext-shell';
	private const BODY_CLASS    = 'cortext-fullscreen';
	private const ICON_PATH     = 'assets/brand/icon-light.png';

	public function register(): void {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_head-' . self::HOOK_SUFFIX, array( $this, 'render_favicon' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		// tech-debt.md#td-command-palette-host-glue: core adds this late; run after it so this
		// screen only has one palette.
		add_action( 'admin_enqueue_scripts', array( $this, 'dequeue_core_command_palette' ), 100 );
		add_filter( 'admin_body_class', array( $this, 'add_body_class' ) );
	}

	public function register_menu(): void {
		add_menu_page(
			__( 'Cortext', 'cortext' ),
			__( 'Cortext', 'cortext' ),
			'edit_posts',
			self::MENU_SLUG,
			array( $this, 'render' ),
			'dashicons-welcome-write-blog',
			3
		);
	}

	public function render(): void {
		echo '<div id="cortext-root" class="cortext-root"></div>';
	}

	public function render_favicon(): void {
		printf(
			'<link rel="icon" href="%s" sizes="256x256" type="image/png" />' . "\n",
			esc_url( $this->icon_url() )
		);
	}

	public function icon_url(): string {
		return CORTEXT_URL . self::ICON_PATH;
	}

	public function enqueue_assets( string $hook_suffix ): void {
		if ( self::HOOK_SUFFIX !== $hook_suffix ) {
			return;
		}

		// Loads wp.media so MediaUpload (in the icon picker popover and the
		// core/post-featured-image block inside the editor iframe) can open
		// the WordPress media library.
		wp_enqueue_media();
		wp_enqueue_script( 'heartbeat' );
		wp_add_inline_script(
			'heartbeat',
			'if ( window.wp && wp.heartbeat ) { wp.heartbeat.interval( 10 ); }'
		);

		$asset_path = CORTEXT_PATH . 'build/index.asset.php';
		if ( ! file_exists( $asset_path ) ) {
			// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped
			throw new \Exception( "Missing asset file at '$asset_path'" );
		}

		/**
		 * Script asset manifest emitted by @wordpress/scripts.
		 *
		 * @var array{dependencies: string[], version: string} $asset
		 */
		$asset = require $asset_path;

		wp_enqueue_script(
			self::SCRIPT_HANDLE,
			CORTEXT_URL . 'build/index.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_add_inline_script(
			self::SCRIPT_HANDLE,
			'window.cortextSettings = ' . wp_json_encode(
				array(
					'adminUrl' => admin_url(),
					'features' => ( new Features() )->to_client_settings(),
					'iconUrl'  => $this->icon_url(),
					'menuSlug' => self::MENU_SLUG,
				)
			) . ';',
			'before'
		);

		// Shell color-scheme pre-mount script: stamps `data-theme` on
		// `#cortext-root` before React mounts so the first paint matches
		// the user's preference without a flash.
		wp_add_inline_script(
			self::SCRIPT_HANDLE,
			( new Preferences() )->get_bootstrap_js(),
			'before'
		);

		wp_set_script_translations( self::SCRIPT_HANDLE, 'cortext' );

		// Resolve the stylesheets the iframe canvas needs (core block CSS,
		// theme.json global styles, etc.) and hand them to EditorProvider via
		// a global. In admin context `wp_should_load_separate_core_block_assets()`
		// is false, so `wp-block-library` is registered pointing at the full
		// `style.css` — no src-swap or theme.json loop needed here.
		$editor_context  = new \WP_Block_Editor_Context( array( 'name' => 'core/edit-post' ) );
		$editor_settings = get_block_editor_settings( array(), $editor_context );

		if ( ! isset( $editor_settings['styles'] ) || ! is_array( $editor_settings['styles'] ) ) {
			$editor_settings['styles'] = array();
		}
		if ( ! isset( $editor_settings['postLock'] ) || ! is_array( $editor_settings['postLock'] ) ) {
			$editor_settings['postLock'] = array();
		}
		$editor_settings['postLock'] = array_merge(
			array( 'isLocked' => false ),
			$editor_settings['postLock']
		);
		if ( ! isset( $editor_settings['postLockUtils'] ) || ! is_array( $editor_settings['postLockUtils'] ) ) {
			$editor_settings['postLockUtils'] = array();
		}
		$editor_settings['postLockUtils'] = array_merge(
			array(
				'nonce'       => '',
				'unlockNonce' => '',
				'ajaxUrl'     => admin_url( 'admin-ajax.php' ),
			),
			$editor_settings['postLockUtils']
		);

		// The block editor iframe only sees stylesheets listed in
		// `editor_settings.styles`. Webpack splits Cortext's CSS into
		// `build/index.css` (shell chrome) and `build/editor.css` (editor
		// surfaces: column chrome, cell rendering, DataViews CSS, data-view
		// block). Both need to reach the iframe. `@import` inside the `css`
		// entry gets stripped by core's transformStyles, so inline each
		// file.
		// FIXME: the data-view block should declare its own `editorStyle`
		// in `block.json` so WP propagates it to the iframe natively. This
		// is the stop-gap until then.
		foreach ( array( 'build/index.css', 'build/editor.css' ) as $relative ) {
			$style_path = CORTEXT_PATH . $relative;
			if ( ! file_exists( $style_path ) ) {
				continue;
			}
			$style_css = file_get_contents( $style_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			if ( is_string( $style_css ) && '' !== $style_css ) {
				$editor_settings['styles'][] = array( 'css' => $style_css );
			}
		}

		wp_add_inline_script(
			self::SCRIPT_HANDLE,
			'window.cortextEditorSettings = ' . wp_json_encode( $editor_settings ) . ';',
			'before'
		);

		// `wp-edit-blocks` ships `block-editor/content.css` (canvas styles);
		// `wp-block-editor` adds `block-editor/style.css` (toolbar popover).
		wp_enqueue_style( 'wp-edit-blocks' );
		wp_enqueue_style( 'wp-block-editor' );

		$style_path = CORTEXT_PATH . 'build/index.css';
		if ( file_exists( $style_path ) ) {
			wp_enqueue_style(
				self::SCRIPT_HANDLE,
				CORTEXT_URL . 'build/index.css',
				array(),
				$asset['version']
			);
		}
	}

	public function dequeue_core_command_palette( string $hook_suffix ): void {
		if ( self::HOOK_SUFFIX !== $hook_suffix ) {
			return;
		}

		// tech-debt.md#td-command-palette-host-glue: Cortext has its own palette here, so drop core's
		// wp-admin palette before global commands leak into the app.
		wp_dequeue_script( 'wp-core-commands' );
	}

	public function add_body_class( string $classes ): string {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && self::HOOK_SUFFIX === $screen->id ) {
			$classes .= ' ' . self::BODY_CLASS;
		}
		return $classes;
	}
}
