import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	BASE_PHP_EXTENSIONS,
	caddyPlatformName,
	frankenPlatformName,
	installPhp,
	output,
	phpExtensions,
	phpRuntimeDescriptor,
	requiredPhpModules,
	run,
	verifyPhp,
} from './install-runtime.mjs';

function phpOutput( { version = '8.5', extensions = phpExtensions() } = {} ) {
	const modules = requiredPhpModules( extensions ).join( '\n' );

	return ( command, args ) => {
		assert.match( command, /php(?:\.exe)?$/ );
		if ( args[ 0 ] === '-r' && args[ 1 ].includes( 'PHP_MAJOR_VERSION' ) ) {
			return version;
		}
		if ( args[ 0 ] === '-m' ) {
			return modules;
		}
		if ( args[ 0 ] === '-v' ) {
			return `PHP ${ version }.0`;
		}
		if (
			args.some( ( argument ) =>
				argument.includes( 'opcache_get_status' )
			)
		) {
			return JSON.stringify( { enabled: true } );
		}
		throw new Error( `Unexpected PHP arguments: ${ args.join( ' ' ) }` );
	};
}

function fakeDependencies( { files = [], getOutput = phpOutput() } = {} ) {
	const existing = new Set( files );
	const calls = {
		chmod: [],
		copyFile: [],
		downloads: [],
		logs: [],
		mkdir: [],
		output: [],
		run: [],
	};

	return {
		calls,
		dependencies: {
			exists: ( path ) => existing.has( path ),
			mkdir: ( path, options ) => calls.mkdir.push( { path, options } ),
			copyFile: ( source, destination ) => {
				calls.copyFile.push( { source, destination } );
				existing.add( destination );
			},
			chmod: ( path, mode ) => calls.chmod.push( { path, mode } ),
			ensureDownload: async ( url, destination ) => {
				calls.downloads.push( { url, destination } );
				existing.add( destination );
				return destination;
			},
			run: ( command, args, options ) =>
				calls.run.push( { command, args, options } ),
			output: ( command, args ) => {
				calls.output.push( { command, args } );
				return getOutput( command, args );
			},
			log: ( message ) => calls.logs.push( message ),
		},
	};
}

test( 'PHP runtime descriptors preserve macOS artifacts and paths', () => {
	assert.deepEqual( phpRuntimeDescriptor( 'darwin', 'arm64' ), {
		key: 'macos-aarch64',
		spcAsset: 'spc-macos-aarch64.tar.gz',
		spcExecutable: 'spc',
		builtPhp: 'buildroot/bin/php',
		runtimePhp: 'php',
		spcPackageRoot: 'aarch64-darwin',
		archive: true,
	} );
	assert.deepEqual( phpRuntimeDescriptor( 'darwin', 'x64' ), {
		key: 'macos-x86_64',
		spcAsset: 'spc-macos-x86_64.tar.gz',
		spcExecutable: 'spc',
		builtPhp: 'buildroot/bin/php',
		runtimePhp: 'php',
		spcPackageRoot: 'x86_64-darwin',
		archive: true,
	} );
} );

test( 'the Windows descriptor uses native executable names', () => {
	assert.deepEqual( phpRuntimeDescriptor( 'win32', 'x64' ), {
		key: 'windows-x64',
		spcAsset: 'spc-windows-x64.exe',
		spcExecutable: 'spc.exe',
		builtPhp: 'buildroot/bin/php.exe',
		runtimePhp: 'php.exe',
		spcPackageRoot: null,
		archive: false,
	} );
} );

test( 'unsupported platforms and Windows architectures fail early', () => {
	assert.throws(
		() => phpRuntimeDescriptor( 'win32', 'arm64' ),
		/Unsupported Windows architecture: arm64/
	);
	assert.throws(
		() => phpRuntimeDescriptor( 'linux', 'x64' ),
		/only supported on macOS and Windows/
	);
} );

test( 'FrankenPHP and Caddy remain macOS-only', () => {
	assert.equal( frankenPlatformName( 'darwin', 'arm64' ), 'mac-arm64' );
	assert.equal( caddyPlatformName( 'darwin', 'x64' ), 'mac_amd64' );
	assert.throws(
		() => frankenPlatformName( 'win32', 'x64' ),
		/only available on macOS/
	);
	assert.throws(
		() => caddyPlatformName( 'win32', 'x64' ),
		/only available on macOS/
	);
} );

test( 'run and output preserve spawn errors', () => {
	const spawnError = Object.assign( new Error( 'spawn missing ENOENT' ), {
		code: 'ENOENT',
	} );
	const spawn = () => ( { error: spawnError, status: null } );

	assert.throws(
		() => run( 'missing', [], {}, spawn ),
		( error ) => {
			assert.equal( error, spawnError );
			return true;
		}
	);
	assert.throws(
		() => output( 'missing', [], spawn ),
		( error ) => {
			assert.equal( error, spawnError );
			return true;
		}
	);
} );

test( 'required modules stay in sync with compiled extensions', () => {
	const extensions = phpExtensions( true );
	const modules = requiredPhpModules( extensions );

	assert.equal( extensions.length, BASE_PHP_EXTENSIONS.length + 1 );
	assert.equal( modules.length, extensions.length );
	assert.equal( modules[ extensions.indexOf( 'opcache' ) ], 'zend opcache' );
	assert.ok( modules.includes( 'zlib' ) );
	assert.ok( modules.includes( 'bcmath' ) );
	assert.ok( modules.includes( 'bz2' ) );
	assert.ok( modules.includes( 'calendar' ) );
	assert.ok( modules.includes( 'exif' ) );
	assert.ok( modules.includes( 'apcu' ) );
} );

test( 'PHP verification checks the requested major and minor version', () => {
	assert.throws(
		() =>
			verifyPhp( '/runtime/php', {
				phpVersion: '8.5.4',
				getOutput: phpOutput( { version: '8.4' } ),
				log: () => {},
			} ),
		/Bundled PHP 8\.4 does not match requested PHP 8\.5/
	);
} );

test( 'PHP verification checks every compiled module', () => {
	const extensions = phpExtensions( true );
	const withoutBcmath = extensions.filter(
		( extension ) => extension !== 'bcmath'
	);

	assert.throws(
		() =>
			verifyPhp( '/runtime/php', {
				extensions,
				getOutput: phpOutput( { extensions: withoutBcmath } ),
				log: () => {},
			} ),
		/missing required module: bcmath/
	);
	assert.doesNotThrow( () =>
		verifyPhp( '/runtime/php', {
			extensions,
			withJit: true,
			getOutput: phpOutput( { extensions } ),
			log: () => {},
		} )
	);
} );

test( 'Windows installs SPC directly and compiles PHP without Unix tools', async () => {
	const root = resolve( 'test-runtime-windows' );
	const binDir = resolve( root, 'runtime/bin' );
	const cacheDir = resolve( root, '.runtime-cache' );
	const spcDir = resolve( cacheDir, 'spc-build-2.8.5' );
	const spcDownload = resolve( cacheDir, 'spc-windows-x64.exe' );
	const spcBin = resolve( spcDir, 'spc.exe' );
	const builtPhp = resolve( spcDir, 'buildroot/bin/php.exe' );
	const dest = resolve( binDir, 'php.exe' );
	const { calls, dependencies } = fakeDependencies();

	await installPhp(
		{ force: false, rebuild: false },
		{
			platform: 'win32',
			arch: 'x64',
			binDir,
			cacheDir,
			dependencies,
		}
	);

	assert.deepEqual( calls.downloads, [
		{
			url: 'https://github.com/crazywhalecc/static-php-cli/releases/download/2.8.5/spc-windows-x64.exe',
			destination: spcDownload,
		},
	] );
	assert.deepEqual( calls.copyFile, [
		{ source: spcDownload, destination: spcBin },
		{ source: builtPhp, destination: dest },
	] );
	assert.deepEqual( calls.chmod, [] );
	assert.deepEqual(
		calls.run.map( ( call ) => [ call.command, ...call.args ] ),
		[
			[ spcBin, 'doctor', '--auto-fix' ],
			[
				spcBin,
				'download',
				`--for-extensions=${ phpExtensions().join( ',' ) }`,
				'--with-php=8.5',
				'--prefer-pre-built',
				'--retry=2',
			],
			[ spcBin, 'switch-php-version', '8.5' ],
			[
				spcBin,
				'build',
				phpExtensions().join( ',' ),
				'--build-cli',
				'--disable-opcache-jit',
				'-I',
				'opcache.enable_cli=1',
				'-I',
				'opcache.validate_timestamps=0',
				'-I',
				'pcre.jit=1',
			],
		]
	);
	assert.ok( calls.run.every( ( call ) => call.options.cwd === spcDir ) );
	assert.equal(
		calls.run.some(
			( call ) =>
				call.command === 'tar' || call.args[ 0 ] === 'install-pkg'
		),
		false
	);
	assert.equal( calls.output[ 0 ].command, dest );
} );

test( 'Windows only runs doctor when it needs to compile PHP', async () => {
	const root = resolve( 'test-runtime-windows-built' );
	const binDir = resolve( root, 'runtime/bin' );
	const cacheDir = resolve( root, '.runtime-cache' );
	const spcDir = resolve( cacheDir, 'spc-build-2.8.5' );
	const spcBin = resolve( spcDir, 'spc.exe' );
	const builtPhp = resolve( spcDir, 'buildroot/bin/php.exe' );
	const dest = resolve( binDir, 'php.exe' );
	const { calls, dependencies } = fakeDependencies( {
		files: [ spcBin, builtPhp ],
	} );

	await installPhp(
		{ force: false, rebuild: false },
		{
			platform: 'win32',
			arch: 'x64',
			binDir,
			cacheDir,
			dependencies,
		}
	);

	assert.deepEqual( calls.run, [] );
	assert.deepEqual( calls.copyFile, [
		{ source: builtPhp, destination: dest },
	] );
} );

test( 'a cached Windows PHP binary is always verified', async () => {
	const root = resolve( 'test-runtime-windows-cached' );
	const binDir = resolve( root, 'runtime/bin' );
	const cacheDir = resolve( root, '.runtime-cache' );
	const dest = resolve( binDir, 'php.exe' );
	const { calls, dependencies } = fakeDependencies( { files: [ dest ] } );

	await installPhp(
		{ force: false, rebuild: false },
		{
			platform: 'win32',
			arch: 'x64',
			binDir,
			cacheDir,
			dependencies,
		}
	);

	assert.deepEqual( calls.downloads, [] );
	assert.deepEqual( calls.copyFile, [] );
	assert.deepEqual( calls.run, [] );
	assert.deepEqual(
		calls.output.map( ( call ) => call.args[ 0 ] ),
		[ '-r', '-m', '-v' ]
	);
} );

test( 'macOS keeps tar extraction, pkg-config and executable modes', async () => {
	const root = resolve( 'test-runtime-macos' );
	const binDir = resolve( root, 'runtime/bin' );
	const cacheDir = resolve( root, '.runtime-cache' );
	const spcDir = resolve( cacheDir, 'spc-build-2.8.5' );
	const spcDownload = resolve( cacheDir, 'spc-macos-aarch64.tar.gz' );
	const spcBin = resolve( spcDir, 'spc' );
	const dest = resolve( binDir, 'php' );
	const { calls, dependencies } = fakeDependencies();

	await installPhp(
		{ force: false, rebuild: false },
		{
			platform: 'darwin',
			arch: 'arm64',
			binDir,
			cacheDir,
			dependencies,
		}
	);

	assert.deepEqual( calls.downloads[ 0 ], {
		url: 'https://github.com/crazywhalecc/static-php-cli/releases/download/2.8.5/spc-macos-aarch64.tar.gz',
		destination: spcDownload,
	} );
	assert.deepEqual( calls.run[ 0 ], {
		command: 'tar',
		args: [ '-xzf', spcDownload, '-C', spcDir ],
		options: undefined,
	} );
	assert.equal(
		calls.run.some( ( call ) => call.args[ 0 ] === 'install-pkg' ),
		true
	);
	assert.equal(
		calls.run.some( ( call ) => call.args[ 0 ] === 'doctor' ),
		false
	);
	assert.deepEqual( calls.chmod, [
		{ path: spcBin, mode: 0o755 },
		{ path: dest, mode: 0o755 },
	] );
} );
