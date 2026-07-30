#!/usr/bin/env node

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import {
	accessSync,
	constants as fsConstants,
	mkdtempSync,
	rmSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORTEXT_URL_PATTERN = /\/wp-admin\/admin\.php\?page=cortext(?:&|$)/;
const CORTEXT_ROOT_SELECTOR = '#cortext-root';
const ACTIVE_CANVAS_SELECTOR =
	'.cortext-workspace__pane[data-active="true"] .cortext-canvas';
const ACTIVE_CANVAS_LOADING_SELECTOR =
	'.cortext-workspace__pane[data-active="true"] .cortext-canvas__loading';
const START_TIMEOUT_MS = 120_000;
const EXIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

function usage() {
	return 'Usage: node apps/desktop/scripts/packaged-app-smoke.mjs --app <path-to-Cortext.app>';
}

function parseArguments( argv ) {
	let appPath = null;

	for ( let index = 0; index < argv.length; index++ ) {
		if ( argv[ index ] === '--app' ) {
			appPath = argv[ ++index ] ?? null;
			continue;
		}
		if ( argv[ index ] === '--help' || argv[ index ] === '-h' ) {
			console.log( usage() );
			process.exit( 0 );
		}
		throw new Error( `Unknown argument: ${ argv[ index ] }\n${ usage() }` );
	}

	if ( ! appPath ) {
		throw new Error( `Missing --app.\n${ usage() }` );
	}

	return path.resolve( appPath );
}

function assert( condition, message ) {
	if ( ! condition ) {
		throw new Error( message );
	}
}

function delay( milliseconds ) {
	return new Promise( ( resolve ) => setTimeout( resolve, milliseconds ) );
}

async function reserveLoopbackPort() {
	const server = net.createServer();
	await new Promise( ( resolve, reject ) => {
		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', resolve );
	} );
	const address = server.address();
	assert(
		address && typeof address !== 'string',
		'Could not reserve a loopback port for Chromium CDP.'
	);
	await new Promise( ( resolve, reject ) => {
		server.close( ( error ) => ( error ? reject( error ) : resolve() ) );
	} );
	return address.port;
}

function executableForApp( appPath ) {
	const executable = path.join( appPath, 'Contents/MacOS/Cortext' );
	accessSync( executable, fsConstants.X_OK );
	return executable;
}

function captureProcessOutput( child, label ) {
	let output = '';
	const capture = ( stream, destination ) => {
		stream?.on( 'data', ( chunk ) => {
			const text = chunk.toString();
			output = `${ output }${ text }`.slice( -64 * 1024 );
			destination.write( `[${ label }] ${ text }` );
		} );
	};
	capture( child.stdout, process.stdout );
	capture( child.stderr, process.stderr );
	return () => output;
}

function spawnApp( executable, args, label ) {
	const child = spawn( executable, args, {
		detached: true,
		env: {
			...process.env,
			CORTEXT_E2E: '1',
			CORTEXT_RUNTIME_QUIET: '1',
		},
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	const output = captureProcessOutput( child, label );
	child.once( 'error', ( error ) => {
		console.error( `[${ label }] failed to launch:`, error );
	} );
	return { child, output };
}

function processHasExited( child ) {
	return child.exitCode !== null || child.signalCode !== null;
}

function waitForProcessExit( child, timeoutMs, label ) {
	if ( processHasExited( child ) ) {
		return Promise.resolve( {
			code: child.exitCode,
			signal: child.signalCode,
		} );
	}

	return new Promise( ( resolve, reject ) => {
		const cleanup = () => {
			clearTimeout( timeout );
			child.off( 'error', onError );
			child.off( 'exit', onExit );
		};
		const onError = ( error ) => {
			cleanup();
			reject( error );
		};
		const onExit = ( code, signal ) => {
			cleanup();
			resolve( { code, signal } );
		};
		const timeout = setTimeout( () => {
			cleanup();
			reject(
				new Error(
					`${ label } stayed open for more than ${ timeoutMs }ms.`
				)
			);
		}, timeoutMs );
		child.once( 'error', onError );
		child.once( 'exit', onExit );
	} );
}

function signalProcessGroup( child, signal ) {
	if ( ! child?.pid ) {
		return false;
	}
	try {
		process.kill( -child.pid, signal );
		return true;
	} catch ( error ) {
		if ( error.code === 'ESRCH' ) {
			return false;
		}
		throw error;
	}
}

async function terminateProcessGroup( child ) {
	if ( ! child?.pid || ! signalProcessGroup( child, 'SIGTERM' ) ) {
		return;
	}

	const deadline = Date.now() + 5_000;
	while ( Date.now() < deadline ) {
		await delay( 100 );
		try {
			process.kill( -child.pid, 0 );
		} catch ( error ) {
			if ( error.code === 'ESRCH' ) {
				return;
			}
			throw error;
		}
	}
	signalProcessGroup( child, 'SIGKILL' );
}

async function assertProcessGroupIsClosed( child, label ) {
	const deadline = Date.now() + EXIT_TIMEOUT_MS;

	while ( Date.now() < deadline ) {
		try {
			process.kill( -child.pid, 0 );
		} catch ( error ) {
			if ( error.code === 'ESRCH' ) {
				return;
			}
			throw error;
		}
		await delay( POLL_INTERVAL_MS );
	}

	throw new Error(
		`${ label } left one or more processes running after shutdown.`
	);
}

export function request( url, timeoutMs = 2_000 ) {
	return new Promise( ( resolve, reject ) => {
		let response = null;
		let settled = false;
		let timeout = null;
		const finish = ( callback, value ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			clearTimeout( timeout );
			callback( value );
		};
		const fail = ( error ) => finish( reject, error );
		const onAborted = () =>
			fail( new Error( `Response aborted: ${ url }` ) );
		const onResponseClose = () => {
			if ( ! response.complete ) {
				onAborted();
			}
		};
		const outgoing = http.get( url, ( incoming ) => {
			response = incoming;
			const chunks = [];
			response.on( 'data', ( chunk ) => chunks.push( chunk ) );
			response.once( 'aborted', onAborted );
			response.once( 'close', onResponseClose );
			response.once( 'error', fail );
			response.once( 'end', () => {
				finish( resolve, {
					body: Buffer.concat( chunks ).toString( 'utf8' ),
					statusCode: response.statusCode,
				} );
			} );
		} );
		outgoing.once( 'error', fail );
		timeout = setTimeout( () => {
			const error = new Error( `Request timed out: ${ url }` );
			fail( error );
			outgoing.destroy();
		}, timeoutMs );
	} );
}

async function waitForCdp( port, child, output ) {
	const endpoint = `http://127.0.0.1:${ port }`;
	const deadline = Date.now() + START_TIMEOUT_MS;
	let lastError = null;

	while ( Date.now() < deadline ) {
		if ( processHasExited( child ) ) {
			throw new Error(
				`Cortext exited before CDP became ready (code=${
					child.exitCode
				}, signal=${ child.signalCode }).\n${ output() }`
			);
		}
		try {
			const response = await request( `${ endpoint }/json/version` );
			if ( response.statusCode === 200 ) {
				return endpoint;
			}
		} catch ( error ) {
			lastError = error;
		}
		await delay( POLL_INTERVAL_MS );
	}

	throw new Error(
		`Chromium CDP did not become ready at ${ endpoint }: ${
			lastError?.message ?? 'timed out'
		}`
	);
}

async function firstRendererPage( browser ) {
	const deadline = Date.now() + START_TIMEOUT_MS;

	while ( Date.now() < deadline ) {
		for ( const context of browser.contexts() ) {
			const [ page ] = context.pages();
			if ( page ) {
				return page;
			}
		}
		await delay( POLL_INTERVAL_MS );
	}
	throw new Error( 'Cortext did not open a renderer page.' );
}

async function waitForCortextShell( page ) {
	await page.waitForURL( CORTEXT_URL_PATTERN, {
		timeout: START_TIMEOUT_MS,
		waitUntil: 'domcontentloaded',
	} );
	await page.locator( CORTEXT_ROOT_SELECTOR ).waitFor( {
		state: 'visible',
		timeout: 30_000,
	} );
	await page.locator( ACTIVE_CANVAS_LOADING_SELECTOR ).waitFor( {
		state: 'hidden',
		timeout: 30_000,
	} );
	await page.locator( ACTIVE_CANVAS_SELECTOR ).waitFor( {
		state: 'visible',
		timeout: 30_000,
	} );
}

async function assertRuntimeIsClosed( runtimeOrigin ) {
	const deadline = Date.now() + EXIT_TIMEOUT_MS;
	let lastError = null;

	while ( Date.now() < deadline ) {
		try {
			await request( runtimeOrigin, 1_000 );
		} catch ( error ) {
			lastError = error;
			if (
				[ 'ECONNREFUSED', 'ECONNRESET', 'EPIPE' ].includes( error.code )
			) {
				return;
			}
		}
		await delay( POLL_INTERVAL_MS );
	}

	throw new Error(
		`PHP is still listening at ${ runtimeOrigin } after Electron exited (${
			lastError?.message ?? 'no connection error'
		}).`
	);
}

async function runSmoke( appPath ) {
	assert(
		process.platform === 'darwin',
		'This smoke test only runs on macOS.'
	);
	const executable = executableForApp( appPath );
	const cdpPort = await reserveLoopbackPort();
	const tempRoot = mkdtempSync(
		path.join( os.tmpdir(), 'cortext-packaged-smoke-' )
	);
	const userDataPath = path.join( tempRoot, 'user-data' );
	const firstArgs = [
		`--user-data-dir=${ userDataPath }`,
		'--remote-debugging-address=127.0.0.1',
		`--remote-debugging-port=${ cdpPort }`,
	];
	let first = null;
	let second = null;
	let browser = null;
	let completed = false;

	try {
		console.log( `Launching packaged app: ${ appPath }` );
		first = spawnApp( executable, firstArgs, 'cortext' );
		const cdpEndpoint = await waitForCdp(
			cdpPort,
			first.child,
			first.output
		);
		browser = await chromium.connectOverCDP( cdpEndpoint );
		const page = await firstRendererPage( browser );
		await waitForCortextShell( page );

		const runtimeUrl = new URL( page.url() );
		assert(
			CORTEXT_URL_PATTERN.test(
				`${ runtimeUrl.pathname }${ runtimeUrl.search }`
			),
			`Unexpected Cortext renderer URL: ${ runtimeUrl.href }`
		);
		assert(
			runtimeUrl.protocol === 'http:' &&
				runtimeUrl.hostname === '127.0.0.1' &&
				runtimeUrl.port,
			`Cortext renderer did not use a loopback runtime origin: ${ runtimeUrl.origin }`
		);
		const runtimeOrigin = runtimeUrl.origin;
		console.log( `Cortext loaded at ${ runtimeOrigin }.` );

		const unauthenticated = await request( `${ runtimeOrigin }/wp-json/` );
		assert(
			unauthenticated.statusCode === 403,
			`Expected an unauthenticated runtime request to return 403, got ${ unauthenticated.statusCode }.`
		);
		console.log( 'Unauthenticated runtime request returned 403.' );

		second = spawnApp(
			executable,
			[ `--user-data-dir=${ userDataPath }` ],
			'second-instance'
		);
		const secondExit = await waitForProcessExit(
			second.child,
			15_000,
			'Second Cortext instance'
		);
		assert(
			secondExit.code === 0 && secondExit.signal === null,
			`Second Cortext instance exited unexpectedly (code=${ secondExit.code }, signal=${ secondExit.signal }).`
		);
		assert(
			! processHasExited( first.child ),
			'The first Cortext instance exited when the second instance launched.'
		);
		console.log( 'Second instance exited; the first is still running.' );

		await page.close();
		const firstExit = await waitForProcessExit(
			first.child,
			EXIT_TIMEOUT_MS,
			'Cortext'
		);
		assert(
			firstExit.code === 0 && firstExit.signal === null,
			`Cortext exited unexpectedly (code=${ firstExit.code }, signal=${ firstExit.signal }).`
		);
		await assertRuntimeIsClosed( runtimeOrigin );
		await assertProcessGroupIsClosed( first.child, 'Cortext' );
		completed = true;
		console.log( 'Cortext exited with code 0 and PHP stopped.' );
	} catch ( error ) {
		if ( first?.output ) {
			error.message = `${
				error.message
			}\n\nPackaged app output:\n${ first.output() }`;
		}
		throw error;
	} finally {
		if ( browser ) {
			await browser.close().catch( () => {} );
		}
		await terminateProcessGroup( second?.child );
		await terminateProcessGroup( first?.child );
		rmSync( tempRoot, {
			force: true,
			maxRetries: 3,
			recursive: true,
		} );
		if ( ! completed ) {
			console.error( 'Cleaned up after failed smoke test.' );
		}
	}
}

const invokedPath = process.argv[ 1 ] && path.resolve( process.argv[ 1 ] );
if ( invokedPath === fileURLToPath( import.meta.url ) ) {
	try {
		await runSmoke( parseArguments( process.argv.slice( 2 ) ) );
	} catch ( error ) {
		console.error( error.stack || error );
		process.exitCode = 1;
	}
}
