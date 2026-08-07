import { constants as fsConstants } from 'node:fs';
import { access, lstat, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import electronFuses from '@electron/fuses';

const { FuseV1Options, FuseVersion, getCurrentFuseWire } = electronFuses;

const ENABLED_FUSE_STATE = '1'.charCodeAt( 0 );
const DISABLED_FUSE_STATE = '0'.charCodeAt( 0 );

export const EXPECTED_FUSES = Object.freeze( [
	{
		index: FuseV1Options.RunAsNode,
		name: 'RunAsNode',
		enabled: false,
	},
	{
		index: FuseV1Options.EnableCookieEncryption,
		name: 'EnableCookieEncryption',
		enabled: false,
	},
	{
		index: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
		name: 'EnableNodeOptionsEnvironmentVariable',
		enabled: false,
	},
	{
		index: FuseV1Options.EnableNodeCliInspectArguments,
		name: 'EnableNodeCliInspectArguments',
		enabled: false,
	},
	{
		index: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
		name: 'EnableEmbeddedAsarIntegrityValidation',
		enabled: true,
	},
	{
		index: FuseV1Options.OnlyLoadAppFromAsar,
		name: 'OnlyLoadAppFromAsar',
		enabled: true,
	},
	{
		index: FuseV1Options.LoadBrowserProcessSpecificV8Snapshot,
		name: 'LoadBrowserProcessSpecificV8Snapshot',
		enabled: false,
	},
	{
		index: FuseV1Options.GrantFileProtocolExtraPrivileges,
		name: 'GrantFileProtocolExtraPrivileges',
		enabled: false,
	},
] );

export const REQUIRED_RESOURCES = Object.freeze( [
	'snapshot.zip',
	'runtime/bin/php',
	'runtime/router.php',
	'runtime/bootstrap.php',
	'runtime/mu-plugins/cortext-update-lock.php',
] );

async function requireDirectory( directoryPath, label ) {
	let details;
	try {
		details = await stat( directoryPath );
	} catch ( error ) {
		if ( error.code === 'ENOENT' ) {
			throw new Error( `${ label } is missing: ${ directoryPath }` );
		}
		throw error;
	}

	if ( ! details.isDirectory() ) {
		throw new Error( `${ label } is not a directory: ${ directoryPath }` );
	}
}

async function requireFile( filePath, label ) {
	let details;
	try {
		details = await stat( filePath );
	} catch ( error ) {
		if ( error.code === 'ENOENT' ) {
			throw new Error( `${ label } is missing: ${ filePath }` );
		}
		throw error;
	}

	if ( ! details.isFile() ) {
		throw new Error( `${ label } is not a file: ${ filePath }` );
	}
}

async function requireAbsent( candidatePath, label ) {
	try {
		await lstat( candidatePath );
	} catch ( error ) {
		if ( error.code === 'ENOENT' ) {
			return;
		}
		throw error;
	}

	throw new Error( `${ label } must not exist: ${ candidatePath }` );
}

export function inspectMachOArchitectures(
	executablePath,
	runCommand = spawnSync
) {
	const result = runCommand( '/usr/bin/lipo', [ '-archs', executablePath ], {
		encoding: 'utf8',
	} );

	if ( result.error ) {
		throw new Error(
			`Could not inspect ${ executablePath }: ${ result.error.message }`
		);
	}
	if ( result.status !== 0 ) {
		throw new Error(
			`Could not inspect ${ executablePath } with lipo: ${ (
				result.stderr || ''
			).trim() }`
		);
	}

	const architectures = result.stdout.trim().split( /\s+/ ).filter( Boolean );
	if ( architectures.length === 0 ) {
		throw new Error(
			`lipo returned no architectures for ${ executablePath }`
		);
	}

	return architectures;
}

export async function verifyFuseStates(
	appPath,
	readFuseWire = getCurrentFuseWire
) {
	const wire = await readFuseWire( appPath );
	if ( wire.version !== FuseVersion.V1 ) {
		throw new Error(
			`Unsupported Electron fuse wire version: ${ wire.version }`
		);
	}

	for ( const expected of EXPECTED_FUSES ) {
		const expectedState = expected.enabled
			? ENABLED_FUSE_STATE
			: DISABLED_FUSE_STATE;
		const actualState = wire[ expected.index ];

		if ( actualState !== expectedState ) {
			throw new Error(
				`Electron fuse ${ expected.name } must be ${
					expected.enabled ? 'enabled' : 'disabled'
				}; found state ${ actualState ?? 'missing' }`
			);
		}
	}

	return Object.keys( wire ).filter( ( key ) => /^\d+$/.test( key ) ).length;
}

export async function verifyPackagedApp(
	appPath,
	{
		platform = process.platform,
		readFuseWire = getCurrentFuseWire,
		readArchitectures = inspectMachOArchitectures,
	} = {}
) {
	const resolvedAppPath = path.resolve( appPath );
	if ( path.extname( resolvedAppPath ) !== '.app' ) {
		throw new Error( `Expected a macOS .app bundle: ${ resolvedAppPath }` );
	}

	await requireDirectory( resolvedAppPath, 'Application bundle' );

	const resourcesPath = path.join( resolvedAppPath, 'Contents', 'Resources' );
	await requireDirectory( resourcesPath, 'Resources directory' );

	const appAsarPath = path.join( resourcesPath, 'app.asar' );
	await requireFile( appAsarPath, 'app.asar' );
	await requireAbsent(
		path.join( resourcesPath, 'app' ),
		'unpacked app directory'
	);
	await requireAbsent(
		path.join( resourcesPath, 'app.asar.unpacked' ),
		'app.asar.unpacked'
	);
	await requireAbsent(
		path.join( resourcesPath, 'default_app.asar' ),
		'default_app.asar'
	);

	for ( const relativePath of REQUIRED_RESOURCES ) {
		await requireFile(
			path.join( resourcesPath, relativePath ),
			`Required resource ${ relativePath }`
		);
	}

	const phpPath = path.join( resourcesPath, 'runtime', 'bin', 'php' );
	try {
		await access( phpPath, fsConstants.X_OK );
	} catch {
		throw new Error( `Bundled PHP is not executable: ${ phpPath }` );
	}

	let phpArchitectures = [];
	if ( platform === 'darwin' ) {
		phpArchitectures = await readArchitectures( phpPath );
		if (
			phpArchitectures.length !== 1 ||
			phpArchitectures[ 0 ] !== 'arm64'
		) {
			throw new Error(
				`Bundled PHP must contain only arm64; found: ${ phpArchitectures.join(
					', '
				) }`
			);
		}
	}

	const fuseCount = await verifyFuseStates( resolvedAppPath, readFuseWire );

	return {
		appPath: resolvedAppPath,
		fuseCount,
		phpArchitectures,
		resources: REQUIRED_RESOURCES.map( ( relativePath ) =>
			path.join( resourcesPath, relativePath )
		),
	};
}

export function parseArguments( args ) {
	let appPath;
	let help = false;

	for ( let index = 0; index < args.length; index += 1 ) {
		const argument = args[ index ];
		if ( argument === '--help' || argument === '-h' ) {
			help = true;
			continue;
		}

		if ( argument === '--app' ) {
			if ( appPath !== undefined ) {
				throw new Error( '--app may only be provided once' );
			}
			appPath = args[ index + 1 ];
			if ( ! appPath || appPath.startsWith( '--' ) ) {
				throw new Error( '--app requires a path to a .app bundle' );
			}
			index += 1;
			continue;
		}

		if ( argument.startsWith( '--app=' ) ) {
			if ( appPath !== undefined ) {
				throw new Error( '--app may only be provided once' );
			}
			appPath = argument.slice( '--app='.length );
			if ( ! appPath ) {
				throw new Error( '--app requires a path to a .app bundle' );
			}
			continue;
		}

		throw new Error( `Unknown argument: ${ argument }` );
	}

	if ( ! help && ! appPath ) {
		throw new Error( '--app requires a path to a .app bundle' );
	}

	return { appPath, help };
}

function usage() {
	return 'Usage: npm run verify:app -- --app <path-to-Cortext.app>';
}

async function main() {
	const { appPath, help } = parseArguments( process.argv.slice( 2 ) );
	if ( help ) {
		console.log( usage() );
		return;
	}

	const result = await verifyPackagedApp( appPath );
	console.log( `Verified: ${ result.appPath }` );
	console.log(
		`Fuses: ${ EXPECTED_FUSES.length } required, ${ result.fuseCount } present`
	);
	console.log( `Resources: ${ result.resources.length } required, all present` );
	if ( result.phpArchitectures.length > 0 ) {
		console.log(
			`PHP architecture: ${ result.phpArchitectures.join( ', ' ) }`
		);
	}
}

const invokedPath = process.argv[ 1 ] && path.resolve( process.argv[ 1 ] );
if ( invokedPath === fileURLToPath( import.meta.url ) ) {
	main().catch( ( error ) => {
		console.error( `Packaged app verification failed: ${ error.message }` );
		process.exitCode = 1;
	} );
}
