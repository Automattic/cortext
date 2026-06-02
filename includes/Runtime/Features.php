<?php
/**
 * Feature defaults for each Cortext runtime.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Runtime;

defined( 'ABSPATH' ) || exit;

final class Features {

	public function is_desktop(): bool {
		return defined( 'CORTEXT_DESKTOP' ) && (bool) CORTEXT_DESKTOP;
	}

	public function public_web_affordances_enabled(): bool {
		$enabled = ! $this->is_desktop();

		/**
		 * Filters whether Cortext should show public-web controls.
		 *
		 * This covers the publish toggles, their copy-link buttons, and the
		 * Published documents surface. Desktop leaves them off by default.
		 *
		 * @param bool $enabled Whether public-web controls are enabled.
		 */
		return (bool) apply_filters( 'cortext_public_web_affordances_enabled', $enabled );
	}

	public function wordpress_affordances_enabled(): bool {
		$enabled = ! $this->is_desktop();

		/**
		 * Filters whether Cortext should show links back to WordPress.
		 *
		 * Desktop hides these because the app should feel like Cortext, not
		 * wp-admin with a shortcut out.
		 *
		 * @param bool $enabled Whether WordPress links are enabled.
		 */
		return (bool) apply_filters( 'cortext_wordpress_affordances_enabled', $enabled );
	}

	/**
	 * Returns the flags consumed by the React shell.
	 *
	 * @return array{publicWebAffordances: bool, wordpressAffordances: bool}
	 */
	public function to_client_settings(): array {
		return array(
			'publicWebAffordances' => $this->public_web_affordances_enabled(),
			'wordpressAffordances' => $this->wordpress_affordances_enabled(),
		);
	}
}
