const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const DependencyExtractionWebpackPlugin = require( '@wordpress/dependency-extraction-webpack-plugin' );

// `@wordpress/route` is not yet registered as a WP core script handle, so
// wp-scripts' default externalization would emit a missing `wp-route`
// dependency. Force it to be bundled into our build instead.
//
// `@wordpress/private-apis` is bundled alongside it so that `@wordpress/route`'s
// internal opt-in call resolves against our up-to-date allowlist (which
// includes `@wordpress/route`) rather than the older allowlist shipped with
// `wp-private-apis` in the running WordPress.
const BUNDLED = new Set( [ '@wordpress/route', '@wordpress/private-apis' ] );

module.exports = {
	...defaultConfig,
	plugins: defaultConfig.plugins.map( ( plugin ) => {
		if ( plugin instanceof DependencyExtractionWebpackPlugin ) {
			return new DependencyExtractionWebpackPlugin( {
				requestToExternal( request ) {
					if ( BUNDLED.has( request ) ) {
						return false;
					}
				},
			} );
		}
		return plugin;
	} ),
};
