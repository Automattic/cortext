<?php
/**
 * Shell preferences bootstrap.
 *
 * Emits a pre-mount script that reads the user's shell preferences
 * (color scheme, sidebar collapse + width) from localStorage and stamps
 * the resolved values onto `#cortext-root`, so the first paint matches
 * the user's preference without a flash before the React hooks mount.
 *
 * Values are also exposed as `window.cortextBootstrap` so the hooks
 * (`useColorScheme`, `useSidebarLayout`) can seed without re-reading
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

	// Clamp to the same range as useSidebarLayout so a saved width never
	// paints out of range.
	var sidebarCollapsed = false;
	var sidebarWidth = 280;
	try {
		sidebarCollapsed = window.localStorage.getItem( 'cortext.sidebarCollapsed' ) === 'true';
		var storedWidth = window.localStorage.getItem( 'cortext.sidebarWidth' );
		var rawWidth = storedWidth === null ? NaN : Number( storedWidth );
		if ( isFinite( rawWidth ) ) {
			if ( rawWidth < 220 ) {
				sidebarWidth = 220;
			} else if ( rawWidth > 480 ) {
				sidebarWidth = 480;
			} else {
				sidebarWidth = Math.round( rawWidth );
			}
		}
	} catch ( e ) {}

	var root = document.getElementById( 'cortext-root' );
	if ( root ) {
		root.setAttribute( 'data-theme', resolved );
		root.setAttribute( 'data-sidebar-collapsed', sidebarCollapsed ? 'true' : 'false' );
		root.style.setProperty( '--cortext-sidebar-width', sidebarWidth + 'px' );
	}
	if ( document.body ) {
		document.body.setAttribute( 'data-cortext-theme', resolved );
	}
	// Keep the fallback color on html too. View-transition pseudos cannot
	// read vars scoped to #cortext-root, and the JS hook writes the same var.
	if ( document.documentElement ) {
		document.documentElement.style.setProperty(
			'--cortext-canvas-frame-surface-root',
			resolved === 'dark' ? '#2a2a2a' : '#ffffff'
		);
	}

	window.cortextBootstrap = {
		colorScheme: pref,
		sidebar: { collapsed: sidebarCollapsed, width: sidebarWidth },
	};
})();
JS;
	}
}
