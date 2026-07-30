import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire( import.meta.url );
const {
	ERROR_URL,
	LOADING_URL,
	SHELL_SCHEME,
	installShellProtocol,
	registerShellScheme,
} = require( '../lib/shell-protocol' );

test( 'registers only the required shell scheme privileges', () => {
	let schemes;
	registerShellScheme( {
		registerSchemesAsPrivileged( value ) {
			schemes = value;
		},
	} );

	assert.deepEqual( schemes, [
		{
			scheme: SHELL_SCHEME,
			privileges: {
				secure: true,
				standard: true,
			},
		},
	] );
} );

test( 'serves only the loading and error pages with the shell CSP', async () => {
	const tempRoot = mkdtempSync(
		path.join( os.tmpdir(), 'cortext-shell-protocol-' )
	);
	const loadingPage = path.join( tempRoot, 'loading.html' );
	const errorPage = path.join( tempRoot, 'error.html' );
	writeFileSync( loadingPage, '<h1>Loading</h1>' );
	writeFileSync( errorPage, '<h1>Error</h1>' );
	let handler;

	try {
		installShellProtocol(
			{
				protocol: {
					handle( scheme, installedHandler ) {
						assert.equal( scheme, SHELL_SCHEME );
						handler = installedHandler;
					},
				},
			},
			{ loadingPage, errorPage }
		);

		for ( const [ url, expected ] of [
			[ LOADING_URL, '<h1>Loading</h1>' ],
			[ ERROR_URL, '<h1>Error</h1>' ],
		] ) {
			const response = await handler( { url } );
			assert.equal( response.status, 200 );
			assert.equal( await response.text(), expected );
			assert.equal(
				response.headers.get( 'content-security-policy' ),
				"default-src 'none'; style-src 'unsafe-inline'"
			);
			assert.equal(
				response.headers.get( 'x-content-type-options' ),
				'nosniff'
			);
		}

		for ( const url of [
			`${ LOADING_URL }?unexpected=1`,
			`${ SHELL_SCHEME }://app/../loading`,
			`${ SHELL_SCHEME }://other/loading`,
		] ) {
			const response = await handler( { url } );
			assert.equal( response.status, 404 );
		}
	} finally {
		rmSync( tempRoot, { recursive: true, force: true } );
	}
} );
