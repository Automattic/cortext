/**
 * Playwright config for desktop smoke tests.
 *
 * These tests launch Electron through `_electron` from `@playwright/test`.
 * Keep them under `apps/desktop/tests/` so they do not mix with the root
 * e2e suite, which runs the plugin in wp-env.
 */
const { defineConfig } = require( '@playwright/test' );

module.exports = defineConfig( {
	testDir: './tests',
	// The first run may extract the snapshot before Electron starts. Keep the
	// timeout loose enough for cold CI machines.
	timeout: 120 * 1000,
	expect: { timeout: 30 * 1000 },
	fullyParallel: false,
	workers: 1,
	reporter: [ [ 'list' ] ],
	use: {
		trace: 'retain-on-failure',
		video: 'retain-on-failure',
	},
} );
