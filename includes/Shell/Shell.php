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

		// Pulls wp-components, wp-block-editor, wp-block-library styles transitively.
		wp_enqueue_style( 'wp-edit-blocks' );

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
