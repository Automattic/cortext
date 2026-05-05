const path = require( 'path' );
const webpack = require( 'webpack' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const DependencyExtractionWebpackPlugin = require( '@wordpress/dependency-extraction-webpack-plugin' );

// `@wordpress/route` is not yet registered as a WP core script handle, so
// wp-scripts' default externalization would emit a missing `wp-route`
// dependency. Force it to be bundled into our build instead.
//
// `@wordpress/private-apis` deliberately stays EXTERNAL (uses WP core's
// `wp-private-apis` script handle). Bundling it would give us a separate
// WeakMap from WP core's, breaking any cross-boundary `unlock()` —
// notably `@wordpress/dataviews` reaches into objects WP core locked.
const BUNDLED = new Set( [ '@wordpress/route' ] );

// `@wordpress/route` opts into private-apis under its own module name, but
// WP 6.9's allowlist only includes `@wordpress/router` (the older plural
// package). Replace route's lock-unlock with a shim that opts in under an
// allowed name. That keeps lock/unlock on WP core's shared WeakMap, so
// other bundled packages (dataviews, interface, ...) that cross the
// boundary still work.
const routeLockUnlockShim = path.resolve(
	__dirname,
	'src/shims/route-lock-unlock.mjs'
);

module.exports = {
	...defaultConfig,
	entry: {
		...defaultConfig.entry(),
		frontend: path.resolve( __dirname, 'src/frontend.js' ),
	},
	output: {
		...defaultConfig.output,
		// Keep lazy chunk URLs stable across `start` and `build`.
		// The editor may load a dev runtime that asks for named chunks,
		// and a production build must not replace those files with
		// numeric-only chunk names.
		chunkFilename: '[name].js?ver=[chunkhash]',
	},
	optimization: {
		...defaultConfig.optimization,
		chunkIds: 'named',
	},
	plugins: [
		...defaultConfig.plugins.map( ( plugin ) => {
			if ( plugin instanceof DependencyExtractionWebpackPlugin ) {
				return new DependencyExtractionWebpackPlugin( {
					requestToExternal( request ) {
						if ( BUNDLED.has( request ) ) {
							return false;
						}
						// CSS imports from @wordpress packages (e.g.
						// `@wordpress/dataviews/build-style/style.css`)
						// must stay bundled into our `index.css`. Otherwise
						// DEP emits a phantom script handle like
						// `wp-dataviews/build-style/style.css`, which WP
						// can't resolve and silently drops our script.
						if ( request.endsWith( '.css' ) ) {
							return false;
						}
					},
				} );
			}
			return plugin;
		} ),
		new webpack.NormalModuleReplacementPlugin(
			/@wordpress[\\/]route[\\/]build-module[\\/]lock-unlock\.mjs$/,
			routeLockUnlockShim
		),
	],
};
