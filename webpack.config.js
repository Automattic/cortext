const path = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const DependencyExtractionWebpackPlugin = require( '@wordpress/dependency-extraction-webpack-plugin' );
const MiniCssExtractPlugin = require( 'mini-css-extract-plugin' );
const { BundleAnalyzerPlugin } = require( 'webpack-bundle-analyzer' );

// `@wordpress/route` is not yet registered as a WP core script handle, so
// wp-scripts' default externalization would emit a missing `wp-route`
// dependency. Force it to be bundled into our build instead.
//
// `@wordpress/private-apis` deliberately stays EXTERNAL (uses WP core's
// `wp-private-apis` script handle). Bundling it would give us a separate
// WeakMap from WP core's, breaking `unlock()` where bundled route code and
// Cortext's component adapters consume private APIs exposed by core.
const BUNDLED = new Set( [ '@wordpress/route' ] );

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
	module: {
		...defaultConfig.module,
		rules: [
			...defaultConfig.module.rules,
			// emoji-mart hardcodes jsDelivr CDN URLs for the emoji data and
			// image sets it only reaches when no `data` prop is passed or a
			// non-native set is rendered. Cortext always passes bundled
			// `@emoji-mart/data` and renders native emoji, so those fetches
			// never run. Strip them so they stay out of the shipped bundle.
			{
				test: /[\\/]emoji-mart[\\/]dist[\\/].*\.js$/,
				loader: path.resolve(
					__dirname,
					'scripts/strip-emoji-cdn-loader.js'
				),
			},
		],
	},
	optimization: {
		...defaultConfig.optimization,
		chunkIds: 'named',
		moduleIds: 'named',
	},
	// Scope wp-scripts' default 244 KiB asset-size warning to the initial
	// entry. Intentional lazy chunks (emoji-mart data, icon library, the
	// editor split, the icons vendor chunk pulled by DocumentIconWp) are gated
	// behind user actions, so flagging them is noise that drowns out the
	// warning when index.js actually regresses. Source maps are dev-only
	// and never served to end users. RTL stylesheets are alternates for
	// LTR ones (browsers load one per request, never both), so counting
	// them toward the entrypoint sum double-bills the user's payload.
	performance: {
		hints: 'warning',
		assetFilter: ( assetFilename ) => {
			if ( assetFilename.endsWith( '.map' ) ) {
				return false;
			}
			if ( assetFilename.endsWith( '-rtl.css' ) ) {
				return false;
			}
			return ! /^(emoji-mart-data|emoji-mart-react|icon-library-picker|document-icon-wp|editor|vendors-.*icons)/.test(
				assetFilename
			);
		},
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
			// Lazy CSS chunks (e.g. editor.css) need the same `?ver=...`
			// cache buster the JS chunks get from output.chunkFilename
			// above. Without this, webpack's runtime loads them as plain
			// `editor.css`, so after a deploy the browser can pair fresh
			// editor.js with a stale cached editor.css. wp-scripts' default
			// MiniCssExtractPlugin instance only sets `filename`, so
			// rebuild it with both options preserved.
			if ( plugin instanceof MiniCssExtractPlugin ) {
				return new MiniCssExtractPlugin( {
					...plugin.options,
					chunkFilename: '[name].css?ver=[contenthash]',
				} );
			}
			return plugin;
		} ),
		...( process.env.ANALYZE
			? [
					new BundleAnalyzerPlugin( {
						analyzerMode: 'static',
						openAnalyzer: false,
						reportFilename: path.resolve(
							__dirname,
							'build/bundle-report.html'
						),
						generateStatsFile: true,
						statsFilename: path.resolve(
							__dirname,
							'build/bundle-stats.json'
						),
					} ),
			  ]
			: [] ),
	],
};
