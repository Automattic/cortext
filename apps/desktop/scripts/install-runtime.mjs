#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	rmSync,
} from 'node:fs';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const DESKTOP_DIR = resolve( __dirname, '..' );
const BIN_DIR = resolve( DESKTOP_DIR, 'runtime/bin' );
const CACHE_DIR = resolve( DESKTOP_DIR, '.runtime-cache' );

const PHP_VERSION = process.env.CORTEXT_STATIC_PHP_VERSION || '8.5';
const SPC_VERSION = process.env.CORTEXT_SPC_VERSION || '2.8.5';
const FRANKENPHP_VERSION =
	process.env.CORTEXT_FRANKENPHP_VERSION || 'v1.12.2';
const CADDY_VERSION = process.env.CORTEXT_CADDY_VERSION || '2.11.3';

const PHP_EXTENSIONS = [
	'opcache',
	'pdo',
	'pdo_sqlite',
	'sqlite3',
	'mbstring',
	'curl',
	'openssl',
	'zip',
	'zlib',
	'gd',
	'xml',
	'dom',
	'simplexml',
	'xmlreader',
	'xmlwriter',
	'phar',
	'session',
	'tokenizer',
	'fileinfo',
	'filter',
	'ctype',
	'iconv',
	'bcmath',
	'bz2',
	'calendar',
	'exif',
];

function readOptions() {
	const options = {
		runtime: process.argv[ 2 ],
		force: process.argv.includes( '--force' ),
		rebuild: process.argv.includes( '--rebuild' ),
	};

	if (
		! options.runtime ||
		[ '-h', '--help', 'help' ].includes( options.runtime )
	) {
		console.log(
			[
				'Usage: node scripts/install-runtime.mjs <php|franken|caddy> [--force] [--rebuild]',
				'',
				'Examples:',
				'  npm --prefix apps/desktop run runtime:php',
				'  npm --prefix apps/desktop run runtime:franken',
				'  npm --prefix apps/desktop run runtime:caddy',
			].join( '\n' )
		);
		process.exit( options.runtime ? 0 : 1 );
	}

	return options;
}

function platformKey() {
	if ( process.platform !== 'darwin' ) {
		throw new Error(
			`Only macOS runtime artifacts are supported by this spike script. Current platform: ${ process.platform }.`
		);
	}
	if ( process.arch === 'arm64' ) {
		return 'macos-aarch64';
	}
	if ( process.arch === 'x64' ) {
		return 'macos-x86_64';
	}
	throw new Error( `Unsupported macOS architecture: ${ process.arch }.` );
}

function frankenPlatformName() {
	return platformKey() === 'macos-aarch64' ? 'mac-arm64' : 'mac-x86_64';
}

function caddyPlatformName() {
	return platformKey() === 'macos-aarch64' ? 'mac_arm64' : 'mac_amd64';
}

function run( command, args, options = {} ) {
	const result = spawnSync( command, args, {
		stdio: 'inherit',
		...options,
	} );
	if ( result.status !== 0 ) {
		throw new Error(
			`${ command } ${ args.join( ' ' ) } failed with exit code ${ result.status }`
		);
	}
}

function output( command, args ) {
	const result = spawnSync( command, args, {
		encoding: 'utf8',
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	if ( result.status !== 0 ) {
		throw new Error(
			`${ command } ${ args.join( ' ' ) } failed: ${ result.stderr || result.stdout }`
		);
	}
	return ( result.stdout || result.stderr ).trim();
}

function download( url, dest, redirects = 0 ) {
	if ( redirects > 5 ) {
		return Promise.reject( new Error( `Too many redirects for ${ url }` ) );
	}
	mkdirSync( dirname( dest ), { recursive: true } );
	return new Promise( ( resolveDownload, rejectDownload ) => {
		const request = https.get( url, ( response ) => {
			if (
				response.statusCode &&
				[ 301, 302, 303, 307, 308 ].includes( response.statusCode ) &&
				response.headers.location
			) {
				response.resume();
				download(
					new URL( response.headers.location, url ).toString(),
					dest,
					redirects + 1
				).then( resolveDownload, rejectDownload );
				return;
			}

			if ( ! response.statusCode || response.statusCode >= 400 ) {
				response.resume();
				rejectDownload(
					new Error( `Download failed (${ response.statusCode }) for ${ url }` )
				);
				return;
			}

			const file = createWriteStream( dest );
			response.pipe( file );
			file.on( 'finish', () => file.close( resolveDownload ) );
			file.on( 'error', rejectDownload );
		} );
		request.on( 'error', rejectDownload );
	} );
}

async function ensureDownload( url, dest ) {
	if ( existsSync( dest ) ) {
		console.log( `[runtime] Using cached ${ dest }` );
		return dest;
	}
	console.log( `[runtime] Downloading ${ url }` );
	await download( url, dest );
	return dest;
}

function installExecutable( src, dest, force ) {
	if ( existsSync( dest ) && ! force ) {
		console.log( `[runtime] ${ dest } already exists. Use --force to replace it.` );
		return false;
	}
	mkdirSync( dirname( dest ), { recursive: true } );
	copyFileSync( src, dest );
	chmodSync( dest, 0o755 );
	console.log( `[runtime] Installed ${ dest }` );
	return true;
}

async function installFranken( options ) {
	const dest = resolve( BIN_DIR, 'frankenphp' );
	if ( existsSync( dest ) && ! options.force ) {
		console.log( `[runtime] ${ dest } already exists. Use --force to replace it.` );
		console.log( output( dest, [ 'version' ] ).split( '\n' )[0] );
		return;
	}

	const asset = `frankenphp-${ frankenPlatformName() }`;
	const url = `https://github.com/php/frankenphp/releases/download/${ FRANKENPHP_VERSION }/${ asset }`;
	const cachePath = resolve( CACHE_DIR, asset );

	await ensureDownload( url, cachePath );
	installExecutable( cachePath, dest, options.force );
	console.log( output( dest, [ 'version' ] ).split( '\n' )[0] );
}

async function installCaddy( options ) {
	const dest = resolve( BIN_DIR, 'caddy' );
	if ( existsSync( dest ) && ! options.force ) {
		console.log( `[runtime] ${ dest } already exists. Use --force to replace it.` );
		console.log( output( dest, [ 'version' ] ).split( '\n' )[0] );
		return;
	}

	const asset = `caddy_${ CADDY_VERSION }_${ caddyPlatformName() }.tar.gz`;
	const url = `https://github.com/caddyserver/caddy/releases/download/v${ CADDY_VERSION }/${ asset }`;
	const archive = resolve( CACHE_DIR, asset );
	const extractDir = resolve( CACHE_DIR, `caddy-${ CADDY_VERSION }-${ caddyPlatformName() }` );
	const extracted = resolve( extractDir, 'caddy' );

	await ensureDownload( url, archive );
	if ( ! existsSync( extracted ) || options.force ) {
		rmSync( extractDir, { recursive: true, force: true } );
		mkdirSync( extractDir, { recursive: true } );
		run( 'tar', [ '-xzf', archive, '-C', extractDir ] );
	}
	installExecutable( extracted, dest, options.force );
	console.log( output( dest, [ 'version' ] ).split( '\n' )[0] );
}

function verifyPhp( phpBin ) {
	const modules = output( phpBin, [ '-m' ] )
		.split( '\n' )
		.map( ( module ) => module.trim().toLowerCase() );
	for ( const required of [
		'pdo',
		'pdo_sqlite',
		'sqlite3',
		'mbstring',
		'curl',
		'openssl',
		'zip',
		'gd',
		'xml',
		'dom',
		'simplexml',
		'xmlreader',
		'xmlwriter',
		'phar',
		'session',
		'tokenizer',
		'fileinfo',
		'filter',
		'ctype',
		'iconv',
		'zend opcache',
	] ) {
		if ( ! modules.includes( required ) ) {
			throw new Error( `Bundled PHP is missing required module: ${ required }` );
		}
	}
	console.log( output( phpBin, [ '-v' ] ).split( '\n' )[0] );
}

async function installPhp( options ) {
	const dest = resolve( BIN_DIR, 'php' );
	if ( existsSync( dest ) && ! options.force ) {
		console.log( `[runtime] ${ dest } already exists. Use --force to replace it.` );
		verifyPhp( dest );
		return;
	}

	const spcAsset = `spc-${ platformKey() }.tar.gz`;
	const spcUrl = `https://github.com/crazywhalecc/static-php-cli/releases/download/${ SPC_VERSION }/${ spcAsset }`;
	const spcArchive = resolve( CACHE_DIR, spcAsset );
	const spcDir = resolve( CACHE_DIR, `spc-build-${ SPC_VERSION }` );
	const spcBin = resolve( spcDir, 'spc' );
	const builtPhp = resolve( spcDir, 'buildroot/bin/php' );

	await ensureDownload( spcUrl, spcArchive );
	if ( ! existsSync( spcBin ) ) {
		mkdirSync( spcDir, { recursive: true } );
		run( 'tar', [ '-xzf', spcArchive, '-C', spcDir ] );
		chmodSync( spcBin, 0o755 );
	}

	if ( ! existsSync( builtPhp ) || options.rebuild ) {
		const extensionList = PHP_EXTENSIONS.join( ',' );
		run(
			spcBin,
			[
				'download',
				`--for-extensions=${ extensionList }`,
				`--with-php=${ PHP_VERSION }`,
				'--prefer-pre-built',
				'--retry=2',
			],
			{ cwd: spcDir }
		);
		run( spcBin, [ 'switch-php-version', PHP_VERSION ], { cwd: spcDir } );
		run(
			spcBin,
			[
				'build',
				extensionList,
				'--build-cli',
				'--disable-opcache-jit',
				'-I',
				'opcache.enable_cli=1',
				'-I',
				'opcache.validate_timestamps=0',
			],
			{ cwd: spcDir }
		);
	}

	installExecutable( builtPhp, dest, true );
	verifyPhp( dest );
}

async function main() {
	const options = readOptions();
	if ( options.runtime === 'php' ) {
		await installPhp( options );
	} else if ( options.runtime === 'franken' ) {
		await installFranken( options );
	} else if ( options.runtime === 'caddy' ) {
		await installCaddy( options );
	} else {
		throw new Error(
			`Unknown runtime "${ options.runtime }". Expected php, franken, or caddy.`
		);
	}
}

main().catch( ( err ) => {
	console.error( `[runtime] ${ err.message }` );
	process.exitCode = 1;
} );
