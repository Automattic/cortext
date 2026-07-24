#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import {
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const require = createRequire( import.meta.url );
const {
	DEFAULT_PORT,
	normalizeRuntime,
	RUNTIME_AUTH_HEADER,
	startRuntime,
	stopRuntime,
} = require( '../lib/runtime' );

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const DESKTOP_DIR = resolve( __dirname, '..' );
const SNAPSHOT_ZIP = resolve( DESKTOP_DIR, 'snapshot.zip' );

const ENDPOINTS = [
	{
		name: 'admin_shell',
		path: '/wp-admin/admin.php?page=cortext',
	},
	{
		name: 'workspace_home',
		path: '/wp-json/cortext/v1/workspace-home/',
	},
	{
		name: 'pages_list',
		path: '/wp-json/wp/v2/crtxt_documents/?context=edit&per_page=10&status[]=draft&status[]=private&status[]=publish&cortext_no_trait=1&cortext_no_collections=1',
	},
	{
		name: 'collections_list',
		path: '/wp-json/wp/v2/crtxt_documents/?context=edit&per_page=10&status[]=draft&status[]=private&status[]=publish&cortext_collections=1',
	},
];

function readOptions() {
	const options = {
		runtime: process.env.CORTEXT_RUNTIME || 'php',
		iterations: 50,
		warmup: 10,
		label: process.env.CORTEXT_RUNTIME_LABEL || null,
	};

	for ( const arg of process.argv.slice( 2 ) ) {
		const [ key, value ] = arg.replace( /^--/, '' ).split( '=' );
		if ( key === 'runtime' && value ) {
			options.runtime = value;
		} else if ( key === 'iterations' && value ) {
			options.iterations = Number.parseInt( value, 10 );
		} else if ( key === 'warmup' && value ) {
			options.warmup = Number.parseInt( value, 10 );
		} else if ( key === 'label' && value ) {
			options.label = value;
		}
	}

	if ( ! Number.isInteger( options.iterations ) || options.iterations < 1 ) {
		throw new Error( '--iterations must be a positive integer.' );
	}
	if ( ! Number.isInteger( options.warmup ) || options.warmup < 0 ) {
		throw new Error( '--warmup must be zero or a positive integer.' );
	}

	options.runtime = normalizeRuntime( options.runtime );
	if ( options.label && ! /^[a-z0-9._-]+$/i.test( options.label ) ) {
		throw new Error( '--label may only contain letters, numbers, dots, underscores, and dashes.' );
	}
	return options;
}

function unzipSnapshot( workDir ) {
	const siteRoot = resolve( workDir, 'site' );
	const wordpressDir = resolve( siteRoot, 'wordpress' );
	rmSync( workDir, { recursive: true, force: true } );
	mkdirSync( siteRoot, { recursive: true } );

	const result = spawnSync(
		'unzip',
		[ '-q', '-o', SNAPSHOT_ZIP, '-d', siteRoot ],
		{ stdio: [ 'ignore', 'ignore', 'ignore' ] }
	);
	if (
		result.status !== 0 &&
		! existsSync( resolve( wordpressDir, 'index.php' ) )
	) {
		throw new Error( `Snapshot extraction failed from ${ SNAPSHOT_ZIP }.` );
	}
	return wordpressDir;
}

function parseServerTiming( header ) {
	if ( ! header ) {
		return null;
	}
	const value = Array.isArray( header ) ? header.join( ',' ) : String( header );
	const match = value.match( /(?:^|,\s*)cortext_wp;dur=([0-9.]+)/ );
	return match ? Number.parseFloat( match[1] ) : null;
}

function redirectedPath( location ) {
	const url = new URL( location, `http://127.0.0.1:${ DEFAULT_PORT }` );
	return `${ url.pathname }${ url.search }`;
}

function requestPath(
	endpoint,
	authToken,
	redirects = 0,
	startedAt = performance.now()
) {
	return new Promise( ( resolveRequest, rejectRequest ) => {
		const req = http.get(
			{
				host: '127.0.0.1',
				headers: {
					[ RUNTIME_AUTH_HEADER ]: authToken,
				},
				port: DEFAULT_PORT,
				path: endpoint.path,
				timeout: 30000,
			},
			( res ) => {
				res.resume();
				res.on( 'end', () => {
					const duration = performance.now() - startedAt;
					const location = res.headers.location;
					if (
						res.statusCode &&
						[ 301, 302, 303, 307, 308 ].includes( res.statusCode ) &&
						location &&
						redirects < 5
					) {
						requestPath(
							{
								...endpoint,
								path: redirectedPath( location ),
							},
							authToken,
							redirects + 1,
							startedAt
						).then( resolveRequest, rejectRequest );
						return;
					}
					if ( ! res.statusCode || res.statusCode >= 500 ) {
						rejectRequest(
							new Error(
								`${ endpoint.name } returned HTTP ${ res.statusCode }`
							)
						);
						return;
					}
					resolveRequest( {
						totalMs: duration,
						serverMs: parseServerTiming(
							res.headers['server-timing']
						),
						status: res.statusCode,
					} );
				} );
			}
		);
		req.on( 'timeout', () => {
			req.destroy( new Error( `${ endpoint.name } timed out` ) );
		} );
		req.on( 'error', rejectRequest );
	} );
}

function percentile( values, p ) {
	if ( values.length === 0 ) {
		return null;
	}
	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	const index = Math.min(
		sorted.length - 1,
		Math.max( 0, Math.ceil( ( p / 100 ) * sorted.length ) - 1 )
	);
	return Math.round( sorted[ index ] * 1000 ) / 1000;
}

function summarize( samples ) {
	const total = samples.map( ( sample ) => sample.totalMs );
	const server = samples
		.map( ( sample ) => sample.serverMs )
		.filter( ( value ) => typeof value === 'number' && ! Number.isNaN( value ) );
	return {
		status: samples[ samples.length - 1 ]?.status ?? null,
		requests: samples.length,
		total_p50_ms: percentile( total, 50 ),
		total_p95_ms: percentile( total, 95 ),
		server_p50_ms: percentile( server, 50 ),
		server_p95_ms: percentile( server, 95 ),
	};
}

async function runEndpoint( endpoint, warmup, iterations, authToken ) {
	for ( let index = 0; index < warmup; index++ ) {
		await requestPath( endpoint, authToken );
	}

	const samples = [];
	for ( let index = 0; index < iterations; index++ ) {
		samples.push( await requestPath( endpoint, authToken ) );
	}

	return summarize( samples );
}

async function stopAndWait( handle ) {
	stopRuntime( handle );
	await Promise.all(
		handle.processes.map(
			( { child } ) =>
				new Promise( ( resolveStop ) => {
					if ( child.exitCode !== null || child.signalCode !== null ) {
						resolveStop();
						return;
					}
					child.once( 'exit', resolveStop );
				} )
		)
	);
}

function commandVersion( command, args ) {
	const result = spawnSync( command, args, {
		encoding: 'utf8',
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	if ( result.status !== 0 ) {
		return null;
	}
	return ( result.stdout || result.stderr ).split( '\n' )[0].trim();
}

function phpRuntimeBin() {
	if ( process.env.CORTEXT_PHP_BIN ) {
		return process.env.CORTEXT_PHP_BIN;
	}
	const bundled = resolve( DESKTOP_DIR, 'runtime/bin/php' );
	return existsSync( bundled ) ? bundled : 'php';
}

function runtimeBin( envName, bundledPath, command ) {
	if ( process.env[ envName ] ) {
		return process.env[ envName ];
	}
	return existsSync( bundledPath ) ? bundledPath : command;
}

function environmentInfo( runtime ) {
	const environment = {
		node: process.version,
	};

	if ( runtime === 'php' ) {
		const phpBin = phpRuntimeBin();
		environment.php = commandVersion( phpBin, [ '-v' ] );
		environment.php_bin = phpBin;
		return environment;
	}

	if ( runtime === 'franken' ) {
		const frankenBin = runtimeBin(
			'CORTEXT_FRANKENPHP_BIN',
			resolve( DESKTOP_DIR, 'runtime/bin/frankenphp' ),
			'frankenphp'
		);
		environment.frankenphp = commandVersion( frankenBin, [ 'version' ] );
		environment.frankenphp_bin = frankenBin;
		return environment;
	}

	if ( runtime === 'php-fpm' ) {
		const phpFpmBin = runtimeBin(
			'CORTEXT_PHP_FPM_BIN',
			resolve( DESKTOP_DIR, 'runtime/bin/php-fpm' ),
			'php-fpm'
		);
		const caddyBin = runtimeBin(
			'CORTEXT_CADDY_BIN',
			resolve( DESKTOP_DIR, 'runtime/bin/caddy' ),
			'caddy'
		);
		environment.php_fpm = commandVersion( phpFpmBin, [ '-v' ] );
		environment.php_fpm_bin = phpFpmBin;
		environment.caddy = commandVersion( caddyBin, [ 'version' ] );
		environment.caddy_bin = caddyBin;
	}

	return environment;
}

async function main() {
	const options = readOptions();
	if ( ! existsSync( SNAPSHOT_ZIP ) ) {
		throw new Error(
			`Missing ${ SNAPSHOT_ZIP }. Run 'npm --prefix apps/desktop run snapshot' first.`
		);
	}

	const workDir = resolve( DESKTOP_DIR, '.runtime-bench', options.runtime );
	const wordpressDir = unzipSnapshot( workDir );
	const authToken = randomBytes( 32 ).toString( 'hex' );
	process.env.CORTEXT_RUNTIME_QUIET = process.env.CORTEXT_RUNTIME_QUIET || '1';
	let unexpectedExit = null;
	const handle = startRuntime( {
		appDir: DESKTOP_DIR,
		authToken,
		wordpressDir,
		runtime: options.runtime,
		runtimeStateDir: resolve( workDir, 'state' ),
		onUnexpectedExit: ( name, code, signal ) => {
			unexpectedExit = new Error(
				`${ name } exited unexpectedly (code=${ code }, signal=${ signal })`
			);
		},
	} );

	try {
		await handle.ready;
		if ( unexpectedExit ) {
			throw unexpectedExit;
		}
		const scenarios = {};
		for ( const endpoint of ENDPOINTS ) {
			scenarios[ endpoint.name ] = await runEndpoint(
				endpoint,
				options.warmup,
				options.iterations,
				authToken
			);
		}

		const result = {
			version: 1,
			runtime: options.runtime,
			iterations: options.iterations,
			warmup: options.warmup,
			port: DEFAULT_PORT,
			generated_at: new Date().toISOString(),
			environment: environmentInfo( options.runtime ),
			scenarios,
		};

		const outDir = resolve( process.cwd(), 'artifacts' );
		mkdirSync( outDir, { recursive: true } );
		const outFile = resolve(
			outDir,
			`desktop-runtime-${ options.label || options.runtime }.json`
		);
		writeFileSync( outFile, JSON.stringify( result, null, 2 ) + '\n' );

		console.table(
			Object.entries( scenarios ).map( ( [ name, metrics ] ) => ( {
				name,
				...metrics,
			} ) )
		);
		console.log( `[bench-runtime] Wrote ${ outFile }` );
	} finally {
		await stopAndWait( handle );
	}
}

main().catch( ( err ) => {
	console.error( `[bench-runtime] ${ err.message }` );
	process.exitCode = 1;
} );
