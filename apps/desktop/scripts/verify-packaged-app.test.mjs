import assert from 'node:assert/strict';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	EXPECTED_FUSES,
	REQUIRED_RESOURCES,
	inspectMachOArchitectures,
	parseArguments,
	verifyPackagedApp,
} from './verify-packaged-app.mjs';

const FUSE_SENTINEL = Buffer.from(
	'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX',
	'ascii'
);
const ENABLED_FUSE_STATE = '1'.charCodeAt( 0 );
const DISABLED_FUSE_STATE = '0'.charCodeAt( 0 );

function configuredFuseStates() {
	return EXPECTED_FUSES.map( ( fuse ) =>
		fuse.enabled ? ENABLED_FUSE_STATE : DISABLED_FUSE_STATE
	);
}

async function createFixture( t, fuseStates = configuredFuseStates() ) {
	const tempPath = await mkdtemp(
		path.join( os.tmpdir(), 'cortext-packaged-app-' )
	);
	t.after( () => rm( tempPath, { recursive: true, force: true } ) );

	const appPath = path.join( tempPath, 'Cortext.app' );
	const resourcesPath = path.join( appPath, 'Contents', 'Resources' );
	const frameworkPath = path.join(
		appPath,
		'Contents',
		'Frameworks',
		'Electron Framework.framework'
	);

	await mkdir( resourcesPath, { recursive: true } );
	await mkdir( frameworkPath, { recursive: true } );
	await writeFile( path.join( resourcesPath, 'app.asar' ), 'archive' );

	for ( const relativePath of REQUIRED_RESOURCES ) {
		const resourcePath = path.join( resourcesPath, relativePath );
		await mkdir( path.dirname( resourcePath ), { recursive: true } );
		await writeFile( resourcePath, relativePath );
	}

	const phpPath = path.join( resourcesPath, 'runtime', 'bin', 'php' );
	await chmod( phpPath, 0o755 );

	await writeFile(
		path.join( frameworkPath, 'Electron Framework' ),
		Buffer.concat( [
			Buffer.from( 'electron-fixture', 'ascii' ),
			FUSE_SENTINEL,
			Buffer.from( [ 1, fuseStates.length, ...fuseStates ] ),
		] )
	);

	return { appPath, phpPath, resourcesPath };
}

test( 'package.json sets every required fuse', async () => {
	const packageConfig = JSON.parse(
		await readFile( new URL( '../package.json', import.meta.url ), 'utf8' )
	);

	assert.equal( packageConfig.devDependencies[ '@electron/fuses' ], '1.8.0' );
	assert.equal( packageConfig.build.asar, true );
	assert.deepEqual( packageConfig.build.electronFuses, {
		runAsNode: false,
		enableCookieEncryption: false,
		enableNodeOptionsEnvironmentVariable: false,
		enableNodeCliInspectArguments: false,
		enableEmbeddedAsarIntegrityValidation: true,
		onlyLoadAppFromAsar: true,
		loadBrowserProcessSpecificV8Snapshot: false,
		grantFileProtocolExtraPrivileges: false,
	} );
} );

test( 'verifier accepts an arm64 bundle with the required files and fuses', async ( t ) => {
	const fuseStates = [ ...configuredFuseStates(), ENABLED_FUSE_STATE ];
	const { appPath } = await createFixture( t, fuseStates );

	const result = await verifyPackagedApp( appPath, {
		platform: 'darwin',
		readArchitectures: () => [ 'arm64' ],
	} );

	assert.equal( result.appPath, appPath );
	assert.equal( result.fuseCount, fuseStates.length );
	assert.deepEqual( result.phpArchitectures, [ 'arm64' ] );
	assert.equal( result.resources.length, REQUIRED_RESOURCES.length );
} );

test( 'verifier rejects a changed required fuse', async ( t ) => {
	const fuseStates = configuredFuseStates();
	fuseStates[ 0 ] = ENABLED_FUSE_STATE;
	const { appPath } = await createFixture( t, fuseStates );

	await assert.rejects(
		verifyPackagedApp( appPath, {
			platform: 'darwin',
			readArchitectures: () => [ 'arm64' ],
		} ),
		/RunAsNode must be disabled/
	);
} );

test( 'verifier rejects fallback app code', async ( t ) => {
	const { appPath, resourcesPath } = await createFixture( t );
	await mkdir( path.join( resourcesPath, 'app' ) );

	await assert.rejects(
		verifyPackagedApp( appPath, {
			platform: 'darwin',
			readArchitectures: () => [ 'arm64' ],
		} ),
		/unpacked app directory must not exist/
	);
} );

test( 'verifier rejects an unpacked ASAR payload', async ( t ) => {
	const { appPath, resourcesPath } = await createFixture( t );
	await mkdir( path.join( resourcesPath, 'app.asar.unpacked' ) );

	await assert.rejects(
		verifyPackagedApp( appPath, {
			platform: 'darwin',
			readArchitectures: () => [ 'arm64' ],
		} ),
		/app\.asar\.unpacked must not exist/
	);
} );

test( 'verifier requires executable arm64 PHP', async ( t ) => {
	const { appPath, phpPath } = await createFixture( t );
	await chmod( phpPath, 0o644 );

	await assert.rejects(
		verifyPackagedApp( appPath, {
			platform: 'darwin',
			readArchitectures: () => [ 'arm64' ],
		} ),
		/Bundled PHP is not executable/
	);

	await chmod( phpPath, 0o755 );
	await assert.rejects(
		verifyPackagedApp( appPath, {
			platform: 'darwin',
			readArchitectures: () => [ 'x86_64' ],
		} ),
		/Bundled PHP must contain only arm64/
	);
} );

test( 'lipo architecture inspection handles success and failure', () => {
	assert.deepEqual(
		inspectMachOArchitectures( '/tmp/php', () => ( {
			status: 0,
			stdout: 'arm64\n',
			stderr: '',
		} ) ),
		[ 'arm64' ]
	);

	assert.throws(
		() =>
			inspectMachOArchitectures( '/tmp/php', () => ( {
				status: 1,
				stdout: '',
				stderr: 'not a Mach-O file',
			} ) ),
		/not a Mach-O file/
	);
} );

test( 'CLI accepts both --app forms', () => {
	assert.deepEqual( parseArguments( [ '--app', '/tmp/Cortext.app' ] ), {
		appPath: '/tmp/Cortext.app',
		help: false,
	} );
	assert.deepEqual( parseArguments( [ '--app=/tmp/Cortext.app' ] ), {
		appPath: '/tmp/Cortext.app',
		help: false,
	} );
	assert.throws( () => parseArguments( [] ), /--app requires/ );
} );
