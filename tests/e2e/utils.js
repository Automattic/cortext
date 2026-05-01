const { expect } = require( '@wordpress/e2e-test-utils-playwright' );

// Expect and suppress specific console errors
//
// See: @wordpress/e2e-test-utils-playwright: observeConsoleLogging
async function withExpectedConsoleError( expectedPattern, testFn ) {
	// eslint-disable-next-line no-console
	const originalConsoleError = console.error;
	const messages = [];

	// eslint-disable-next-line no-console
	console.error = ( ...args ) => {
		if ( expectedPattern.test( args.join( ' ' ) ) ) {
			messages.push( args );
			return;
		}
		originalConsoleError.call( console, ...args );
	};

	try {
		await testFn();
		expect( messages ).toHaveLength( 1 );
	} finally {
		// eslint-disable-next-line no-console
		console.error = originalConsoleError;
	}
}

module.exports = { withExpectedConsoleError };
