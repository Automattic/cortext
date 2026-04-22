/**
 * Playwright config for Cortext e2e tests.
 *
 * Extends the @wordpress/scripts default config. Resolves WP_BASE_URL from:
 *   1. env var (CI sets this explicitly)
 *   2. .wp-env.override.json port (per-worktree local dev)
 *   3. wp-env default 8888 (Playground has no separate tests env)
 */

// Resolve before requiring the base config, which reads WP_BASE_URL at load time.
function resolveBaseURL() {
	if ( process.env.WP_BASE_URL ) {
		return process.env.WP_BASE_URL;
	}
	try {
		// eslint-disable-next-line global-require
		const override = require( './.wp-env.override.json' );
		if ( override.port ) {
			return `http://localhost:${ override.port }`;
		}
	} catch ( _error ) {
		// File is gitignored; absent on CI.
	}
	return 'http://localhost:8888';
}

process.env.WP_BASE_URL = resolveBaseURL();

const { defineConfig } = require( '@playwright/test' );
const baseConfig = require( '@wordpress/scripts/config/playwright.config.js' );

module.exports = defineConfig( {
	...baseConfig,
	testDir: './tests/e2e/specs',
	// wp-env is started explicitly by the developer / CI.
	webServer: undefined,
	use: {
		...baseConfig.use,
		video: 'off',
	},
} );
