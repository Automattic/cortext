const fs = require( 'fs' );

const SHELL_SCHEME = 'cortext-shell';
const LOADING_URL = `${ SHELL_SCHEME }://app/loading`;
const ERROR_URL = `${ SHELL_SCHEME }://app/error`;
const RESPONSE_HEADERS = {
	'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
	'Content-Type': 'text/html; charset=utf-8',
	'X-Content-Type-Options': 'nosniff',
};

function registerShellScheme( protocol ) {
	protocol.registerSchemesAsPrivileged( [
		{
			scheme: SHELL_SCHEME,
			privileges: {
				secure: true,
				standard: true,
			},
		},
	] );
}

function installShellProtocol( runtimeSession, { loadingPage, errorPage } ) {
	const pages = new Map( [
		[ LOADING_URL, fs.readFileSync( loadingPage ) ],
		[ ERROR_URL, fs.readFileSync( errorPage ) ],
	] );

	runtimeSession.protocol.handle( SHELL_SCHEME, ( request ) => {
		const body = pages.get( request.url );
		if ( ! body ) {
			return new Response( 'Not found', {
				status: 404,
				headers: {
					'Content-Type': 'text/plain; charset=utf-8',
					'X-Content-Type-Options': 'nosniff',
				},
			} );
		}
		return new Response( body, {
			status: 200,
			headers: RESPONSE_HEADERS,
		} );
	} );
}

module.exports = {
	ERROR_URL,
	LOADING_URL,
	SHELL_SCHEME,
	installShellProtocol,
	registerShellScheme,
};
