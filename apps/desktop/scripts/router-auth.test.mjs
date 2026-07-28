import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import runtime from '../lib/runtime.js';

const { RUNTIME_AUTH_HEADER, startRuntime, stopRuntime } = runtime;
const AUTH_TOKEN = 'test-runtime-auth-token';
const DESKTOP_DIR = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'..'
);

function makeFixture() {
	const wordpressDir = fs.mkdtempSync(
		path.join( os.tmpdir(), 'cortext-router-auth-' )
	);
	fs.copyFileSync(
		new URL( '../runtime/router.php', import.meta.url ),
		path.join( wordpressDir, 'router.php' )
	);
	fs.writeFileSync(
		path.join( wordpressDir, 'index.php' ),
		"<?php header( 'Content-Type: text/plain' ); echo 'dynamic';"
	);
	fs.writeFileSync( path.join( wordpressDir, 'static.txt' ), 'static' );
	return wordpressDir;
}

function makeUnprotectedFixture() {
	const wordpressDir = fs.mkdtempSync(
		path.join( os.tmpdir(), 'cortext-router-legacy-' )
	);
	fs.writeFileSync(
		path.join( wordpressDir, 'router.php' ),
		"<?php header( 'Content-Type: text/plain' ); echo 'legacy';"
	);
	fs.writeFileSync( path.join( wordpressDir, 'index.php' ), 'legacy' );
	return wordpressDir;
}

async function findAvailablePort() {
	const server = net.createServer();
	server.unref();
	server.listen( 0, '127.0.0.1' );
	await once( server, 'listening' );
	const address = server.address();
	assert.notEqual( address, null );
	assert.equal( typeof address, 'object' );
	const { port } = address;
	server.close();
	await once( server, 'close' );
	return port;
}

function request( port, requestPath, authToken ) {
	return new Promise( ( resolve, reject ) => {
		const headers = {};
		if ( authToken !== undefined ) {
			headers[ RUNTIME_AUTH_HEADER ] = authToken;
		}

		const req = http.get(
			{
				host: '127.0.0.1',
				port,
				path: requestPath,
				headers,
			},
			( response ) => {
				let body = '';
				response.setEncoding( 'utf8' );
				response.on( 'data', ( chunk ) => {
					body += chunk;
				} );
				response.on( 'end', () => {
					resolve( {
						statusCode: response.statusCode,
						headers: response.headers,
						body,
					} );
				} );
			}
		);
		req.on( 'error', reject );
	} );
}

async function waitForServer( child, port, stderr ) {
	for ( let attempt = 0; attempt < 100; attempt++ ) {
		if ( child.exitCode !== null ) {
			throw new Error(
				`PHP server exited before becoming ready: ${ stderr() }`
			);
		}

		try {
			await request( port, '/', undefined );
			return;
		} catch ( error ) {
			if ( error.code !== 'ECONNREFUSED' ) {
				throw error;
			}
		}

		await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );
	}

	throw new Error( `PHP server did not become ready: ${ stderr() }` );
}

async function startServer( wordpressDir, authToken ) {
	const port = await findAvailablePort();
	const env = { ...process.env };
	if ( authToken === undefined ) {
		delete env.CORTEXT_DESKTOP_AUTH_TOKEN;
	} else {
		env.CORTEXT_DESKTOP_AUTH_TOKEN = authToken;
	}

	const child = spawn(
		'php',
		[
			'-S',
			`127.0.0.1:${ port }`,
			'-t',
			wordpressDir,
			path.join( wordpressDir, 'router.php' ),
		],
		{
			cwd: wordpressDir,
			env,
			stdio: [ 'ignore', 'ignore', 'pipe' ],
		}
	);
	let stderr = '';
	child.stderr.setEncoding( 'utf8' );
	child.stderr.on( 'data', ( chunk ) => {
		stderr += chunk;
	} );
	try {
		await waitForServer( child, port, () => stderr );
	} catch ( error ) {
		await stopServer( child );
		fs.rmSync( wordpressDir, { recursive: true, force: true } );
		throw error;
	}
	return { child, port };
}

async function stopServer( child ) {
	if ( child.exitCode !== null || child.signalCode !== null ) {
		return;
	}
	const exit = once( child, 'exit' );
	child.kill( 'SIGTERM' );
	await exit;
}

function registerCleanup( context, child, wordpressDir ) {
	context.after( async () => {
		await stopServer( child );
		fs.rmSync( wordpressDir, { recursive: true, force: true } );
	} );
}

test( 'startRuntime requires a non-empty auth token', () => {
	const options = {
		appDir: '/unused',
		wordpressDir: '/unused',
	};

	assert.throws(
		() => startRuntime( options ),
		/startRuntime requires a non-empty authToken/
	);
	assert.throws(
		() => startRuntime( { ...options, authToken: '   ' } ),
		/startRuntime requires a non-empty authToken/
	);
} );

test( 'startRuntime replaces an unprotected legacy router before listening', async ( context ) => {
	const wordpressDir = makeUnprotectedFixture();
	const port = await findAvailablePort();
	const handle = startRuntime( {
		appDir: DESKTOP_DIR,
		authToken: AUTH_TOKEN,
		port,
		runtime: 'php',
		runtimeStateDir: path.join( wordpressDir, 'runtime-state' ),
		wordpressDir,
	} );
	context.after( () => {
		stopRuntime( handle );
		fs.rmSync( wordpressDir, { recursive: true, force: true } );
	} );

	assert.match(
		fs.readFileSync( path.join( wordpressDir, 'router.php' ), 'utf8' ),
		/hash_equals/
	);
	await handle.ready;
	const unauthenticated = await request( port, '/', undefined );
	assert.equal( unauthenticated.statusCode, 403 );
	const authenticated = await request( port, '/', AUTH_TOKEN );
	assert.equal( authenticated.statusCode, 200 );
	assert.equal( authenticated.body, 'legacy' );
} );

test( 'startRuntime fails before listening without its authenticated router', async () => {
	const wordpressDir = makeUnprotectedFixture();
	const port = await findAvailablePort();
	const appDir = fs.mkdtempSync(
		path.join( os.tmpdir(), 'cortext-router-missing-app-' )
	);
	try {
		assert.throws(
			() =>
				startRuntime( {
					appDir,
					authToken: AUTH_TOKEN,
					port,
					runtime: 'php',
					runtimeStateDir: path.join( wordpressDir, 'runtime-state' ),
					wordpressDir,
				} ),
			/Authenticated desktop router not found/
		);
		await assert.rejects( request( port, '/', undefined ), /ECONNREFUSED/ );
	} finally {
		fs.rmSync( appDir, { recursive: true, force: true } );
		fs.rmSync( wordpressDir, { recursive: true, force: true } );
	}
} );

test( 'router authenticates static and dynamic requests', async ( context ) => {
	const wordpressDir = makeFixture();
	const { child, port } = await startServer( wordpressDir, AUTH_TOKEN );
	registerCleanup( context, child, wordpressDir );

	for ( const requestPath of [ '/static.txt', '/dynamic' ] ) {
		const missing = await request( port, requestPath, undefined );
		assert.equal( missing.statusCode, 403 );
		assert.equal( missing.headers[ 'cache-control' ], 'no-store' );

		const wrong = await request( port, requestPath, 'wrong-token' );
		assert.equal( wrong.statusCode, 403 );

		const authenticated = await request( port, requestPath, AUTH_TOKEN );
		assert.equal( authenticated.statusCode, 200 );
		assert.equal(
			authenticated.body,
			requestPath === '/static.txt' ? 'static' : 'dynamic'
		);
	}
} );

test( 'router fails closed when its auth token is not configured', async ( context ) => {
	const wordpressDir = makeFixture();
	const { child, port } = await startServer( wordpressDir, undefined );
	registerCleanup( context, child, wordpressDir );

	for ( const requestPath of [ '/static.txt', '/dynamic' ] ) {
		const missing = await request( port, requestPath, undefined );
		assert.equal( missing.statusCode, 403 );

		const supplied = await request( port, requestPath, AUTH_TOKEN );
		assert.equal( supplied.statusCode, 403 );
	}
} );
