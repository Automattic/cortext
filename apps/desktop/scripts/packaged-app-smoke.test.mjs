import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import { request } from './packaged-app-smoke.mjs';

async function listen( handler ) {
	const server = http.createServer( handler );
	server.listen( 0, '127.0.0.1' );
	await once( server, 'listening' );
	const address = server.address();
	assert.notEqual( address, null );
	assert.equal( typeof address, 'object' );
	return {
		server,
		url: `http://127.0.0.1:${ address.port }`,
	};
}

test( 'HTTP helper rejects an aborted response', async ( t ) => {
	const { server, url } = await listen( ( _incoming, response ) => {
		response.writeHead( 200 );
		response.flushHeaders();
		response.write( 'partial' );
		setImmediate( () => response.destroy() );
	} );
	t.after(
		() =>
			new Promise( ( resolve, reject ) => {
				server.close( ( error ) =>
					error ? reject( error ) : resolve()
				);
			} )
	);

	await assert.rejects( request( url, 1_000 ), /aborted|socket hang up/i );
} );

test( 'HTTP helper times out even while data is arriving', async ( t ) => {
	const { server, url } = await listen( ( _incoming, response ) => {
		response.writeHead( 200 );
		const interval = setInterval( () => response.write( '.' ), 5 );
		response.once( 'close', () => clearInterval( interval ) );
	} );
	t.after(
		() =>
			new Promise( ( resolve, reject ) => {
				server.close( ( error ) =>
					error ? reject( error ) : resolve()
				);
			} )
	);

	await assert.rejects( request( url, 50 ), /Request timed out/ );
} );
