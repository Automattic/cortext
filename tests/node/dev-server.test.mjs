import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	closeServer,
	createCompilationRelay,
	createProxyServer,
	createReadinessRelay,
	isRewritableContentType,
	isSuccessfulWebpackCompilation,
	listenOnLoopback,
	parseArguments,
	readProxyTokenFile,
	resolvePublicOrigin,
	rewriteBackendOrigin,
	transformReadinessLine,
} from '../../scripts/dev-server.mjs';

const projectRoot = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);
const devServerPath = path.join( projectRoot, 'scripts/dev-server.mjs' );
const temporaryDirectories = [];

afterEach( () => {
	for ( const directory of temporaryDirectories.splice( 0 ) ) {
		rmSync( directory, { force: true, recursive: true } );
	}
} );

function createFixture() {
	const root = mkdtempSync( path.join( os.tmpdir(), 'cortext-dev-server-' ) );
	const bin = path.join( root, 'pnpm' );
	const grandchild = path.join( root, 'grandchild.js' );
	const log = path.join( root, 'commands.log' );
	const releaseCompilation = path.join( root, 'release-compilation' );
	const releaseSeed = path.join( root, 'release-seed' );
	const tokenFile = path.join( root, 'proxy-token' );
	temporaryDirectories.push( root );

	writeFileSync(
		grandchild,
		`const fs = require( 'node:fs' );
fs.appendFileSync( process.env.CORTEXT_COMMAND_LOG, 'grandchild-ready\\n' );
process.stdout.write( 'Grandchild ready\\n' );

for ( const signal of [ 'SIGHUP', 'SIGINT', 'SIGTERM' ] ) {
	process.once( signal, () => {
		fs.appendFileSync(
			process.env.CORTEXT_COMMAND_LOG,
			'grandchild-' + signal + '\\n'
		);
		process.exit( 0 );
	} );
}

setInterval( () => {}, 1000 );
`
	);
	writeFileSync(
		bin,
		`#!/usr/bin/env node
const { spawn } = require( 'node:child_process' );
const fs = require( 'node:fs' );
const script = process.argv[ 3 ];
fs.appendFileSync( process.env.CORTEXT_COMMAND_LOG, script + '\\n' );

function hold() {
	return new Promise( () => {
		setInterval( () => {}, 1000 );
	} );
}

function waitForFile( file ) {
	return new Promise( ( resolve ) => {
		const timer = setInterval( () => {
			if ( ! fs.existsSync( file ) ) {
				return;
			}

			clearInterval( timer );
			resolve();
		}, 10 );
	} );
}

async function emitCompilation() {
	const output =
		process.env.CORTEXT_COMPILE_RESULT === 'warnings'
			? 'webpack 5.99.0 compiled with 2 warnings in 25 ms\\n'
			: process.env.CORTEXT_COMPILE_RESULT === 'errors'
				? 'webpack 5.99.0 compiled with 1 error in 25 ms\\n'
				: 'webpack 5.99.0 compiled successfully in 25 ms\\n';

	if ( process.env.CORTEXT_SPLIT_COMPILE !== '1' ) {
		process.stdout.write( output );
		return;
	}

	process.stdout.write( output.slice( 0, 22 ) );
	await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );
	process.stdout.write( output.slice( 22, 35 ) );
	await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );
	process.stdout.write( output.slice( 35 ) );
}

async function main() {
	if ( script === 'env:start' ) {
		process.stdout.write( 'Preparing WordPress at http://localhost:' + process.env.CORTEXT_BACKEND_PORT + '/status\\n' );
		process.stdout.write( 'WordPress development site started at http://localhost:' + process.env.CORTEXT_BACKEND_PORT + '\\n' );

		if ( process.env.CORTEXT_HOLD_START === '1' ) {
			await hold();
		}
	}

	if ( script === 'env:seed' ) {
		process.stdout.write( 'Seed started\\n' );
		if ( process.env.CORTEXT_HOLD_SEED === '1' ) {
			await waitForFile( process.env.CORTEXT_RELEASE_SEED );
		}
		process.stdout.write( 'Seed complete\\n' );
	}

	if ( process.env.CORTEXT_FAIL_SCRIPT === script ) {
		process.exit( Number( process.env.CORTEXT_FAIL_CODE ) );
	}

	if ( script !== 'dev' ) {
		return;
	}

	process.stdout.write( 'Watcher ready\\n' );
	for ( const signal of [ 'SIGHUP', 'SIGINT', 'SIGTERM' ] ) {
		process.once( signal, () => {
			fs.appendFileSync(
				process.env.CORTEXT_COMMAND_LOG,
				'parent-' + signal + '\\n'
			);
			process.exit( 0 );
		} );
	}

	if ( process.env.CORTEXT_HOLD_COMPILE === '1' ) {
		await waitForFile( process.env.CORTEXT_RELEASE_COMPILATION );
	}
	await emitCompilation();
	spawn( process.execPath, [ process.env.CORTEXT_GRANDCHILD ], {
		env: process.env,
		stdio: 'inherit',
	} );
	await hold();
}

main();
`
	);
	chmodSync( bin, 0o755 );
	writeFileSync( log, '' );
	writeFileSync( tokenFile, 'fixture-proxy-token\n' );

	return {
		bin,
		grandchild,
		log,
		releaseCompilation,
		releaseSeed,
		root,
		tokenFile,
	};
}

async function listen( server ) {
	server.listen( 0, '127.0.0.1' );
	await once( server, 'listening' );
	return server.address().port;
}

async function unusedPort() {
	const server = net.createServer();
	const port = await listen( server );
	await closeServer( server );
	return port;
}

function request( port, headers = {}, method = 'GET' ) {
	return new Promise( ( resolve, reject ) => {
		const outgoing = http.request(
			{
				headers,
				host: '127.0.0.1',
				method,
				path: '/check?proxy=1',
				port,
			},
			( response ) => {
				let body = '';
				response.setEncoding( 'utf8' );
				response.on( 'data', ( chunk ) => {
					body += chunk;
				} );
				response.on( 'end', () =>
					resolve( {
						body,
						headers: response.headers,
						statusCode: response.statusCode,
					} )
				);
			}
		);
		outgoing.once( 'error', reject );
		outgoing.end();
	} );
}

function requestBuffer( port, headers = {} ) {
	return new Promise( ( resolve, reject ) => {
		const outgoing = http.request(
			{
				headers,
				host: '127.0.0.1',
				path: '/check?proxy=1',
				port,
			},
			( response ) => {
				const chunks = [];
				response.on( 'data', ( chunk ) => chunks.push( chunk ) );
				response.on( 'end', () =>
					resolve( {
						body: Buffer.concat( chunks ),
						headers: response.headers,
						statusCode: response.statusCode,
					} )
				);
			}
		);
		outgoing.once( 'error', reject );
		outgoing.end();
	} );
}

function withTimeout( promise, message, timeout = 1000 ) {
	return new Promise( ( resolve, reject ) => {
		const timer = setTimeout(
			() => reject( new Error( message ) ),
			timeout
		);

		promise.then(
			( value ) => {
				clearTimeout( timer );
				resolve( value );
			},
			( error ) => {
				clearTimeout( timer );
				reject( error );
			}
		);
	} );
}

function startSupervisor( fixture, publicPort, backendPort, extraEnv = {} ) {
	const child = spawn(
		process.execPath,
		[
			devServerPath,
			'--public-port',
			String( publicPort ),
			'--backend-port',
			String( backendPort ),
			'--proxy-token-file',
			fixture.tokenFile,
		],
		{
			cwd: projectRoot,
			env: {
				...process.env,
				...extraEnv,
				CORTEXT_BACKEND_PORT: String( backendPort ),
				CORTEXT_COMMAND_LOG: fixture.log,
				CORTEXT_GRANDCHILD: fixture.grandchild,
				CORTEXT_RELEASE_COMPILATION: fixture.releaseCompilation,
				CORTEXT_RELEASE_SEED: fixture.releaseSeed,
				PATH: `${ fixture.root }:${ process.env.PATH ?? '' }`,
			},
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);
	let stderr = '';
	let stdout = '';

	child.stderr.setEncoding( 'utf8' );
	child.stdout.setEncoding( 'utf8' );
	child.stderr.on( 'data', ( chunk ) => {
		stderr += chunk;
	} );
	child.stdout.on( 'data', ( chunk ) => {
		stdout += chunk;
	} );

	return {
		child,
		output: () => ( { stderr, stdout } ),
	};
}

async function stopSupervisor( running ) {
	if ( running.child.exitCode !== null || running.child.signalCode ) {
		return;
	}

	const exited = once( running.child, 'exit' );
	running.child.kill( 'SIGHUP' );

	try {
		await withTimeout( exited, 'The supervisor did not stop.', 500 );
	} catch {
		running.child.kill( 'SIGKILL' );
		await exited;
	}
}

async function waitForOutput( running, text ) {
	const timeoutAt = Date.now() + 5000;
	while ( ! running.output().stdout.includes( text ) ) {
		if ( Date.now() >= timeoutAt ) {
			throw new Error(
				`Timed out waiting for "${ text }".\n` +
					`stdout:\n${ running.output().stdout }\n` +
					`stderr:\n${ running.output().stderr }`
			);
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );
	}
}

describe( 'dev server arguments and readiness output', () => {
	it( 'parses distinct public and backend ports', () => {
		assert.deepEqual(
			parseArguments( [
				'--public-port',
				'55270',
				'--backend-port',
				'55271',
				'--proxy-token-file',
				'/tmp/cortext-proxy-token',
			] ),
			{
				backendPort: 55271,
				proxyTokenFile: '/tmp/cortext-proxy-token',
				publicPort: 55270,
			}
		);
		assert.throws(
			() =>
				parseArguments( [
					'--public-port',
					'55270',
					'--backend-port',
					'55270',
					'--proxy-token-file',
					'/tmp/cortext-proxy-token',
				] ),
			/must be different/
		);
	} );

	it( 'requires a non-empty proxy token file', ( context ) => {
		const fixture = createFixture();
		context.after( () =>
			rmSync( fixture.root, { force: true, recursive: true } )
		);

		assert.equal(
			readProxyTokenFile( fixture.tokenFile ),
			'fixture-proxy-token'
		);
		writeFileSync( fixture.tokenFile, '\n' );
		assert.throws(
			() => readProxyTokenFile( fixture.tokenFile ),
			/is empty/
		);
	} );

	it( 'changes only the wp-env readiness message', () => {
		assert.equal(
			transformReadinessLine(
				'WordPress development site started at http://localhost:55271\n',
				55270,
				55271
			),
			'Cortext admin: http://localhost:55270/wp-admin/admin.php?page=cortext\n'
		);
		assert.equal(
			transformReadinessLine(
				'Preparing WordPress at http://localhost:55271/status\n',
				55270,
				55271
			),
			'Preparing WordPress at http://localhost:55271/status\n'
		);
	} );

	it( 'holds a split readiness line until the listener is ready', () => {
		let output = '';
		const relay = createReadinessRelay( {
			backendPort: 55271,
			output: { write: ( chunk ) => ( output += chunk ) },
			publicPort: 55270,
		} );

		relay.write( 'Preparing WordPress\nWordPress development site ' );
		relay.write( 'started at http://localhost:55271\nDone\n' );
		relay.end();

		assert.equal( output, 'Preparing WordPress\nDone\n' );
		relay.release();
		assert.equal(
			output,
			'Preparing WordPress\nDone\n' +
				'Cortext admin: http://localhost:55270/wp-admin/admin.php?page=cortext\n'
		);
	} );

	it( 'recognizes only successful webpack compilation lines', () => {
		for ( const line of [
			'webpack 5.99.0 compiled successfully in 25 ms',
			'webpack compiled with 1 warning in 25 ms',
			'webpack compiled with 2 warnings in 25 ms',
			'\u001b[32mwebpack compiled successfully\u001b[39m',
		] ) {
			assert.equal( isSuccessfulWebpackCompilation( line ), true, line );
		}

		for ( const line of [
			'webpack compiled with 1 error in 25 ms',
			'webpack compiled with 2 errors and 1 warning in 25 ms',
			'webpack compiled with 1 warning and 1 error in 25 ms',
			'Watcher ready',
		] ) {
			assert.equal( isSuccessfulWebpackCompilation( line ), false, line );
		}
	} );

	it( 'detects a successful compilation split across chunks', () => {
		let output = '';
		let readyCount = 0;
		const relay = createCompilationRelay( {
			onReady: () => {
				readyCount += 1;
			},
			output: { write: ( chunk ) => ( output += chunk ) },
		} );

		relay.write( 'webpack compiled with 2 warn' );
		relay.write( 'ings in 25 ms\nWatching for changes\n' );
		relay.end();

		assert.equal(
			output,
			'webpack compiled with 2 warnings in 25 ms\nWatching for changes\n'
		);
		assert.equal( readyCount, 1 );
	} );
} );

describe( 'local reverse proxy', () => {
	it( 'derives public origins only from valid loopback hosts', () => {
		assert.equal(
			resolvePublicOrigin( 'localhost:55270' ),
			'http://localhost:55270'
		);
		assert.equal(
			resolvePublicOrigin( '127.0.0.1:8080' ),
			'http://127.0.0.1:8080'
		);
		assert.equal(
			resolvePublicOrigin( '[::1]:8888' ),
			'http://[::1]:8888'
		);

		for ( const host of [
			'example.com',
			'192.168.1.10:55270',
			'localhost.example.com',
			'localhost:0',
			'localhost:65536',
		] ) {
			assert.equal( resolvePublicOrigin( host ), null );
		}
	} );

	it( 'recognizes HTML, CSS, JavaScript, JSON, and XML responses', () => {
		for ( const contentType of [
			'text/html; charset=UTF-8',
			'text/css',
			'text/javascript',
			'application/javascript',
			'application/json',
			'application/problem+json',
			'text/xml',
			'application/xml',
			'application/rss+xml',
		] ) {
			assert.equal(
				isRewritableContentType( contentType ),
				true,
				contentType
			);
		}

		for ( const contentType of [
			'image/png',
			'application/octet-stream',
			'application/gzip',
		] ) {
			assert.equal(
				isRewritableContentType( contentType ),
				false,
				contentType
			);
		}
	} );

	it( 'rewrites plain and JSON-escaped backend origins', () => {
		assert.equal(
			rewriteBackendOrigin(
				'http://localhost:55271 http:\\/\\/localhost:55271',
				'http://localhost:55271',
				'http://localhost:55270'
			),
			'http://localhost:55270 http:\\/\\/localhost:55270'
		);
	} );

	it( 'serves a self-refreshing startup page before WordPress is ready', async () => {
		const proxy = createProxyServer( {
			backendPort: 65535,
			isBackendReady: () => false,
			proxyToken: 'fixture-proxy-token',
		} );

		try {
			await listenOnLoopback( proxy, 0 );
			const result = await request( proxy.address().port );

			assert.equal( result.statusCode, 503 );
			assert.equal( result.headers[ 'cache-control' ], 'no-store' );
			assert.equal( result.headers[ 'retry-after' ], '1' );
			assert.match(
				result.body,
				/<meta http-equiv="refresh" content="1">/
			);
			assert.match( result.body, /WordPress is starting/ );
		} finally {
			await closeServer( proxy );
		}
	} );

	it( 'uses the backend Host and forwards the original public Host', async () => {
		let receivedAcceptEncoding;
		let receivedForwardedHost;
		let receivedHost;
		let receivedProxyToken;
		const backend = http.createServer( ( incoming, response ) => {
			receivedAcceptEncoding = incoming.headers[ 'accept-encoding' ];
			receivedForwardedHost =
				incoming.headers[ 'x-cortext-forwarded-host' ];
			receivedHost = incoming.headers.host;
			receivedProxyToken = incoming.headers[ 'x-cortext-dev-proxy' ];
			response.statusCode = 201;
			response.setHeader( 'X-Backend', 'wordpress' );
			response.end( `${ incoming.method } ${ incoming.url }` );
		} );
		const backendPort = await listen( backend );
		const proxy = createProxyServer( {
			backendPort,
			isBackendReady: () => true,
			proxyToken: 'fixture-proxy-token',
		} );

		try {
			await listenOnLoopback( proxy, 0 );
			const address = proxy.address();
			const result = await request( address.port, {
				'Accept-Encoding': 'br, gzip',
				Host: 'localhost:55270',
				'X-Cortext-Forwarded-Host': 'attacker.example',
				'X-Cortext-Dev-Proxy': 'untrusted-client-value',
			} );

			assert.equal( address.address, '127.0.0.1' );
			assert.equal( address.family, 'IPv4' );
			assert.equal( receivedAcceptEncoding, 'identity' );
			assert.equal( receivedHost, `localhost:${ backendPort }` );
			assert.equal( receivedForwardedHost, 'localhost:55270' );
			assert.equal( receivedProxyToken, 'fixture-proxy-token' );
			assert.equal( result.statusCode, 201 );
			assert.equal( result.headers[ 'x-backend' ], 'wordpress' );
			assert.equal( result.body, 'GET /check?proxy=1' );
		} finally {
			await closeServer( proxy );
			await closeServer( backend );
		}
	} );

	it( 'avoids canonical redirect loops for HEAD requests', async () => {
		let receivedForwardedHost;
		let receivedHost;
		const backend = http.createServer( ( incoming, response ) => {
			receivedForwardedHost =
				incoming.headers[ 'x-cortext-forwarded-host' ];
			receivedHost = incoming.headers.host;

			if ( receivedHost !== `localhost:${ backendPort }` ) {
				response.writeHead( 301, {
					Location: `http://localhost:${ backendPort }${ incoming.url }`,
				} );
				response.end();
				return;
			}

			response.end();
		} );
		const backendPort = await listen( backend );
		const proxy = createProxyServer( {
			backendPort,
			isBackendReady: () => true,
			proxyToken: 'fixture-proxy-token',
		} );

		try {
			await listenOnLoopback( proxy, 0 );
			const result = await request(
				proxy.address().port,
				{ Host: 'localhost:4321' },
				'HEAD'
			);

			assert.equal( result.statusCode, 200 );
			assert.equal( receivedHost, `localhost:${ backendPort }` );
			assert.equal( receivedForwardedHost, 'localhost:4321' );
		} finally {
			await closeServer( proxy );
			await closeServer( backend );
		}
	} );

	it( 'rewrites response headers and textual bodies across chunks', async () => {
		const publicOrigin = 'http://localhost:4321';
		const backend = http.createServer( ( incoming, response ) => {
			const originalBody =
				`<a href="${ backendOrigin }/wp-admin/">Cortext</a>` +
				`{"url":"${ backendOrigin.replaceAll(
					'/',
					'\\/'
				) }/wp-json/"}`;
			response.writeHead( 200, {
				'Access-Control-Allow-Origin': backendOrigin,
				'Content-Length': Buffer.byteLength( originalBody ),
				'Content-Type': 'text/html; charset=UTF-8',
				Link: `<${ backendOrigin }/wp-json/>; rel="https://api.w.org/"`,
				Location: `${ backendOrigin }/wp-admin/`,
			} );
			response.write( '<a href="http://local' );
			response.write(
				`host:${ backend.address().port }/wp-admin/">Cortext</a>`
			);
			response.write( '{"url":"http:\\/\\/local' );
			response.end( `host:${ backend.address().port }/wp-json/"}` );
		} );
		const backendPort = await listen( backend );
		const backendOrigin = `http://localhost:${ backendPort }`;
		const proxy = createProxyServer( {
			backendPort,
			isBackendReady: () => true,
			proxyToken: 'fixture-proxy-token',
		} );

		try {
			await listenOnLoopback( proxy, 0 );
			const result = await request( proxy.address().port, {
				Host: 'localhost:4321',
			} );
			const escapedPublicOrigin = publicOrigin.replaceAll( '/', '\\/' );

			assert.equal(
				result.headers[ 'access-control-allow-origin' ],
				publicOrigin
			);
			assert.equal(
				result.headers.location,
				`${ publicOrigin }/wp-admin/`
			);
			assert.equal(
				result.headers.link,
				`<${ publicOrigin }/wp-json/>; rel="https://api.w.org/"`
			);
			assert.equal(
				result.body,
				`<a href="${ publicOrigin }/wp-admin/">Cortext</a>` +
					`{"url":"${ escapedPublicOrigin }/wp-json/"}`
			);
			assert.doesNotMatch( result.body, /localhost:\d{5}/ );
			assert.equal(
				Number( result.headers[ 'content-length' ] ),
				Buffer.byteLength( result.body )
			);
			assert.equal( result.headers[ 'transfer-encoding' ], undefined );
		} finally {
			await closeServer( proxy );
			await closeServer( backend );
		}
	} );

	it( 'does not rewrite responses for external Host headers', async () => {
		let receivedAcceptEncoding;
		let receivedForwardedHost;
		let receivedHost;
		const backend = http.createServer( ( incoming, response ) => {
			receivedAcceptEncoding = incoming.headers[ 'accept-encoding' ];
			receivedForwardedHost =
				incoming.headers[ 'x-cortext-forwarded-host' ];
			receivedHost = incoming.headers.host;
			response.writeHead( 200, {
				'Access-Control-Allow-Origin': backendOrigin,
				'Content-Type': 'text/html',
				Link: `<${ backendOrigin }/wp-json/>; rel="https://api.w.org/"`,
				Location: `${ backendOrigin }/wp-admin/`,
			} );
			response.end( `<a href="${ backendOrigin }/">WordPress</a>` );
		} );
		const backendPort = await listen( backend );
		const backendOrigin = `http://localhost:${ backendPort }`;
		const proxy = createProxyServer( {
			backendPort,
			isBackendReady: () => true,
			proxyToken: 'fixture-proxy-token',
		} );

		try {
			await listenOnLoopback( proxy, 0 );
			const result = await request( proxy.address().port, {
				'Accept-Encoding': 'gzip',
				Host: 'example.com',
				'X-Cortext-Forwarded-Host': 'localhost:4321',
			} );

			assert.equal( receivedAcceptEncoding, 'gzip' );
			assert.equal( receivedHost, `localhost:${ backendPort }` );
			assert.equal( receivedForwardedHost, 'example.com' );
			assert.equal(
				result.headers[ 'access-control-allow-origin' ],
				backendOrigin
			);
			assert.equal(
				result.headers.location,
				`${ backendOrigin }/wp-admin/`
			);
			assert.equal(
				result.headers.link,
				`<${ backendOrigin }/wp-json/>; rel="https://api.w.org/"`
			);
			assert.equal(
				result.body,
				`<a href="${ backendOrigin }/">WordPress</a>`
			);
		} finally {
			await closeServer( proxy );
			await closeServer( backend );
		}
	} );

	it( 'does not alter binary response bodies', async () => {
		const backend = http.createServer( ( incoming, response ) => {
			response.writeHead( 200, {
				'Content-Length': binaryBody.length,
				'Content-Type': 'image/png',
			} );
			response.end( binaryBody );
		} );
		const backendPort = await listen( backend );
		const binaryBody = Buffer.concat( [
			Buffer.from( [ 0, 255, 1 ] ),
			Buffer.from( `http://localhost:${ backendPort }` ),
			Buffer.from( [ 2, 128, 3 ] ),
		] );
		const proxy = createProxyServer( {
			backendPort,
			isBackendReady: () => true,
			proxyToken: 'fixture-proxy-token',
		} );

		try {
			await listenOnLoopback( proxy, 0 );
			const result = await requestBuffer( proxy.address().port, {
				Host: 'localhost:4321',
			} );

			assert.deepEqual( result.body, binaryBody );
			assert.equal(
				Number( result.headers[ 'content-length' ] ),
				binaryBody.length
			);
		} finally {
			await closeServer( proxy );
			await closeServer( backend );
		}
	} );

	it( 'closes the downstream response when WordPress truncates it', async () => {
		let truncateResponse = true;
		const backend = http.createServer( ( incoming, response ) => {
			if ( ! truncateResponse ) {
				response.end( 'Recovered' );
				return;
			}

			response.writeHead( 200, { 'Content-Length': '100' } );
			response.write( 'Partial' );
			setImmediate( () => response.socket.destroy() );
		} );
		const backendPort = await listen( backend );
		const proxy = createProxyServer( {
			backendPort,
			isBackendReady: () => true,
			proxyToken: 'fixture-proxy-token',
		} );

		try {
			await listenOnLoopback( proxy, 0 );
			const outcome = await withTimeout(
				new Promise( ( resolve, reject ) => {
					const outgoing = http.get(
						{
							host: '127.0.0.1',
							port: proxy.address().port,
						},
						( response ) => {
							response.resume();
							response.once( 'aborted', () =>
								resolve( 'aborted' )
							);
							response.once( 'end', () => resolve( 'ended' ) );
							response.once( 'error', ( error ) => {
								if ( error.code === 'ECONNRESET' ) {
									resolve( 'aborted' );
									return;
								}
								reject( error );
							} );
						}
					);
					outgoing.once( 'error', reject );
				} ),
				'The truncated response remained open.'
			);

			assert.equal( outcome, 'aborted' );
			truncateResponse = false;
			assert.equal(
				( await request( proxy.address().port ) ).body,
				'Recovered'
			);
		} finally {
			await closeServer( proxy );
			await closeServer( backend );
		}
	} );

	it( 'cancels the WordPress request when the browser disconnects', async () => {
		let resolveBackendClosed;
		let resolveBackendReceived;
		let holdResponse = true;
		const backend = http.createServer( ( incoming, response ) => {
			if ( ! holdResponse ) {
				response.end( 'Recovered' );
				return;
			}

			resolveBackendReceived();
			response.once( 'close', () => {
				if ( ! response.writableEnded ) {
					resolveBackendClosed();
				}
			} );
		} );
		const backendReceived = new Promise( ( resolve ) => {
			resolveBackendReceived = resolve;
		} );
		const backendClosed = new Promise( ( resolve ) => {
			resolveBackendClosed = resolve;
		} );
		const backendPort = await listen( backend );
		const proxy = createProxyServer( {
			backendPort,
			isBackendReady: () => true,
			proxyToken: 'fixture-proxy-token',
		} );

		try {
			await listenOnLoopback( proxy, 0 );
			const outgoing = http.get( {
				host: '127.0.0.1',
				port: proxy.address().port,
			} );
			outgoing.on( 'error', () => {} );

			await withTimeout(
				backendReceived,
				'WordPress did not receive the proxied request.'
			);
			outgoing.destroy();
			await withTimeout(
				backendClosed,
				'WordPress kept serving a disconnected browser.'
			);

			holdResponse = false;
			assert.equal(
				( await request( proxy.address().port ) ).body,
				'Recovered'
			);
		} finally {
			await closeServer( proxy );
			await closeServer( backend );
		}
	} );
} );

describe( 'dev server process lifecycle', () => {
	it( 'listens during startup without announcing Cortext', async () => {
		const fixture = createFixture();
		const publicPort = await unusedPort();
		const backendPort = await unusedPort();
		const running = startSupervisor( fixture, publicPort, backendPort, {
			CORTEXT_HOLD_START: '1',
		} );

		try {
			await waitForOutput( running, 'Preparing WordPress' );
			const result = await request( publicPort );

			assert.equal( result.statusCode, 503 );
			assert.match( result.body, /WordPress is starting/ );
			assert.doesNotMatch( running.output().stdout, /Cortext admin:/ );

			running.child.kill( 'SIGHUP' );
			const [ code, signal ] = await once( running.child, 'exit' );
			assert.equal( code, null );
			assert.equal( signal, 'SIGHUP' );
		} finally {
			await stopSupervisor( running );
		}
	} );

	it( 'waits for seed and the first successful compilation before becoming ready', async () => {
		const fixture = createFixture();
		const backend = http.createServer( ( incoming, response ) => {
			response.end( 'Cortext' );
		} );
		const backendPort = await listen( backend );
		const publicPort = await unusedPort();
		const running = startSupervisor( fixture, publicPort, backendPort, {
			CORTEXT_COMPILE_RESULT: 'warnings',
			CORTEXT_HOLD_COMPILE: '1',
			CORTEXT_HOLD_SEED: '1',
			CORTEXT_SPLIT_COMPILE: '1',
		} );

		try {
			await waitForOutput( running, 'Seed started' );

			const duringSeed = await request( publicPort );
			assert.equal( duringSeed.statusCode, 503 );
			assert.match( duringSeed.body, /WordPress is starting/ );
			assert.doesNotMatch( running.output().stdout, /Cortext admin:/ );

			writeFileSync( fixture.releaseSeed, '' );
			await waitForOutput( running, 'Watcher ready' );

			const beforeCompilation = await request( publicPort );
			assert.equal( beforeCompilation.statusCode, 503 );
			assert.match( beforeCompilation.body, /WordPress is starting/ );
			assert.doesNotMatch( running.output().stdout, /Cortext admin:/ );
			assert.match( running.output().stdout, /Seed complete/ );
			assert.match( running.output().stdout, /Watcher ready/ );

			writeFileSync( fixture.releaseCompilation, '' );
			await waitForOutput( running, 'Cortext admin:' );

			const ready = await request( publicPort );
			assert.equal( ready.statusCode, 200 );
			assert.equal( ready.body, 'Cortext' );
			assert.match(
				running.output().stdout,
				/webpack 5\.99\.0 compiled with 2 warnings in 25 ms/
			);
			assert.match(
				running.output().stdout,
				new RegExp(
					`Cortext admin: http://localhost:${ publicPort }/wp-admin/admin\\.php\\?page=cortext`
				)
			);
		} finally {
			await stopSupervisor( running );
			await closeServer( backend );
		}
	} );

	it( 'starts wp-env, then seed and watcher, and forwards shutdown', async () => {
		const fixture = createFixture();
		let receivedForwardedHost;
		let receivedHost;
		const backend = http.createServer( ( incoming, response ) => {
			receivedForwardedHost =
				incoming.headers[ 'x-cortext-forwarded-host' ];
			receivedHost = incoming.headers.host;
			response.end( 'Cortext' );
		} );
		const backendPort = await listen( backend );
		const publicPort = await unusedPort();
		const running = startSupervisor( fixture, publicPort, backendPort );

		try {
			await waitForOutput( running, 'Watcher ready' );
			await waitForOutput( running, 'Grandchild ready' );
			await waitForOutput( running, 'Cortext admin:' );
			const result = await request( publicPort, {
				Host: `localhost:${ publicPort }`,
			} );

			assert.equal( result.body, 'Cortext' );
			assert.equal( receivedHost, `localhost:${ backendPort }` );
			assert.equal( receivedForwardedHost, `localhost:${ publicPort }` );
			assert.deepEqual(
				readFileSync( fixture.log, 'utf8' )
					.trim()
					.split( '\n' )
					.slice( 0, 3 ),
				[ 'env:start', 'env:seed', 'dev' ]
			);
			assert.match(
				running.output().stdout,
				new RegExp(
					`Cortext admin: http://localhost:${ publicPort }/wp-admin/admin\\.php\\?page=cortext`
				)
			);
			assert.match(
				running.output().stdout,
				new RegExp(
					`Preparing WordPress at http://localhost:${ backendPort }/status`
				)
			);
			assert.doesNotMatch(
				running.output().stdout,
				new RegExp(
					`WordPress development site started at http://localhost:${ backendPort }`
				)
			);

			const shutdownStarted = Date.now();
			running.child.kill( 'SIGHUP' );
			const [ code, signal ] = await once( running.child, 'exit' );
			assert.equal( code, null );
			assert.equal( signal, 'SIGHUP' );

			const replacement = net.createServer();
			replacement.listen( publicPort, '127.0.0.1' );
			await once( replacement, 'listening' );
			assert.ok(
				Date.now() - shutdownStarted < 200,
				'The public port was not released within 200ms.'
			);
			await closeServer( replacement );

			const shutdownLog = await withTimeout(
				new Promise( ( resolve ) => {
					const checkLog = () => {
						const contents = readFileSync( fixture.log, 'utf8' );
						if (
							contents.includes( 'parent-SIGHUP' ) &&
							contents.includes( 'grandchild-SIGHUP' )
						) {
							resolve( contents );
							return;
						}
						setTimeout( checkLog, 10 );
					};
					checkLog();
				} ),
				'The command process group did not receive SIGHUP.'
			);
			assert.match( shutdownLog, /parent-SIGHUP/ );
			assert.match( shutdownLog, /grandchild-SIGHUP/ );
		} finally {
			await stopSupervisor( running );
			await closeServer( backend );
		}
	} );

	it( 'returns an env start failure without announcing or starting later steps', async () => {
		const fixture = createFixture();
		const publicPort = await unusedPort();
		const backendPort = await unusedPort();
		const running = startSupervisor( fixture, publicPort, backendPort, {
			CORTEXT_FAIL_CODE: '17',
			CORTEXT_FAIL_SCRIPT: 'env:start',
		} );
		const [ code, signal ] = await once( running.child, 'exit' );

		assert.equal( code, 17 );
		assert.equal( signal, null );
		assert.equal( readFileSync( fixture.log, 'utf8' ), 'env:start\n' );
		assert.doesNotMatch( running.output().stdout, /Cortext admin:/ );
	} );

	it( 'returns a seed failure and closes the public listener', async () => {
		const fixture = createFixture();
		const publicPort = await unusedPort();
		const backendPort = await unusedPort();
		const running = startSupervisor( fixture, publicPort, backendPort, {
			CORTEXT_FAIL_CODE: '19',
			CORTEXT_FAIL_SCRIPT: 'env:seed',
		} );
		const [ code, signal ] = await once( running.child, 'exit' );

		assert.equal( code, 19 );
		assert.equal( signal, null );
		assert.deepEqual(
			readFileSync( fixture.log, 'utf8' ).trim().split( '\n' ),
			[ 'env:start', 'env:seed' ]
		);
		assert.doesNotMatch( running.output().stdout, /Cortext admin:/ );

		const replacement = net.createServer();
		replacement.listen( publicPort, '127.0.0.1' );
		await once( replacement, 'listening' );
		await closeServer( replacement );
	} );

	it( 'returns a watcher failure without announcing Cortext', async () => {
		const fixture = createFixture();
		const publicPort = await unusedPort();
		const backendPort = await unusedPort();
		const running = startSupervisor( fixture, publicPort, backendPort, {
			CORTEXT_FAIL_CODE: '23',
			CORTEXT_FAIL_SCRIPT: 'dev',
		} );
		const [ code, signal ] = await once( running.child, 'exit' );

		assert.equal( code, 23 );
		assert.equal( signal, null );
		assert.deepEqual(
			readFileSync( fixture.log, 'utf8' ).trim().split( '\n' ),
			[ 'env:start', 'env:seed', 'dev' ]
		);
		assert.doesNotMatch( running.output().stdout, /Cortext admin:/ );

		const replacement = net.createServer();
		replacement.listen( publicPort, '127.0.0.1' );
		await once( replacement, 'listening' );
		await closeServer( replacement );
	} );

	it( 'keeps startup private after a failed compilation and shutdown', async () => {
		const fixture = createFixture();
		const publicPort = await unusedPort();
		const backendPort = await unusedPort();
		const running = startSupervisor( fixture, publicPort, backendPort, {
			CORTEXT_COMPILE_RESULT: 'errors',
			CORTEXT_SPLIT_COMPILE: '1',
		} );

		try {
			await waitForOutput( running, 'compiled with 1 error' );

			const result = await request( publicPort );
			assert.equal( result.statusCode, 503 );
			assert.doesNotMatch( running.output().stdout, /Cortext admin:/ );

			running.child.kill( 'SIGHUP' );
			const [ code, signal ] = await once( running.child, 'exit' );
			assert.equal( code, null );
			assert.equal( signal, 'SIGHUP' );
			assert.doesNotMatch( running.output().stdout, /Cortext admin:/ );
		} finally {
			await stopSupervisor( running );
		}
	} );
} );
