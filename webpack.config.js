const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const DependencyExtractionWebpackPlugin = require( '@wordpress/dependency-extraction-webpack-plugin' );

// `@wordpress/route` is not yet registered as a WP core script handle, so
// wp-scripts' default externalization would emit a missing `wp-route`
// dependency. Force it to be bundled into our build instead.
const BUNDLED = new Set( [ '@wordpress/route' ] );

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
