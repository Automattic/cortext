const e2eTestUtils = require( '@wordpress/e2e-test-utils-playwright' );
const { createE2ERequestUtils } = require( './request-utils' );

const test = e2eTestUtils.test.extend( {
	requestUtils: [
		async ( {}, use, workerInfo ) => {
			const { baseURL, extraHTTPHeaders, storageState } =
				workerInfo.project.use;
			const storageStatePath =
				typeof storageState === 'string' ? storageState : undefined;
			const { requestContext, requestUtils } =
				await createE2ERequestUtils( {
					baseURL,
					extraHTTPHeaders,
					reuseStorageState: true,
					storageStatePath,
				} );

			try {
				await use( requestUtils );
			} finally {
				await requestContext.dispose();
			}
		},
		{ auto: true, scope: 'worker' },
	],
} );

module.exports = {
	...e2eTestUtils,
	test,
};
