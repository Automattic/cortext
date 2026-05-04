<?php
/**
 * Shell preferences bootstrap.
 *
 * Emits a tiny pre-mount script that reads the user's color-scheme
 * preference from `localStorage`, resolves `auto` against the system
 * `prefers-color-scheme` media query, and stamps the result on
 * `#cortext-root` as `data-theme`. Running before React mounts removes
 * the flash between the root element rendering and the React hook
 * applying the attribute.
 *
 * The same value is exposed as `window.cortextBootstrap.colorScheme` so
 * `useColorScheme()` can seed its initial state without re-reading
 * storage.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Theming;

final class Preferences {

	public function register(): void {
		// Nothing to hook globally; Screen.php pulls the script and attaches
		// it to the shell handle via wp_add_inline_script.
	}

	/**
	 * JS that runs before the React bundle mounts.
	 */
	public function get_bootstrap_js(): string {
		return <<<'JS'
(function () {
	var pref = 'auto';
	try {
		pref = window.localStorage.getItem( 'cortext.colorScheme' ) || 'auto';
	} catch ( e ) {}
	var resolved = pref;
	if ( pref === 'auto' ) {
		resolved = window.matchMedia && window.matchMedia( '(prefers-color-scheme: dark)' ).matches ? 'dark' : 'light';
	}
	var root = document.getElementById( 'cortext-root' );
	if ( root ) {
		root.setAttribute( 'data-theme', resolved );
	}
	window.cortextBootstrap = { colorScheme: pref };
})();
JS;
	}
}
