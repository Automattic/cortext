import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	refreshSiteIfOutdated,
	recoverInterruptedSwap,
	readMarker,
	writeMarker,
	BAK_PREFIX,
} from '../lib/site-refresh.js';

function tmpDir() {
	return fs.mkdtempSync( path.join( os.tmpdir(), 'cortext-site-refresh-' ) );
}

function writeFile( file, contents ) {
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	fs.writeFileSync( file, contents );
}

// A tiny WordPress-shaped tree: index.php satisfies the extraction check, and
// the rest separates code from user data.
function writeSite( wordpressDir, { code, wpConfig, db, upload } ) {
	writeFile( path.join( wordpressDir, 'index.php' ), code );
	writeFile(
		path.join( wordpressDir, 'wp-content/plugins/cortext/cortext.php' ),
		code
	);
	if ( wpConfig !== undefined ) {
		writeFile( path.join( wordpressDir, 'wp-config.php' ), wpConfig );
	}
	if ( db !== undefined ) {
		writeFile(
			path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ),
			db
		);
	}
	if ( upload !== undefined ) {
		writeFile(
			path.join( wordpressDir, 'wp-content/uploads/photo.txt' ),
			upload
		);
	}
}

// Build a snapshot.zip with a top-level `wordpress/` dir, like build-snapshot.
function makeSnapshotZip( contents ) {
	const src = tmpDir();
	writeSite( path.join( src, 'wordpress' ), contents );
	const zipPath = path.join( src, 'snapshot.zip' );
	const result = spawnSync( 'zip', [ '-q', '-r', zipPath, 'wordpress' ], {
		cwd: src,
		stdio: [ 'ignore', 'ignore', 'ignore' ],
	} );
	assert.equal( result.status, 0, 'zip fixture built' );
	return zipPath;
}

function read( file ) {
	return fs.readFileSync( file, 'utf8' );
}

test( 'refresh updates code and preserves the database, uploads, and wp-config', () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, {
		code: 'CODE v1',
		wpConfig: 'WPCONFIG v1 SALT',
		db: 'USER DATA',
		upload: 'USER UPLOAD',
	} );
	writeMarker( siteRoot, '1.0.0' );

	const snapshotZip = makeSnapshotZip( {
		code: 'CODE v2',
		wpConfig: 'WPCONFIG v2 FRESH',
		db: 'SEED DATA',
	} );

	const refreshed = refreshSiteIfOutdated( {
		snapshotZip,
		siteRoot,
		version: '2.0.0',
	} );

	assert.equal( refreshed, true );
		// Snapshot code replaced the old code.
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'CODE v2' );
	assert.equal(
		read(
			path.join( wordpressDir, 'wp-content/plugins/cortext/cortext.php' )
		),
		'CODE v2'
	);
		// User data and wp-config survived the swap.
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'USER DATA'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/uploads/photo.txt' ) ),
		'USER UPLOAD'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-config.php' ) ),
		'WPCONFIG v1 SALT'
	);
		// Marker moved forward, and no scratch dirs were left.
	assert.equal( readMarker( siteRoot ), '2.0.0' );
	const leftovers = fs
		.readdirSync( siteRoot )
		.filter(
			( n ) => n.startsWith( BAK_PREFIX ) || n.startsWith( '.next-' )
		);
	assert.deepEqual( leftovers, [] );
} );

test( 'refresh is a no-op on the same version and never downgrades', () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, { code: 'CODE v2', db: 'USER DATA' } );
	writeMarker( siteRoot, '2.0.0' );
	const snapshotZip = makeSnapshotZip( { code: 'CODE other', db: 'SEED' } );

	assert.equal(
		refreshSiteIfOutdated( { snapshotZip, siteRoot, version: '2.0.0' } ),
		false
	);
	assert.equal(
		refreshSiteIfOutdated( { snapshotZip, siteRoot, version: '1.5.0' } ),
		false
	);
		// Still untouched.
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'CODE v2' );
	assert.equal( readMarker( siteRoot ), '2.0.0' );
} );

test( 'refresh without an extracted site defers to first-run extraction', () => {
	const siteRoot = tmpDir();
	const snapshotZip = makeSnapshotZip( { code: 'CODE v2', db: 'SEED' } );
	assert.equal(
		refreshSiteIfOutdated( { snapshotZip, siteRoot, version: '2.0.0' } ),
		false
	);
	assert.equal( fs.existsSync( path.join( siteRoot, 'wordpress' ) ), false );
} );

test( 'recoverInterruptedSwap restores a stashed tree when wordpress is missing', () => {
	const siteRoot = tmpDir();
	fs.mkdirSync( siteRoot, { recursive: true } );
	const bak = path.join( siteRoot, `${ BAK_PREFIX }123-456` );
	writeFile( path.join( bak, 'index.php' ), 'RESTORED' );

	recoverInterruptedSwap( siteRoot );

	assert.equal(
		read( path.join( siteRoot, 'wordpress/index.php' ) ),
		'RESTORED'
	);
	assert.equal( fs.existsSync( bak ), false );
} );

test( 'refresh runs between same-core prereleases', () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, { code: 'CODE rc1', db: 'USER DATA' } );
	writeMarker( siteRoot, '0.2.0-rc.1' );
	const snapshotZip = makeSnapshotZip( { code: 'CODE rc2', db: 'SEED' } );

	assert.equal(
		refreshSiteIfOutdated( {
			snapshotZip,
			siteRoot,
			version: '0.2.0-rc.2',
		} ),
		true
	);
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'CODE rc2' );
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'USER DATA'
	);
	assert.equal( readMarker( siteRoot ), '0.2.0-rc.2' );
} );

test( 'recoverInterruptedSwap clears orphaned scratch dirs and leaves the live tree', () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeFile( path.join( wordpressDir, 'index.php' ), 'LIVE' );
	const scratch = path.join( siteRoot, '.next-999-1' );
	writeFile( path.join( scratch, 'wordpress/index.php' ), 'SCRATCH' );

	recoverInterruptedSwap( siteRoot );

	assert.equal( fs.existsSync( scratch ), false );
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'LIVE' );
} );
