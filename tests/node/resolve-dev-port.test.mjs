import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	resolveBackendPort,
	resolveDevPort,
	resolveProxyTokenPath,
} from '../../scripts/resolve-dev-port.mjs';

const projectRoot = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

function createSetupFixture() {
	const fixtureRoot = realpathSync(
		mkdtempSync( path.join( os.tmpdir(), 'cortext-setup-test-' ) )
	);
	const scriptsDirectory = path.join( fixtureRoot, 'scripts' );
	const binDirectory = path.join( fixtureRoot, 'bin' );
	const temporaryDirectory = path.join( fixtureRoot, 'tmp' );

	mkdirSync( scriptsDirectory );
	mkdirSync( binDirectory );
	mkdirSync( temporaryDirectory );

	for ( const script of [
		'setup.sh',
		'resolve-dev-port.mjs',
		'dev-autologin.php',
	] ) {
		copyFileSync(
			path.join( projectRoot, 'scripts', script ),
			path.join( scriptsDirectory, script )
		);
	}

	for ( const executable of [
		path.join( scriptsDirectory, 'refresh-label.sh' ),
		path.join( binDirectory, 'pnpm' ),
		path.join( binDirectory, 'composer' ),
	] ) {
		writeFileSync( executable, '#!/usr/bin/env bash\nexit 0\n' );
		chmodSync( executable, 0o755 );
	}

	return { binDirectory, fixtureRoot, temporaryDirectory };
}

function runSetup( fixture, conductorPort ) {
	return spawnSync( 'bash', [ 'scripts/setup.sh' ], {
		cwd: fixture.fixtureRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			CONDUCTOR_PORT: conductorPort,
			PATH: `${ fixture.binDirectory }:${ process.env.PATH ?? '' }`,
			TMPDIR: fixture.temporaryDirectory,
		},
	} );
}

function permissionMode( filePath ) {
	return statSync( filePath ).mode.toString( 8 ).slice( -3 );
}

describe( 'resolve dev port', () => {
	it( 'uses the Conductor port without applying the workspace fallback', () => {
		assert.equal( resolveDevPort( '/workspace/cortext', '55270' ), 55270 );
	} );

	it( 'reserves the next assigned port for the WordPress backend', () => {
		assert.equal( resolveBackendPort( 55270 ), 55271 );
		assert.equal( resolveBackendPort( 8999 ), 9000 );
		assert.throws(
			() => resolveBackendPort( 65535 ),
			/Cannot reserve a WordPress backend port/
		);
	} );

	it( 'rejects invalid Conductor ports', () => {
		for ( const value of [
			'',
			'0',
			'65536',
			'8080.5',
			' 8080',
			'8080 ',
			'+8080',
			'-8080',
			'0x1f90',
			'eight thousand',
		] ) {
			assert.throws(
				() => resolveDevPort( '/workspace/cortext', value ),
				/Invalid CONDUCTOR_PORT.*decimal integer from 1 to 65535/
			);
		}
	} );

	it( 'preserves the existing fallback for a known absolute path', () => {
		assert.equal( resolveDevPort( '/workspace/cortext' ), 8368 );
	} );

	it( 'returns the same fallback for the same resolved path', () => {
		assert.equal(
			resolveDevPort( '/workspace/cortext/../cortext' ),
			resolveDevPort( '/workspace/cortext' )
		);
	} );

	it( 'keeps fallback ports in the existing 8000 through 8999 range', () => {
		for ( let index = 0; index < 100; index++ ) {
			const port = resolveDevPort( `/workspace/cortext-${ index }` );
			assert.ok( port >= 8000 );
			assert.ok( port <= 8999 );
		}
	} );

	it( 'keeps each workspace proxy token outside its document root', () => {
		const temporaryDirectory = '/private/tmp';
		const first = resolveProxyTokenPath(
			'/workspace/cortext',
			temporaryDirectory
		);
		const second = resolveProxyTokenPath(
			'/workspace/cortext-two',
			temporaryDirectory
		);

		assert.equal(
			first,
			resolveProxyTokenPath( '/workspace/cortext', temporaryDirectory )
		);
		assert.notEqual( first, second );
		assert.equal(
			path.dirname( path.dirname( first ) ),
			temporaryDirectory
		);
		assert.equal( first.startsWith( '/workspace/cortext/' ), false );
	} );
} );

describe( 'local environment setup', () => {
	it( 'writes the backend port and all local plugins', ( context ) => {
		const fixture = createSetupFixture();
		const tokenPath = resolveProxyTokenPath(
			fixture.fixtureRoot,
			fixture.temporaryDirectory
		);
		context.after( () =>
			rmSync( fixture.fixtureRoot, { force: true, recursive: true } )
		);

		const result = runSetup( fixture, '55270' );

		assert.equal( result.status, 0, result.stderr );
		assert.deepEqual(
			JSON.parse(
				readFileSync(
					path.join( fixture.fixtureRoot, '.wp-env.override.json' ),
					'utf8'
				)
			),
			{
				port: 55271,
				plugins: [
					'.',
					'./.wp-env-plugins/worktree-label',
					'./.wp-env-plugins/dev-autologin',
				],
			}
		);
		const legacyTokenPath = path.join(
			fixture.fixtureRoot,
			'.wp-env-plugins/dev-autologin/proxy-token'
		);
		const token = readFileSync( tokenPath, 'utf8' );
		assert.match( token, /^[a-f0-9]{64}\n$/ );
		assert.throws(
			() => readFileSync( legacyTokenPath, 'utf8' ),
			/ENOENT/
		);
		assert.match(
			readFileSync(
				path.join(
					fixture.fixtureRoot,
					'.wp-env-plugins/dev-autologin/.proxy-token.php'
				),
				'utf8'
			),
			new RegExp( `^<\\?php\\nreturn '${ token.trim() }';\\n$` )
		);
		assert.equal( permissionMode( tokenPath ), '600' );
		assert.equal( permissionMode( path.dirname( tokenPath ) ), '700' );
		assert.equal(
			permissionMode(
				path.join(
					fixture.fixtureRoot,
					'.wp-env-plugins/dev-autologin/.proxy-token.php'
				)
			),
			'600'
		);
		assert.equal(
			readFileSync(
				path.join(
					fixture.fixtureRoot,
					'.wp-env-plugins/dev-autologin/dev-autologin.php'
				),
				'utf8'
			),
			readFileSync(
				path.join( fixture.fixtureRoot, 'scripts/dev-autologin.php' ),
				'utf8'
			)
		);

		const rerun = runSetup( fixture, '55270' );
		assert.equal( rerun.status, 0, rerun.stderr );
		assert.equal( readFileSync( tokenPath, 'utf8' ), token );
	} );

	it( 'refuses a symlinked proxy token directory', ( context ) => {
		const fixture = createSetupFixture();
		const redirectedDirectory = path.join(
			fixture.fixtureRoot,
			'redirected-token-directory'
		);
		const tokenDirectory = path.join(
			fixture.temporaryDirectory,
			'cortext-dev-proxy'
		);
		context.after( () =>
			rmSync( fixture.fixtureRoot, { force: true, recursive: true } )
		);
		mkdirSync( redirectedDirectory );
		symlinkSync( redirectedDirectory, tokenDirectory );

		const result = runSetup( fixture, '55270' );

		assert.notEqual( result.status, 0 );
		assert.match( result.stderr, /symlink.*proxy token directory/ );
		assert.deepEqual( readdirSync( redirectedDirectory ), [] );
	} );

	it( 'refuses a symlinked proxy token file', ( context ) => {
		const fixture = createSetupFixture();
		const tokenPath = resolveProxyTokenPath(
			fixture.fixtureRoot,
			fixture.temporaryDirectory
		);
		const redirectedFile = path.join(
			fixture.fixtureRoot,
			'redirected-token'
		);
		context.after( () =>
			rmSync( fixture.fixtureRoot, { force: true, recursive: true } )
		);
		mkdirSync( path.dirname( tokenPath ) );
		writeFileSync( redirectedFile, 'unchanged' );
		symlinkSync( redirectedFile, tokenPath );

		const result = runSetup( fixture, '55270' );

		assert.notEqual( result.status, 0 );
		assert.match( result.stderr, /symlink.*proxy token/ );
		assert.equal( readFileSync( redirectedFile, 'utf8' ), 'unchanged' );
	} );

	it( 'leaves an existing override untouched when the assigned port is invalid', ( context ) => {
		const fixture = createSetupFixture();
		const overridePath = path.join(
			fixture.fixtureRoot,
			'.wp-env.override.json'
		);
		const previousOverride = '{"port":8123}\n';
		context.after( () =>
			rmSync( fixture.fixtureRoot, { force: true, recursive: true } )
		);
		writeFileSync( overridePath, previousOverride );

		const result = runSetup( fixture, '' );

		assert.notEqual( result.status, 0 );
		assert.match( result.stderr, /Invalid CONDUCTOR_PORT/ );
		assert.equal( readFileSync( overridePath, 'utf8' ), previousOverride );
	} );
} );
