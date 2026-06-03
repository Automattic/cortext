/**
 * Webpack loader that strips emoji-mart's hardcoded jsDelivr CDN URLs.
 *
 * emoji-mart only reaches those URLs when it has to fetch emoji data (no
 * `data` prop) or render a non-native image set. Cortext always passes the
 * bundled `@emoji-mart/data` and renders native emoji, so the fetches are
 * dead code. Blanking the URLs keeps the shipped bundle free of remote-asset
 * references, which the WordPress.org plugin guidelines disallow.
 *
 * The match runs to the surrounding string delimiter, so each literal is left
 * as an empty string rather than a dangling path fragment.
 *
 * @param {string} source Module source.
 * @return {string} Source with the CDN URLs removed.
 */
module.exports = function ( source ) {
	return source.replace( /https:\/\/cdn\.jsdelivr\.net[^`"']*/g, '' );
};
