const base = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
	...base,
	rootDir: '.',
	setupFilesAfterEnv: [
		...( base.setupFilesAfterEnv ?? [] ),
		'<rootDir>/tests/js/setup.js',
	],
	testMatch: [ '<rootDir>/tests/js/**/*.test.js' ],
	// `@wordpress/core-data@7.45` pulls in `parsel-js` (ESM-only) via its
	// awareness module. Default Jest doesn't transform node_modules, so the
	// `export` keyword blows up at parse time. Allowlist parsel-js so Babel
	// transpiles it before Node parses it.
	transformIgnorePatterns: [ '/node_modules/(?!(parsel-js)/)' ],
};
