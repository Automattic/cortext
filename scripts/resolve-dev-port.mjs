#!/usr/bin/env node
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const FALLBACK_PORT_BASE = 8000;
const FALLBACK_PORT_RANGE = 1000;

function workspaceHash( workspacePath ) {
	return createHash( 'sha1' )
		.update( path.resolve( workspacePath ) )
		.digest( 'hex' );
}

export function resolveDevPort( workspacePath, conductorPort ) {
	if ( conductorPort !== undefined ) {
		if (
			typeof conductorPort !== 'string' ||
			! /^\d+$/.test( conductorPort )
		) {
			throw new Error(
				`Invalid CONDUCTOR_PORT "${ conductorPort }". Expected a decimal integer from ${ MIN_PORT } to ${ MAX_PORT }.`
			);
		}

		const port = Number( conductorPort );
		if ( port < MIN_PORT || port > MAX_PORT ) {
			throw new Error(
				`Invalid CONDUCTOR_PORT "${ conductorPort }". Expected a decimal integer from ${ MIN_PORT } to ${ MAX_PORT }.`
			);
		}

		return port;
	}

	const hashPrefix = workspaceHash( workspacePath ).slice( 0, 6 );

	return (
		FALLBACK_PORT_BASE +
		( Number.parseInt( hashPrefix, 16 ) % FALLBACK_PORT_RANGE )
	);
}

export function resolveBackendPort( publicPort ) {
	if (
		! Number.isInteger( publicPort ) ||
		publicPort < MIN_PORT ||
		publicPort >= MAX_PORT
	) {
		throw new Error(
			`Cannot reserve a WordPress backend port after public port "${ publicPort }".`
		);
	}

	return publicPort + 1;
}

export function resolveProxyTokenPath(
	workspacePath,
	temporaryDirectory = os.tmpdir()
) {
	return path.join(
		temporaryDirectory,
		'cortext-dev-proxy',
		`${ workspaceHash( workspacePath ) }.token`
	);
}

function main() {
	const args = process.argv.slice( 2 );

	if (
		args.length > 1 ||
		( args.length === 1 &&
			! [ '--backend', '--token-file' ].includes( args[ 0 ] ) )
	) {
		throw new Error(
			'Usage: resolve-dev-port.mjs [--backend|--token-file]'
		);
	}

	if ( args[ 0 ] === '--token-file' ) {
		resolveDevPort( process.cwd(), process.env.CONDUCTOR_PORT );
		process.stdout.write( `${ resolveProxyTokenPath( process.cwd() ) }\n` );
		return;
	}

	const publicPort = resolveDevPort(
		process.cwd(),
		process.env.CONDUCTOR_PORT
	);
	const port =
		args[ 0 ] === '--backend'
			? resolveBackendPort( publicPort )
			: publicPort;
	process.stdout.write( `${ port }\n` );
}

if (
	process.argv[ 1 ] &&
	path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url )
) {
	try {
		main();
	} catch ( error ) {
		process.stderr.write( `${ error.message }\n` );
		process.exitCode = 1;
	}
}
