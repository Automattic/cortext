const base = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
	...base,
	rootDir: '.',
	setupFilesAfterEnv: [
		...( base.setupFilesAfterEnv ?? [] ),
		'<rootDir>/tests/js/setup.js',
	],
	testMatch: [ '<rootDir>/tests/js/**/*.test.js' ],
	moduleNameMapper: {
		...( base.moduleNameMapper ?? {} ),
		'^@wordpress/dataviews/wp$': '@wordpress/dataviews',
	},
	// WordPress packages pull in a few ESM-only modules. Default Jest doesn't
	// transform node_modules, so their `import` / `export` syntax blows up at
	// parse time. Allowlist those packages so Babel transpiles them first.
	transformIgnorePatterns: [
		'node_modules/(?!(\\.pnpm/)?(parsel-js|@parsel-js|uuid|marked)(@|/))',
	],
};
