const fs = require( 'fs/promises' );
const { request } = require( '@playwright/test' );
const { RequestUtils } = require( '@wordpress/e2e-test-utils-playwright' );

const E2E_REQUEST_HEADERS = Object.freeze( {
	'X-Cortext-E2E': '1',
} );

async function readStorageState( storageStatePath ) {
	if ( ! storageStatePath ) {
		return undefined;
	}

	try {
		return JSON.parse( await fs.readFile( storageStatePath, 'utf8' ) );
	} catch ( error ) {
		if ( error.code === 'ENOENT' ) {
			return undefined;
		}
		throw error;
	}
}

async function createE2ERequestUtils( {
	baseURL,
	extraHTTPHeaders = {},
	reuseStorageState = false,
	storageStatePath,
} ) {
	const storageState = reuseStorageState
		? await readStorageState( storageStatePath )
		: undefined;
	const requestContext = await request.newContext( {
		baseURL,
		extraHTTPHeaders: {
			...extraHTTPHeaders,
			...E2E_REQUEST_HEADERS,
		},
		...( storageState
			? {
					storageState: {
						cookies: storageState.cookies,
						origins: [],
					},
			  }
			: {} ),
	} );
	const requestUtils = new RequestUtils( requestContext, {
		baseURL,
		storageState,
		storageStatePath,
	} );

	return { requestContext, requestUtils };
}

module.exports = {
	createE2ERequestUtils,
	E2E_REQUEST_HEADERS,
};
