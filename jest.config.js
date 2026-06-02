const base = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
	...base,
	rootDir: '.',
	setupFilesAfterEnv: [
		...( base.setupFilesAfterEnv ?? [] ),
		'<rootDir>/tests/js/setup.js',
	],
	testMatch: [ '<rootDir>/tests/js/**/*.test.js' ],
	// parsel-js and uuid@14 are ESM-only. Jest skips node_modules by default,
	// so let Babel transpile them before Node sees their export syntax.
	transformIgnorePatterns: [
		'node_modules/(?!(\\.pnpm/)?(parsel-js|@parsel-js|uuid)(@|/))',
	],
};
