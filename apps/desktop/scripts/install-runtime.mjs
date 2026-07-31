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

export const PHP_VERSION = process.env.CORTEXT_STATIC_PHP_VERSION || '8.5';
export const SPC_VERSION = process.env.CORTEXT_SPC_VERSION || '2.8.5';
const FRANKENPHP_VERSION = process.env.CORTEXT_FRANKENPHP_VERSION || 'v1.12.2';
const CADDY_VERSION = process.env.CORTEXT_CADDY_VERSION || '2.11.3';

function isEnabled( value ) {
	return [ '1', 'true', 'yes', 'on' ].includes(
		String( value || '' ).toLowerCase()
	);
}

const PHP_EXPERIMENTAL = isEnabled(
	process.env.CORTEXT_STATIC_PHP_EXPERIMENTAL
);
const PHP_WITH_APCU =
	PHP_EXPERIMENTAL || isEnabled( process.env.CORTEXT_STATIC_PHP_APCU );
const PHP_WITH_JIT =
	PHP_EXPERIMENTAL || isEnabled( process.env.CORTEXT_STATIC_PHP_JIT );

export const BASE_PHP_EXTENSIONS = [
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

export function phpExtensions( withApcu = PHP_WITH_APCU ) {
	const extensions = [ ...BASE_PHP_EXTENSIONS ];
	if ( withApcu ) {
		extensions.push( 'apcu' );
	}
	return extensions;
}

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

export function phpRuntimeDescriptor(
	platform = process.platform,
	arch = process.arch
) {
	if ( platform === 'darwin' ) {
		if ( arch === 'arm64' ) {
			return {
				key: 'macos-aarch64',
				spcAsset: 'spc-macos-aarch64.tar.gz',
				spcExecutable: 'spc',
				builtPhp: 'buildroot/bin/php',
				runtimePhp: 'php',
				spcPackageRoot: 'aarch64-darwin',
				archive: true,
			};
		}
		if ( arch === 'x64' ) {
			return {
				key: 'macos-x86_64',
				spcAsset: 'spc-macos-x86_64.tar.gz',
				spcExecutable: 'spc',
				builtPhp: 'buildroot/bin/php',
				runtimePhp: 'php',
				spcPackageRoot: 'x86_64-darwin',
				archive: true,
			};
		}
		throw new Error( `Unsupported macOS architecture: ${ arch }.` );
	}

	if ( platform === 'win32' ) {
		if ( arch === 'x64' ) {
			return {
				key: 'windows-x64',
				spcAsset: 'spc-windows-x64.exe',
				spcExecutable: 'spc.exe',
				builtPhp: 'buildroot/bin/php.exe',
				runtimePhp: 'php.exe',
				spcPackageRoot: null,
				archive: false,
			};
		}
		throw new Error( `Unsupported Windows architecture: ${ arch }.` );
	}

	throw new Error(
		`Bundled PHP only supports macOS and Windows, not ${ platform }.`
	);
}

function macPlatformKey( platform = process.platform, arch = process.arch ) {
	if ( platform !== 'darwin' ) {
		throw new Error(
			`This runtime only supports macOS, not ${ platform }.`
		);
	}
	return phpRuntimeDescriptor( platform, arch ).key;
}

export function frankenPlatformName(
	platform = process.platform,
	arch = process.arch
) {
	return macPlatformKey( platform, arch ) === 'macos-aarch64'
		? 'mac-arm64'
		: 'mac-x86_64';
}

export function caddyPlatformName(
	platform = process.platform,
	arch = process.arch
) {
	return macPlatformKey( platform, arch ) === 'macos-aarch64'
		? 'mac_arm64'
		: 'mac_amd64';
}

export function run( command, args, options = {}, spawn = spawnSync ) {
	const result = spawn( command, args, {
		stdio: 'inherit',
		...options,
	} );
	if ( result.error ) {
		throw result.error;
	}
	if ( result.status !== 0 ) {
		throw new Error(
			`${ command } ${ args.join( ' ' ) } failed with exit code ${
				result.status
			}`
		);
	}
}

export function output( command, args, spawn = spawnSync ) {
	const result = spawn( command, args, {
		encoding: 'utf8',
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	if ( result.error ) {
		throw result.error;
	}
	if ( result.status !== 0 ) {
		throw new Error(
			`${ command } ${ args.join( ' ' ) } failed: ${
				result.stderr || result.stdout
			}`
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
					new Error(
						`Download failed (${ response.statusCode }) for ${ url }`
					)
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

function installExecutable(
	src,
	dest,
	force,
	{ makeExecutable = true, dependencies = {} } = {}
) {
	const {
		exists = existsSync,
		mkdir = mkdirSync,
		copyFile = copyFileSync,
		chmod = chmodSync,
		log = console.log,
	} = dependencies;

	if ( exists( dest ) && ! force ) {
		log( `[runtime] ${ dest } already exists. Use --force to replace it.` );
		return false;
	}
	mkdir( dirname( dest ), { recursive: true } );
	copyFile( src, dest );
	if ( makeExecutable ) {
		chmod( dest, 0o755 );
	}
	log( `[runtime] Installed ${ dest }` );
	return true;
}

async function installFranken( options ) {
	const platformName = frankenPlatformName();
	const dest = resolve( BIN_DIR, 'frankenphp' );
	if ( existsSync( dest ) && ! options.force ) {
		console.log(
			`[runtime] ${ dest } already exists. Use --force to replace it.`
		);
		console.log( output( dest, [ 'version' ] ).split( '\n' )[ 0 ] );
		return;
	}

	const asset = `frankenphp-${ platformName }`;
	const url = `https://github.com/php/frankenphp/releases/download/${ FRANKENPHP_VERSION }/${ asset }`;
	const cachePath = resolve( CACHE_DIR, asset );

	await ensureDownload( url, cachePath );
	installExecutable( cachePath, dest, options.force );
	console.log( output( dest, [ 'version' ] ).split( '\n' )[ 0 ] );
}

async function installCaddy( options ) {
	const platformName = caddyPlatformName();
	const dest = resolve( BIN_DIR, 'caddy' );
	if ( existsSync( dest ) && ! options.force ) {
		console.log(
			`[runtime] ${ dest } already exists. Use --force to replace it.`
		);
		console.log( output( dest, [ 'version' ] ).split( '\n' )[ 0 ] );
		return;
	}

	const asset = `caddy_${ CADDY_VERSION }_${ platformName }.tar.gz`;
	const url = `https://github.com/caddyserver/caddy/releases/download/v${ CADDY_VERSION }/${ asset }`;
	const archive = resolve( CACHE_DIR, asset );
	const extractDir = resolve(
		CACHE_DIR,
		`caddy-${ CADDY_VERSION }-${ platformName }`
	);
	const extracted = resolve( extractDir, 'caddy' );

	await ensureDownload( url, archive );
	if ( ! existsSync( extracted ) || options.force ) {
		rmSync( extractDir, { recursive: true, force: true } );
		mkdirSync( extractDir, { recursive: true } );
		run( 'tar', [ '-xzf', archive, '-C', extractDir ] );
	}
	installExecutable( extracted, dest, options.force );
	console.log( output( dest, [ 'version' ] ).split( '\n' )[ 0 ] );
}

export function requiredPhpModules( extensions = phpExtensions() ) {
	return extensions.map( ( extension ) =>
		extension === 'opcache' ? 'zend opcache' : extension.toLowerCase()
	);
}

function phpMajorMinor( version ) {
	const match = String( version ).match( /^(\d+)\.(\d+)/ );
	if ( ! match ) {
		throw new Error( `Invalid PHP version: ${ version }` );
	}
	return `${ match[ 1 ] }.${ match[ 2 ] }`;
}

export function verifyPhp(
	phpBin,
	{
		phpVersion = PHP_VERSION,
		extensions = phpExtensions(),
		withJit = PHP_WITH_JIT,
		getOutput = output,
		log = console.log,
	} = {}
) {
	const expectedVersion = phpMajorMinor( phpVersion );
	const actualVersion = getOutput( phpBin, [
		'-r',
		"echo PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;",
	] );
	if ( actualVersion !== expectedVersion ) {
		throw new Error(
			`Bundled PHP is ${ actualVersion }, but this build needs PHP ${ expectedVersion }.`
		);
	}

	const modules = getOutput( phpBin, [ '-m' ] )
		.split( '\n' )
		.map( ( module ) => module.trim().toLowerCase() );

	for ( const required of requiredPhpModules( extensions ) ) {
		if ( ! modules.includes( required ) ) {
			throw new Error(
				`Bundled PHP is missing the ${ required } module.`
			);
		}
	}

	if ( withJit ) {
		const jit = getOutput( phpBin, [
			'-d',
			'opcache.enable_cli=1',
			'-d',
			'opcache.jit_buffer_size=16M',
			'-d',
			'opcache.jit=tracing',
			'-r',
			"echo json_encode(opcache_get_status(false)['jit'] ?? null);",
		] );
		const parsed = JSON.parse( jit || 'null' );
		if ( ! parsed || parsed.enabled !== true ) {
			throw new Error(
				'OPcache JIT is not enabled in the bundled PHP runtime.'
			);
		}
	}

	log( getOutput( phpBin, [ '-v' ] ).split( '\n' )[ 0 ] );
}

export async function installPhp(
	options,
	{
		platform = process.platform,
		arch = process.arch,
		phpVersion = PHP_VERSION,
		spcVersion = SPC_VERSION,
		withApcu = PHP_WITH_APCU,
		withJit = PHP_WITH_JIT,
		binDir = BIN_DIR,
		cacheDir = CACHE_DIR,
		dependencies = {},
	} = {}
) {
	const descriptor = phpRuntimeDescriptor( platform, arch );
	const deps = {
		exists: existsSync,
		mkdir: mkdirSync,
		copyFile: copyFileSync,
		chmod: chmodSync,
		ensureDownload,
		run,
		output,
		log: console.log,
		...dependencies,
	};
	const extensions = phpExtensions( withApcu );
	const dest = resolve( binDir, descriptor.runtimePhp );

	if ( deps.exists( dest ) && ! options.force ) {
		deps.log(
			`[runtime] ${ dest } already exists. Use --force to replace it.`
		);
		verifyPhp( dest, {
			phpVersion,
			extensions,
			withJit,
			getOutput: deps.output,
			log: deps.log,
		} );
		return;
	}

	const spcUrl = `https://github.com/crazywhalecc/static-php-cli/releases/download/${ spcVersion }/${ descriptor.spcAsset }`;
	const spcDownload = resolve( cacheDir, descriptor.spcAsset );
	const spcDir = resolve( cacheDir, `spc-build-${ spcVersion }` );
	const spcBin = resolve( spcDir, descriptor.spcExecutable );
	const builtPhp = resolve( spcDir, descriptor.builtPhp );

	await deps.ensureDownload( spcUrl, spcDownload );
	if ( ! deps.exists( spcBin ) ) {
		deps.mkdir( spcDir, { recursive: true } );
		if ( descriptor.archive ) {
			deps.run( 'tar', [ '-xzf', spcDownload, '-C', spcDir ] );
			deps.chmod( spcBin, 0o755 );
		} else {
			deps.copyFile( spcDownload, spcBin );
		}
	}

	if ( ! deps.exists( builtPhp ) || options.rebuild ) {
		if ( descriptor.archive ) {
			const pkgConfig = resolve(
				spcDir,
				'pkgroot',
				descriptor.spcPackageRoot,
				'bin/pkg-config'
			);
			if ( ! deps.exists( pkgConfig ) ) {
				deps.run( spcBin, [ 'install-pkg', 'pkg-config' ], {
					cwd: spcDir,
				} );
			}
		} else {
			deps.run( spcBin, [ 'doctor', '--auto-fix' ], { cwd: spcDir } );
		}

		const extensionList = extensions.join( ',' );
		const buildArgs = [ 'build', extensionList, '--build-cli' ];

		if ( ! withJit ) {
			buildArgs.push( '--disable-opcache-jit' );
		}

		buildArgs.push(
			'-I',
			'opcache.enable_cli=1',
			'-I',
			'opcache.validate_timestamps=0',
			'-I',
			'pcre.jit=1'
		);

		deps.run(
			spcBin,
			[
				'download',
				`--for-extensions=${ extensionList }`,
				`--with-php=${ phpVersion }`,
				'--prefer-pre-built',
				'--retry=2',
			],
			{ cwd: spcDir }
		);
		deps.run( spcBin, [ 'switch-php-version', phpVersion ], {
			cwd: spcDir,
		} );
		deps.run( spcBin, buildArgs, { cwd: spcDir } );
	}

	installExecutable( builtPhp, dest, true, {
		makeExecutable: descriptor.archive,
		dependencies: deps,
	} );
	verifyPhp( dest, {
		phpVersion,
		extensions,
		withJit,
		getOutput: deps.output,
		log: deps.log,
	} );
}

export async function main() {
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

if (
	process.argv[ 1 ] &&
	resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url )
) {
	main().catch( ( err ) => {
		console.error( `[runtime] ${ err.message }` );
		process.exitCode = 1;
	} );
}
