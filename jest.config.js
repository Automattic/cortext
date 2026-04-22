const base = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
	...base,
	rootDir: '.',
	setupFilesAfterEnv: [
		...( base.setupFilesAfterEnv ?? [] ),
		'<rootDir>/tests/js/setup.js',
	],
	testMatch: [ '<rootDir>/tests/js/**/*.test.js' ],
};
