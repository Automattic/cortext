#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const LOOPBACK_ADDRESS = '127.0.0.1';
const FORWARDED_SIGNALS = [ 'SIGHUP', 'SIGINT', 'SIGTERM' ];
const FORWARDED_HOST_HEADER = 'X-Cortext-Forwarded-Host';
const PROXY_HEADER = 'X-Cortext-Dev-Proxy';
const REWRITABLE_HEADERS = new Set( [
	'access-control-allow-origin',
	'content-location',
	'link',
	'location',
] );
const STARTING_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta http-equiv="refresh" content="1">
		<title>Cortext is starting</title>
	</head>
	<body>
		<p>WordPress is starting. This page will refresh automatically.</p>
	</body>
</html>
`;
const projectRoot = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'..'
);

export function parsePort( value, name ) {
	if ( ! /^(?:[1-9]\d{0,4})$/.test( value ?? '' ) ) {
		throw new Error(
			`${ name } must be a decimal integer from 1 to 65535.`
		);
	}

	const port = Number( value );
	if ( port > 65535 ) {
		throw new Error(
			`${ name } must be a decimal integer from 1 to 65535.`
		);
	}

	return port;
}

export function parseArguments( args ) {
	const values = new Map();

	for ( let index = 0; index < args.length; index += 2 ) {
		const flag = args[ index ];
		const value = args[ index + 1 ];

		if (
			! [
				'--public-port',
				'--backend-port',
				'--proxy-token-file',
			].includes( flag ) ||
			value === undefined
		) {
			throw new Error(
				'Usage: dev-server.mjs --public-port <port> --backend-port <port> --proxy-token-file <path>'
			);
		}

		values.set( flag, value );
	}

	const publicPort = parsePort(
		values.get( '--public-port' ),
		'Public port'
	);
	const backendPort = parsePort(
		values.get( '--backend-port' ),
		'Backend port'
	);

	if ( publicPort === backendPort ) {
		throw new Error( 'Public and backend ports must be different.' );
	}

	const proxyTokenFile = values.get( '--proxy-token-file' );
	if ( ! proxyTokenFile ) {
		throw new Error(
			'Usage: dev-server.mjs --public-port <port> --backend-port <port> --proxy-token-file <path>'
		);
	}

	return { backendPort, proxyTokenFile, publicPort };
}

export function readProxyTokenFile( tokenFile ) {
	const token = readFileSync( tokenFile, 'utf8' ).trim();

	if ( ! token ) {
		throw new Error( `Proxy token file "${ tokenFile }" is empty.` );
	}

	try {
		http.validateHeaderValue( PROXY_HEADER, token );
	} catch {
		throw new Error(
			`Proxy token file "${ tokenFile }" does not contain a valid HTTP header value.`
		);
	}

	return token;
}

export function resolvePublicOrigin( host ) {
	if ( typeof host !== 'string' ) {
		return null;
	}

	const match = host.match(
		/^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9]\d{0,4}))?$/i
	);
	if ( ! match ) {
		return null;
	}
	if ( match[ 1 ] && Number( match[ 1 ] ) > 65535 ) {
		return null;
	}

	return `http://${ host }`;
}

export function rewriteBackendOrigin( value, backendOrigin, publicOrigin ) {
	const escapedBackendOrigin = backendOrigin.replaceAll( '/', '\\/' );
	const escapedPublicOrigin = publicOrigin.replaceAll( '/', '\\/' );

	return value
		.replaceAll( backendOrigin, publicOrigin )
		.replaceAll( escapedBackendOrigin, escapedPublicOrigin );
}

export function isRewritableContentType( contentType ) {
	if ( typeof contentType !== 'string' ) {
		return false;
	}

	const mediaType = contentType.split( ';', 1 )[ 0 ].trim().toLowerCase();

	return (
		[
			'application/javascript',
			'application/json',
			'application/xml',
			'text/css',
			'text/html',
			'text/javascript',
			'text/xml',
		].includes( mediaType ) ||
		mediaType.endsWith( '+json' ) ||
		mediaType.endsWith( '+xml' )
	);
}

export function transformReadinessLine( line, publicPort, backendPort ) {
	const readiness =
		`WordPress development site started at ` +
		`http://localhost:${ backendPort }`;
	const publicUrl =
		`Cortext admin: http://localhost:${ publicPort }/` +
		'wp-admin/admin.php?page=cortext';

	return line.includes( readiness )
		? line.replace( readiness, publicUrl )
		: line;
}

export function createReadinessRelay( { backendPort, output, publicPort } ) {
	let buffer = '';
	const pending = [];

	function processLine( line ) {
		const transformed = transformReadinessLine(
			line,
			publicPort,
			backendPort
		);

		if ( transformed === line ) {
			output.write( line );
			return;
		}

		pending.push( transformed );
	}

	return {
		end() {
			if ( buffer ) {
				processLine( buffer );
				buffer = '';
			}
		},
		release() {
			for ( const line of pending ) {
				output.write( line );
			}
			pending.length = 0;
		},
		write( chunk ) {
			buffer += chunk.toString();

			let newlineIndex = buffer.indexOf( '\n' );
			while ( newlineIndex !== -1 ) {
				processLine( buffer.slice( 0, newlineIndex + 1 ) );
				buffer = buffer.slice( newlineIndex + 1 );
				newlineIndex = buffer.indexOf( '\n' );
			}
		},
	};
}

export function isSuccessfulWebpackCompilation( line ) {
	const output = stripVTControlCharacters( String( line ) );

	return (
		! /\berrors?\b/i.test( output ) &&
		/\bcompiled (?:successfully|with \d+ warnings?)\b/i.test( output )
	);
}

export function createCompilationRelay( { onReady, output } ) {
	let buffer = '';
	let ready = false;

	function processLine( line ) {
		if ( ready || ! isSuccessfulWebpackCompilation( line ) ) {
			return;
		}

		ready = true;
		onReady();
	}

	return {
		end() {
			if ( buffer ) {
				processLine( buffer );
				buffer = '';
			}
		},
		write( chunk ) {
			output.write( chunk );
			if ( ready ) {
				return;
			}

			buffer += chunk.toString();

			let newlineIndex = buffer.indexOf( '\n' );
			while ( newlineIndex !== -1 ) {
				processLine( buffer.slice( 0, newlineIndex + 1 ) );
				buffer = buffer.slice( newlineIndex + 1 );
				newlineIndex = buffer.indexOf( '\n' );
			}
		},
	};
}

function rewriteResponseHeaders(
	rawHeaders,
	backendOrigin,
	publicOrigin,
	bodyLength
) {
	const headers = [];

	for ( let index = 0; index < rawHeaders.length; index += 2 ) {
		const name = rawHeaders[ index ];
		const lowerName = name.toLowerCase();

		if (
			bodyLength !== undefined &&
			( lowerName === 'content-length' ||
				lowerName === 'transfer-encoding' )
		) {
			continue;
		}

		const value =
			publicOrigin && REWRITABLE_HEADERS.has( lowerName )
				? rewriteBackendOrigin(
						rawHeaders[ index + 1 ],
						backendOrigin,
						publicOrigin
				  )
				: rawHeaders[ index + 1 ];
		headers.push( [ name, value ] );
	}

	if ( bodyLength !== undefined ) {
		headers.push( [ 'Content-Length', String( bodyLength ) ] );
	}

	return headers;
}

function canRewriteBody( request, response, publicOrigin ) {
	if (
		! publicOrigin ||
		request.method === 'HEAD' ||
		response.statusCode === 204 ||
		response.statusCode === 206 ||
		response.statusCode === 304
	) {
		return false;
	}

	const contentEncoding = response.headers[ 'content-encoding' ];
	if (
		contentEncoding &&
		String( contentEncoding ).trim().toLowerCase() !== 'identity'
	) {
		return false;
	}

	return isRewritableContentType( response.headers[ 'content-type' ] );
}

export function createProxyServer( {
	backendPort,
	isBackendReady,
	proxyToken,
} ) {
	if ( typeof isBackendReady !== 'function' ) {
		throw new Error( 'The proxy requires a backend readiness check.' );
	}
	if ( ! proxyToken ) {
		throw new Error( 'The proxy requires an authentication token.' );
	}
	http.validateHeaderValue( PROXY_HEADER, proxyToken );
	const backendHost = `localhost:${ backendPort }`;
	const backendOrigin = `http://localhost:${ backendPort }`;

	const server = http.createServer( ( request, response ) => {
		if ( ! isBackendReady() ) {
			request.resume();
			response.writeHead( 503, {
				'Cache-Control': 'no-store',
				'Content-Type': 'text/html; charset=utf-8',
				'Retry-After': '1',
			} );
			response.end( STARTING_PAGE );
			return;
		}

		const originalHost = request.headers.host ?? '';
		const publicOrigin = resolvePublicOrigin( originalHost );
		const upstreamHeaders = {
			...request.headers,
			host: backendHost,
		};
		delete upstreamHeaders[ 'x-cortext-forwarded-host' ];
		delete upstreamHeaders[ 'x-cortext-dev-proxy' ];
		upstreamHeaders[ FORWARDED_HOST_HEADER ] = originalHost;
		upstreamHeaders[ PROXY_HEADER ] = proxyToken;
		if ( publicOrigin ) {
			upstreamHeaders[ 'accept-encoding' ] = 'identity';
		}

		let upstreamResponse;
		const upstream = http.request(
			{
				headers: upstreamHeaders,
				host: LOOPBACK_ADDRESS,
				method: request.method,
				path: request.url,
				port: backendPort,
			},
			( incomingResponse ) => {
				upstreamResponse = incomingResponse;

				const abortResponse = () => {
					if ( ! response.destroyed ) {
						response.destroy();
					}
				};
				upstreamResponse.once( 'aborted', abortResponse );
				upstreamResponse.once( 'error', abortResponse );

				if (
					! canRewriteBody( request, upstreamResponse, publicOrigin )
				) {
					const headers = rewriteResponseHeaders(
						upstreamResponse.rawHeaders,
						backendOrigin,
						publicOrigin
					);
					response.writeHead(
						upstreamResponse.statusCode ?? 502,
						upstreamResponse.statusMessage,
						headers
					);
					upstreamResponse.pipe( response );
					return;
				}

				const chunks = [];
				upstreamResponse.on( 'data', ( chunk ) =>
					chunks.push( chunk )
				);
				upstreamResponse.once( 'end', () => {
					if ( response.destroyed ) {
						return;
					}

					const originalBody = Buffer.concat( chunks );
					const originalText = originalBody.toString( 'utf8' );
					const rewrittenText = rewriteBackendOrigin(
						originalText,
						backendOrigin,
						publicOrigin
					);
					const rewrittenBody =
						originalText === rewrittenText
							? originalBody
							: Buffer.from( rewrittenText );
					const headers = rewriteResponseHeaders(
						upstreamResponse.rawHeaders,
						backendOrigin,
						publicOrigin,
						rewrittenBody.length
					);
					response.writeHead(
						upstreamResponse.statusCode ?? 502,
						upstreamResponse.statusMessage,
						headers
					);
					response.end( rewrittenBody );
				} );
			}
		);

		upstream.on( 'error', () => {
			if ( response.destroyed || response.writableEnded ) {
				return;
			}
			if ( response.headersSent ) {
				response.destroy();
				return;
			}

			response.writeHead( 502, {
				'Content-Type': 'text/plain; charset=utf-8',
			} );
			response.end( 'WordPress is not available yet.\n' );
		} );

		request.on( 'aborted', () => upstream.destroy() );
		request.on( 'error', () => upstream.destroy() );
		response.on( 'close', () => {
			if ( response.writableEnded ) {
				return;
			}

			upstream.destroy();
			upstreamResponse?.destroy();
		} );
		request.pipe( upstream );
	} );

	server.on( 'clientError', ( error, socket ) => {
		if ( error.code === 'ECONNRESET' || ! socket.writable ) {
			return;
		}

		socket.end( 'HTTP/1.1 400 Bad Request\r\n\r\n' );
	} );

	return server;
}

export async function listenOnLoopback( server, port ) {
	await new Promise( ( resolve, reject ) => {
		const handleError = ( error ) => {
			server.off( 'listening', handleListening );
			reject( error );
		};
		const handleListening = () => {
			server.off( 'error', handleError );
			resolve();
		};

		server.once( 'error', handleError );
		server.once( 'listening', handleListening );
		server.listen( port, LOOPBACK_ADDRESS );
	} );
}

export async function closeServer( server ) {
	if ( ! server?.listening ) {
		return;
	}

	await new Promise( ( resolve ) => {
		server.close( resolve );
		server.closeAllConnections?.();
	} );
}

function signalChildGroup( child, signal ) {
	if ( ! child?.pid ) {
		return;
	}

	if ( process.platform !== 'win32' ) {
		try {
			process.kill( -child.pid, signal );
			return;
		} catch ( error ) {
			if ( error.code === 'ESRCH' ) {
				return;
			}
		}
	}

	child.kill( signal );
}

function runCommand( {
	args,
	command,
	cwd,
	env,
	onSuccessfulCompilation,
	onChild,
	stderr,
	stdout,
	transformReadiness,
} ) {
	return new Promise( ( resolve ) => {
		const captureOutput = transformReadiness || onSuccessfulCompilation;
		const child = spawn( command, args, {
			cwd,
			detached: process.platform !== 'win32',
			env,
			stdio: captureOutput ? [ 'inherit', 'pipe', 'pipe' ] : 'inherit',
		} );
		let settled = false;
		let stdoutRelay;
		let stderrRelay;

		onChild( child );

		if ( transformReadiness ) {
			stdoutRelay = createReadinessRelay( {
				...transformReadiness,
				output: stdout,
			} );
			stderrRelay = createReadinessRelay( {
				...transformReadiness,
				output: stderr,
			} );
			child.stdout.on( 'data', ( chunk ) => stdoutRelay.write( chunk ) );
			child.stderr.on( 'data', ( chunk ) => stderrRelay.write( chunk ) );
		} else if ( onSuccessfulCompilation ) {
			stdoutRelay = createCompilationRelay( {
				onReady: onSuccessfulCompilation,
				output: stdout,
			} );
			stderrRelay = createCompilationRelay( {
				onReady: onSuccessfulCompilation,
				output: stderr,
			} );
			child.stdout.on( 'data', ( chunk ) => stdoutRelay.write( chunk ) );
			child.stderr.on( 'data', ( chunk ) => stderrRelay.write( chunk ) );
		}

		child.once( 'error', ( error ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			stdoutRelay?.end();
			stderrRelay?.end();
			resolve( { code: 1, error, signal: null } );
		} );

		child.once( 'close', ( code, signal ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			stdoutRelay?.end();
			stderrRelay?.end();
			resolve( {
				code: code ?? ( signal ? null : 1 ),
				relays: [ stdoutRelay, stderrRelay ].filter( Boolean ),
				signal,
			} );
		} );
	} );
}

function successful( result ) {
	return result.code === 0 && result.signal === null;
}

export async function runDevServer( {
	backendPort,
	command = 'pnpm',
	cwd = projectRoot,
	env = process.env,
	publicPort,
	proxyToken,
	stderr = process.stderr,
	stdout = process.stdout,
} ) {
	let activeChild;
	let backendReady = false;
	let proxyServer;
	let shutdownSignal;
	let closingServer;

	const closeProxy = () => {
		closingServer ??= closeServer( proxyServer );
		return closingServer;
	};

	const signalHandlers = Object.fromEntries(
		FORWARDED_SIGNALS.map( ( signal ) => [
			signal,
			() => {
				if ( shutdownSignal ) {
					return;
				}

				shutdownSignal = signal;
				signalChildGroup( activeChild, signal );
				void closeProxy();
			},
		] )
	);

	for ( const [ signal, handler ] of Object.entries( signalHandlers ) ) {
		process.on( signal, handler );
	}

	const run = ( script, options = {} ) =>
		runCommand( {
			args: [ 'run', script ],
			command,
			cwd,
			env,
			onChild: ( child ) => {
				activeChild = child;
			},
			stderr,
			stdout,
			...options,
		} ).finally( () => {
			activeChild = undefined;
		} );

	try {
		proxyServer = createProxyServer( {
			backendPort,
			isBackendReady: () => backendReady,
			proxyToken,
		} );
		await listenOnLoopback( proxyServer, publicPort );

		if ( shutdownSignal ) {
			return { code: null, signal: shutdownSignal };
		}

		const startResult = await run( 'env:start', {
			transformReadiness: { backendPort, publicPort },
		} );

		if ( shutdownSignal ) {
			return { code: null, signal: shutdownSignal };
		}
		if ( ! successful( startResult ) ) {
			if ( startResult.error ) {
				stderr.write(
					`Could not start pnpm: ${ startResult.error.message }\n`
				);
			}
			return startResult;
		}

		const seedResult = await run( 'env:seed' );
		if ( shutdownSignal ) {
			return { code: null, signal: shutdownSignal };
		}
		if ( ! successful( seedResult ) ) {
			return seedResult;
		}

		const releaseReadiness = () => {
			if ( backendReady || shutdownSignal ) {
				return;
			}

			backendReady = true;
			for ( const relay of startResult.relays ) {
				relay.release();
			}
		};
		const devResult = await run( 'dev', {
			onSuccessfulCompilation: releaseReadiness,
		} );
		if ( shutdownSignal ) {
			return { code: null, signal: shutdownSignal };
		}

		return devResult;
	} catch ( error ) {
		stderr.write(
			`Could not start local dev server: ${ error.message }\n`
		);
		return { code: 1, signal: null };
	} finally {
		await closeProxy();
		for ( const [ signal, handler ] of Object.entries( signalHandlers ) ) {
			process.off( signal, handler );
		}
	}
}

async function main() {
	let options;
	try {
		options = parseArguments( process.argv.slice( 2 ) );
		options.proxyToken = readProxyTokenFile( options.proxyTokenFile );
	} catch ( error ) {
		process.stderr.write( `${ error.message }\n` );
		process.exitCode = 1;
		return;
	}

	const result = await runDevServer( options );
	if ( result.signal ) {
		process.kill( process.pid, result.signal );
		return;
	}

	process.exitCode = result.code ?? 1;
}

const isMain =
	process.argv[ 1 ] &&
	path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url );

if ( isMain ) {
	await main();
}
