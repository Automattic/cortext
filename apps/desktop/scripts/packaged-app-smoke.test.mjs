import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import {
	appendErrorDetails,
	request,
	runCleanupSteps,
	terminateProcessGroup,
	waitForCortextShell,
} from './packaged-app-smoke.mjs';

test( 'cleanup finishes every step after one of them throws', async () => {
	const ran = [];
	const error = await runCleanupSteps( [
		() => ran.push( 'stop second' ),
		() => {
			ran.push( 'stop first' );
			throw new Error( 'kill EPERM' );
		},
		() => ran.push( 'remove temp dir' ),
	] );

	assert.deepEqual( ran, [ 'stop second', 'stop first', 'remove temp dir' ] );
	assert.match( error.message, /kill EPERM/ );
} );

test( 'cleanup reports the first failure, not the last', async () => {
	const error = await runCleanupSteps( [
		() => {
			throw new Error( 'first' );
		},
		() => {
			throw new Error( 'second' );
		},
	] );

	assert.match( error.message, /first/ );
} );

test( 'cleanup reports nothing when every step works', async () => {
	assert.equal( await runCleanupSteps( [ () => {}, async () => {} ] ), null );
} );

function killError( code ) {
	const error = new Error( `kill ${ code }` );
	error.code = code;
	return error;
}

// The signal lands, then the group stops answering with the given code.
function killStub( t, code ) {
	const signals = [];
	t.mock.method( process, 'kill', ( pid, signal ) => {
		signals.push( signal );
		if ( signals.length === 1 ) {
			return true;
		}
		throw killError( code );
	} );
	return signals;
}

test( 'teardown stops waiting when the process group is no longer ours', async ( t ) => {
	const signals = killStub( t, 'EPERM' );

	await terminateProcessGroup( { pid: 4242 } );

	assert.deepEqual( signals, [ 'SIGTERM', 0 ] );
} );

test( 'teardown stops waiting once the process group is gone', async ( t ) => {
	const signals = killStub( t, 'ESRCH' );

	await terminateProcessGroup( { pid: 4242 } );

	assert.deepEqual( signals, [ 'SIGTERM', 0 ] );
} );

test( 'teardown still reports an error it cannot explain', async ( t ) => {
	killStub( t, 'EINVAL' );

	await assert.rejects( terminateProcessGroup( { pid: 4242 } ), /EINVAL/ );
} );

test( 'keeps packaged output in an already rendered error stack', () => {
	const error = new Error( 'Canvas did not load.' );
	error.stack = `Error: ${ error.message }\n    at waitForCanvas`;

	appendErrorDetails( error, 'Packaged app output:\nPHP failed.' );

	assert.match( error.message, /Packaged app output:\nPHP failed\./ );
	assert.match( error.stack, /Packaged app output:\nPHP failed\./ );
} );

// Resolves the first `succeed` waits, then times out like Playwright would.
function fakePage( succeed ) {
	let calls = 0;
	const step = async () => {
		if ( calls++ >= succeed ) {
			throw new Error( 'locator.waitFor: Timeout 120000ms exceeded.' );
		}
	};
	return { waitForURL: step, locator: () => ( { waitFor: step } ) };
}

test( 'shell wait reports the milestones it reached before timing out', async () => {
	await assert.rejects( waitForCortextShell( fakePage( 2 ) ), ( error ) => {
		assert.match(
			error.message,
			/Shell milestones: url \d+ms, shell \d+ms\n/
		);
		assert.match( error.message, /Gave up after \d+ms\./ );
		return true;
	} );
} );

test( 'shell wait says so when the boot never reached the first milestone', async () => {
	await assert.rejects( waitForCortextShell( fakePage( 0 ) ), ( error ) => {
		assert.match( error.message, /Shell milestones: none reached/ );
		return true;
	} );
} );

test( 'shell wait resolves once the canvas is visible', async () => {
	await waitForCortextShell( fakePage( 3 ) );
} );

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
