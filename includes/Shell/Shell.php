<?php
/**
 * Dedicated `/cortext/` URL that renders the React shell.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Shell;

final class Shell {

	public const ROUTE_PREFIX = 'cortext';

	private const QUERY_VAR     = 'cortext_shell';
	private const SCRIPT_HANDLE = 'cortext-shell';

	public function register(): void {
		add_action( 'init', array( $this, 'register_rewrite' ) );
		add_filter( 'query_vars', array( $this, 'register_query_vars' ) );
		add_filter( 'template_include', array( $this, 'maybe_render_shell' ) );
		add_filter( 'redirect_canonical', array( $this, 'prevent_canonical_redirect' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
	}

	public function register_rewrite(): void {
		add_rewrite_rule(
			'^' . self::ROUTE_PREFIX . '(?:/.*)?/?$',
			'index.php?' . self::QUERY_VAR . '=1',
			'top'
		);
	}

	/**
	 * Whitelist the shell query var so WP picks it up from the rewrite.
	 *
	 * @param string[] $vars
	 * @return string[]
	 */
	public function register_query_vars( array $vars ): array {
		$vars[] = self::QUERY_VAR;
		return $vars;
	}

	public function maybe_render_shell( string $template ): string {
		if ( ! get_query_var( self::QUERY_VAR ) ) {
			return $template;
		}

		if ( ! is_user_logged_in() ) {
			auth_redirect();
			exit;
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_die(
				esc_html__( 'You do not have permission to access Cortext.', 'cortext' ),
				esc_html__( 'Cortext', 'cortext' ),
				array( 'response' => 403 )
			);
		}

		// Cortext owns the full viewport; suppress the front-end admin bar so
		// it doesn't paint over the shell or push `html` down with its
		// `wp-toolbar` padding.
		show_admin_bar( false );

		status_header( 200 );
		nocache_headers();

		return CORTEXT_PATH . 'includes/Shell/template.php';
	}

	/**
	 * Skip canonical redirects on the shell URL so the rewrite stays intact.
	 *
	 * @param string|false $redirect_url
	 * @return string|false
	 */
	public function prevent_canonical_redirect( $redirect_url ) {
		if ( get_query_var( self::QUERY_VAR ) ) {
			return false;
		}
		return $redirect_url;
	}

	public function enqueue_assets(): void {
		if ( ! get_query_var( self::QUERY_VAR ) ) {
			return;
		}

		$asset_path = CORTEXT_PATH . 'build/index.asset.php';
		if ( ! file_exists( $asset_path ) ) {
			return;
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
					'adminUrl'    => admin_url(),
					'routePrefix' => self::ROUTE_PREFIX,
				)
			) . ';',
			'before'
		);

		wp_set_script_translations( self::SCRIPT_HANDLE, 'cortext' );

		// `get_block_editor_settings()` builds the iframe's resolved
		// assets from whatever stylesheets are currently registered.
		// The Cortext shell renders at `/cortext/` — a frontend URL,
		// so `is_admin()` is false and `wp_should_load_separate_core_block_assets()`
		// returns true on block themes. That splits block CSS in two
		// ways the iframe can't recover from:
		//   1. `wp-block-library` is registered pointing at `common.css`
		//      (reset only) instead of `style.css` (full block styles —
		//      Quote borders, Code styling, etc.).
		//   2. Per-block theme.json rules (TT5's Quote border, etc.) are
		//      attached to `wp-block-<name>` handles that only enqueue
		//      when the block actually renders on the page — never here.
		// `wp-admin/post.php` doesn't hit either: admin forces the flag
		// false so both pieces land on `wp-block-library` + `global-styles`
		// directly. Reproduce that here.
		//
		// We tried filtering `should_load_separate_core_block_assets` to
		// false on this route (cleaner extension point) but the filter
		// runs too late: `wp_default_styles` fires from a plugin earlier
		// in load order, registering `wp-block-library` against
		// `common.css` before our hook attaches. Mutating the
		// already-registered handle here is the only reliable point.
		global $wp_styles;
		if ( ! $wp_styles ) {
			wp_styles();
		}
		$block_library_dep          = $wp_styles->registered['wp-block-library'] ?? null;
		$original_block_library_src = null;
		if ( $block_library_dep ) {
			$original_block_library_src = $block_library_dep->src;
			$suffix                     = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';
			$block_library_dep->src     = "/wp-includes/css/dist/block-library/style{$suffix}.css";
		}

		$theme_json  = \WP_Theme_JSON_Resolver::get_merged_data();
		$block_nodes = $theme_json->get_styles_block_nodes();
		foreach ( $block_nodes as $node ) {
			$block_css = $theme_json->get_styles_for_block( $node );
			if ( $block_css ) {
				wp_add_inline_style( 'global-styles', $block_css );
			}
		}

		$editor_context  = new \WP_Block_Editor_Context( [ 'name' => 'core/edit-post' ] );
		$editor_settings = get_block_editor_settings( [], $editor_context );

		if ( $block_library_dep ) {
			$block_library_dep->src = $original_block_library_src;
		}

		wp_add_inline_script(
			self::SCRIPT_HANDLE,
			'window.cortextEditorSettings = ' . wp_json_encode( $editor_settings ) . ';',
			'before'
		);

		// `wp-edit-blocks` only ships `block-editor/content.css`; the block
		// toolbar popover needs `block-editor/style.css` (`wp-block-editor`).
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
}
