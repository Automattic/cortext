import { __dangerousOptInToUnstableAPIsOnlyForCoreModules } from '@wordpress/private-apis';

// WP 6.9's private-apis allowlist doesn't include `@wordpress/route`. Opt in
// under an allowed name that WP core scripts on our screen don't use, so
// route's lock/unlock share WP core's WeakMap. Sharing is required: other
// bundled packages like dataviews reach across the boundary to unlock
// objects that WP core locked. `@wordpress/sync` is the collab-server
// package; it isn't loaded in the cortext admin context, so the
// registration slot is free. See `webpack.config.js` for how this shim
// replaces the upstream file via NormalModuleReplacementPlugin.
export const { lock, unlock } =
	__dangerousOptInToUnstableAPIsOnlyForCoreModules(
		'I acknowledge private features are not for use in themes or plugins and doing so will break in the next version of WordPress.',
		'@wordpress/sync'
	);
