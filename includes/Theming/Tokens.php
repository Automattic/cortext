<?php
/**
 * Cortext shell design tokens (v1).
 *
 * This is the PHP side of the token contract. The same values are declared
 * in src/styles/_tokens.scss for the admin shell chrome; here we emit them
 * as raw CSS for two surfaces that the SCSS bundle cannot reach:
 *
 * - The Gutenberg canvas iframe. Screen.php appends the CSS string to
 *   `editor_settings['styles']`, which core hands to BlockCanvas and
 *   propagates across the iframe boundary.
 * - Public frontend pages. The `wp_head` hook prints the CSS on every
 *   frontend response so the Cortext patterns' inline `var(--cortext-*)`
 *   references resolve outside the shell. Emission is unconditional: once
 *   a pattern is inserted into a post it is indistinguishable from any
 *   other block content, so gating on pattern presence is not reliable.
 *   The declarations are a small static string with no dynamic input.
 *
 * The iframe variant emits light values only. The iframe interior is
 * the active block theme's domain, so nothing in Cortext's contract
 * pushes dark values across the iframe boundary. The shell SCSS may
 * carry dark overrides (see src/styles/_tokens.scss); the iframe does
 * not inherit them. The frontend variant hardcodes the accent literal
 * because `--wp-admin-theme-color` is not defined on the public site.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Theming;

final class Tokens {

	public function register(): void {
		add_action( 'wp_head', array( $this, 'print_frontend_css' ) );
	}

	/**
	 * CSS for the Gutenberg canvas iframe.
	 *
	 * Emitted into `editor_settings['styles']` so it crosses the iframe
	 * boundary. Light values only. The iframe interior is painted by the
	 * active block theme, not by this contract.
	 */
	public function get_iframe_inline_css(): string {
		return ':root {' . $this->light_declarations( true ) . '}';
	}

	/**
	 * CSS for the public frontend.
	 *
	 * Printed in `wp_head` on every frontend response so Cortext patterns
	 * have the tokens available wherever they render. Frontend has no
	 * wp-admin theme color, so the accent falls back to a hardcoded literal.
	 */
	public function get_frontend_inline_css(): string {
		return ':root {' . $this->light_declarations( false ) . '}';
	}

	public function print_frontend_css(): void {
		// Static CSS compiled from an allowlist of property/value strings; no
		// dynamic input reaches this output.
		echo '<style id="cortext-tokens">' . $this->get_frontend_inline_css() . '</style>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	/**
	 * Token declarations as a CSS fragment.
	 *
	 * @param bool $use_admin_accent When true, accent falls through to
	 *                               `--wp-admin-theme-color` for admin/iframe
	 *                               contexts. Frontend pages pass false.
	 */
	private function light_declarations( bool $use_admin_accent ): string {
		$accent = $use_admin_accent
			? 'var(--wp-admin-theme-color, #3858e9)'
			: '#3858e9';

		return implode(
			'',
			array(
				// Color.
				'--cortext-color-canvas: #fff;',
				'--cortext-color-surface: #fff;',
				'--cortext-color-surface-raised: #f0f0f0;',
				'--cortext-color-border: #e0e0e0;',
				'--cortext-color-text: #1e1e1e;',
				'--cortext-color-text-muted: #757575;',
				'--cortext-color-accent: ' . $accent . ';',
				'--cortext-color-accent-contrast: #fff;',
				'--cortext-color-shadow: rgba(0, 0, 0, 0.12);',

				// Typography.
				'--cortext-font-family: inherit;',
				'--cortext-font-size-body: 13px;',
				'--cortext-font-size-ui: 13px;',

				// Spacing.
				'--cortext-space-xs: 4px;',
				'--cortext-space-sm: 8px;',
				'--cortext-space-md: 12px;',
				'--cortext-space-lg: 16px;',
				'--cortext-space-xl: 24px;',

				// Structural.
				'--cortext-radius-sm: 2px;',
				'--cortext-border-width: 1px;',
			)
		);
	}
}
