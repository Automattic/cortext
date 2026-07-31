import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	ensureSiteFromSnapshot,
	refreshSiteIfOutdated,
	recoverInterruptedSwap,
	readMarker,
	writeMarker,
	BAK_PREFIX,
} from '../lib/site-refresh.js';
import zipHelpers from './zip.js';

const { zipDirectory } = zipHelpers;

function tmpDir() {
	return fs.mkdtempSync( path.join( os.tmpdir(), 'cortext-site-refresh-' ) );
}

function writeFile( file, contents ) {
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	fs.writeFileSync( file, contents );
}

// Create the minimum WordPress tree needed for extraction checks, with separate
// code and user data.
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
async function makeSnapshotZip( contents ) {
	const src = tmpDir();
	writeSite( path.join( src, 'wordpress' ), contents );
	const zipPath = path.join( src, 'snapshot.zip' );
	await zipDirectory( path.join( src, 'wordpress' ), zipPath, 'wordpress' );
	return zipPath;
}

function read( file ) {
	return fs.readFileSync( file, 'utf8' );
}

test( 'refresh updates code and preserves the database, uploads, and wp-config', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, {
		code: 'CODE v1',
		wpConfig: 'WPCONFIG v1 SALT',
		db: 'USER DATA',
		upload: 'USER UPLOAD',
	} );
	writeMarker( siteRoot, '1.0.0' );

	const snapshotZip = await makeSnapshotZip( {
		code: 'CODE v2',
		wpConfig: 'WPCONFIG v2 FRESH',
		db: 'SEED DATA',
	} );

	const refreshed = await refreshSiteIfOutdated( {
		snapshotZip,
		siteRoot,
		version: '2.0.0',
	} );

	assert.equal( refreshed, true );
	// The refresh replaced the old code with the snapshot.
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'CODE v2' );
	assert.equal(
		read(
			path.join( wordpressDir, 'wp-content/plugins/cortext/cortext.php' )
		),
		'CODE v2'
	);
	// The refresh kept the user's data and wp-config.
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
	// The refresh updated the marker and removed its temporary directories.
	assert.equal( readMarker( siteRoot ), '2.0.0' );
	const leftovers = fs
		.readdirSync( siteRoot )
		.filter(
			( n ) => n.startsWith( BAK_PREFIX ) || n.startsWith( '.next-' )
		);
	assert.deepEqual( leftovers, [] );
} );

test( 'refresh does nothing for the same version and never downgrades', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, { code: 'CODE v2', db: 'USER DATA' } );
	writeMarker( siteRoot, '2.0.0' );
	const snapshotZip = await makeSnapshotZip( {
		code: 'CODE other',
		db: 'SEED',
	} );

	assert.equal(
		await refreshSiteIfOutdated( {
			snapshotZip,
			siteRoot,
			version: '2.0.0',
		} ),
		false
	);
	assert.equal(
		await refreshSiteIfOutdated( {
			snapshotZip,
			siteRoot,
			version: '1.5.0',
		} ),
		false
	);
	// The existing site is unchanged.
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'CODE v2' );
	assert.equal( readMarker( siteRoot ), '2.0.0' );
} );

test( 'refresh waits for first-run extraction when no site exists', async () => {
	const siteRoot = tmpDir();
	const snapshotZip = await makeSnapshotZip( {
		code: 'CODE v2',
		db: 'SEED',
	} );
	assert.equal(
		await refreshSiteIfOutdated( {
			snapshotZip,
			siteRoot,
			version: '2.0.0',
		} ),
		false
	);
	assert.equal( fs.existsSync( path.join( siteRoot, 'wordpress' ) ), false );
} );

test( 'first-run extraction replaces an incomplete site without losing user data', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeFile( path.join( wordpressDir, 'partial.txt' ), 'INCOMPLETE' );
	writeFile(
		path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ),
		'USER DATABASE'
	);
	writeFile(
		path.join( wordpressDir, 'wp-content/uploads/photo.txt' ),
		'USER UPLOAD'
	);
	writeFile( path.join( wordpressDir, 'wp-config.php' ), 'USER CONFIG' );
	const snapshotZip = await makeSnapshotZip( {
		code: 'COMPLETE',
		db: 'SEED',
	} );

	assert.equal(
		await ensureSiteFromSnapshot( {
			snapshotZip,
			siteRoot,
			version: '2.0.0',
		} ),
		wordpressDir
	);
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'COMPLETE' );
	assert.equal(
		fs.existsSync( path.join( wordpressDir, 'partial.txt' ) ),
		false
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'USER DATABASE'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/uploads/photo.txt' ) ),
		'USER UPLOAD'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-config.php' ) ),
		'USER CONFIG'
	);
	assert.equal( readMarker( siteRoot ), '2.0.0' );
	assert.deepEqual(
		fs
			.readdirSync( siteRoot )
			.filter( ( name ) => name.startsWith( '.next-' ) ),
		[]
	);
} );

test( 'first-run extraction restores the original tree when the final rename fails', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeFile(
		path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ),
		'USER DATABASE'
	);
	writeFile(
		path.join( wordpressDir, 'wp-content/uploads/photo.txt' ),
		'USER UPLOAD'
	);
	writeFile( path.join( wordpressDir, 'wp-config.php' ), 'USER CONFIG' );
	const snapshotZip = await makeSnapshotZip( {
		code: 'COMPLETE',
		db: 'SEED',
	} );
	const renameSync = fs.renameSync;
	let renameCount = 0;
	fs.renameSync = ( from, to ) => {
		renameCount += 1;
		if ( renameCount === 2 ) {
			throw new Error( 'simulated first-run rename failure' );
		}
		return renameSync( from, to );
	};

	try {
		await assert.rejects(
			ensureSiteFromSnapshot( {
				snapshotZip,
				siteRoot,
				version: '2.0.0',
			} ),
			/simulated first-run rename failure/
		);
	} finally {
		fs.renameSync = renameSync;
	}

	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'USER DATABASE'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/uploads/photo.txt' ) ),
		'USER UPLOAD'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-config.php' ) ),
		'USER CONFIG'
	);
	assert.equal(
		fs.existsSync( path.join( wordpressDir, 'index.php' ) ),
		false
	);
	assert.deepEqual(
		fs
			.readdirSync( siteRoot )
			.filter(
				( name ) =>
					name.startsWith( '.next-' ) || name.startsWith( BAK_PREFIX )
			),
		[]
	);
} );

test( 'first-run extraction preserves user data when another process installs the live tree first', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeFile(
		path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ),
		'USER DATABASE'
	);
	writeFile(
		path.join( wordpressDir, 'wp-content/uploads/photo.txt' ),
		'USER UPLOAD'
	);
	writeFile( path.join( wordpressDir, 'wp-config.php' ), 'USER CONFIG' );
	const snapshotZip = await makeSnapshotZip( {
		code: 'OUR SNAPSHOT',
		db: 'OUR SEED',
	} );
	const renameSync = fs.renameSync;
	let renameCount = 0;
	fs.renameSync = ( from, to ) => {
		renameCount += 1;
		if ( renameCount === 2 ) {
			writeSite( wordpressDir, {
				code: 'CONCURRENT SNAPSHOT',
				wpConfig: 'CONCURRENT CONFIG',
				db: 'CONCURRENT SEED',
				upload: 'CONCURRENT UPLOAD',
			} );
			const error = new Error( 'destination already exists' );
			error.code = 'EEXIST';
			throw error;
		}
		return renameSync( from, to );
	};

	try {
		assert.equal(
			await ensureSiteFromSnapshot( {
				snapshotZip,
				siteRoot,
				version: '2.0.0',
			} ),
			wordpressDir
		);
	} finally {
		fs.renameSync = renameSync;
	}

	assert.equal(
		read( path.join( wordpressDir, 'index.php' ) ),
		'CONCURRENT SNAPSHOT'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'USER DATABASE'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/uploads/photo.txt' ) ),
		'USER UPLOAD'
	);
	assert.equal(
		read( path.join( wordpressDir, 'wp-config.php' ) ),
		'USER CONFIG'
	);
	assert.deepEqual(
		fs
			.readdirSync( siteRoot )
			.filter(
				( name ) =>
					name.startsWith( '.next-' ) || name.startsWith( BAK_PREFIX )
			),
		[]
	);
} );

test( 'a failed first-run extraction leaves the incomplete site untouched', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeFile( path.join( wordpressDir, 'partial.txt' ), 'KEEP UNTIL RETRY' );
	const snapshotZip = path.join( tmpDir(), 'broken snapshot.zip' );
	fs.writeFileSync( snapshotZip, 'not a zip archive' );

	await assert.rejects(
		ensureSiteFromSnapshot( {
			snapshotZip,
			siteRoot,
			version: '2.0.0',
		} )
	);
	assert.equal(
		read( path.join( wordpressDir, 'partial.txt' ) ),
		'KEEP UNTIL RETRY'
	);
	assert.equal(
		fs.existsSync( path.join( wordpressDir, 'index.php' ) ),
		false
	);
	assert.deepEqual(
		fs
			.readdirSync( siteRoot )
			.filter( ( name ) => name.startsWith( '.next-' ) ),
		[]
	);
} );

test( 'recoverInterruptedSwap restores a backup when the live tree is missing', () => {
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

test( 'refresh runs when prerelease versions share the same numeric core', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, { code: 'CODE rc1', db: 'USER DATA' } );
	writeMarker( siteRoot, '0.2.0-rc.1' );
	const snapshotZip = await makeSnapshotZip( {
		code: 'CODE rc2',
		db: 'SEED',
	} );

	assert.equal(
		await refreshSiteIfOutdated( {
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

test( 'recoverInterruptedSwap removes leftover temporary directories without changing the live tree', () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeFile( path.join( wordpressDir, 'index.php' ), 'LIVE' );
	const scratch = path.join( siteRoot, '.next-999-1' );
	writeFile( path.join( scratch, 'wordpress/index.php' ), 'SCRATCH' );

	recoverInterruptedSwap( siteRoot );

	assert.equal( fs.existsSync( scratch ), false );
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'LIVE' );
} );

test( 'recovery restores the complete backup, not an older first-run one', () => {
	const siteRoot = tmpDir();
	writeSite( path.join( siteRoot, `${ BAK_PREFIX }2000-1` ), {
		code: 'COMPLETE',
		db: 'CURRENT DATABASE',
	} );
	// Older, and incomplete by construction, but its name sorts last.
	writeFile(
		path.join(
			siteRoot,
			`${ BAK_PREFIX }first-run-1000-2/wp-content/database/.ht.sqlite`
		),
		'OLD DATABASE'
	);

	recoverInterruptedSwap( siteRoot );

	const wordpressDir = path.join( siteRoot, 'wordpress' );
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'COMPLETE' );
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'CURRENT DATABASE'
	);
	assert.deepEqual(
		fs
			.readdirSync( siteRoot )
			.filter( ( name ) => name.startsWith( BAK_PREFIX ) ),
		[]
	);
} );

test( 'recovery never copies a stale first-run backup over newer user data', () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, { code: 'LIVE', db: 'NEW USER DATABASE' } );
	writeFile(
		path.join(
			siteRoot,
			`${ BAK_PREFIX }first-run-1000-2/wp-content/database/.ht.sqlite`
		),
		'OLD DATABASE'
	);

	recoverInterruptedSwap( siteRoot );

	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'NEW USER DATABASE'
	);
	assert.deepEqual(
		fs
			.readdirSync( siteRoot )
			.filter( ( name ) => name.startsWith( BAK_PREFIX ) ),
		[]
	);
} );

test( 'recovery leaves the live database unchanged when a normal refresh backup remains', () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	const refreshBackup = path.join( siteRoot, `${ BAK_PREFIX }123-456` );
	writeSite( wordpressDir, {
		code: 'LIVE',
		db: 'NEW USER DATABASE',
	} );
	writeSite( refreshBackup, {
		code: 'OLD',
		db: 'OLD USER DATABASE',
	} );

	recoverInterruptedSwap( siteRoot );

	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'NEW USER DATABASE'
	);
	assert.equal( fs.existsSync( refreshBackup ), true );
} );

test( 'refresh handles paths with spaces and non-ASCII characters', async () => {
	const parent = tmpDir();
	const siteRoot = path.join( parent, 'Cortext site ñ' );
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, { code: 'OLD', db: 'USER DATA' } );
	writeMarker( siteRoot, '1.0.0' );
	const snapshotZip = await makeSnapshotZip( {
		code: 'NUEVO',
		db: 'SEED',
	} );

	assert.equal(
		await refreshSiteIfOutdated( {
			snapshotZip,
			siteRoot,
			version: '2.0.0',
		} ),
		true
	);
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'NUEVO' );
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'USER DATA'
	);
} );

test( 'refresh leaves the live site intact when the snapshot is corrupt', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, { code: 'LIVE', db: 'USER DATA' } );
	writeMarker( siteRoot, '1.0.0' );
	const snapshotZip = path.join( tmpDir(), 'broken snapshot.zip' );
	fs.writeFileSync( snapshotZip, 'not a zip archive' );

	assert.equal(
		await refreshSiteIfOutdated( {
			snapshotZip,
			siteRoot,
			version: '2.0.0',
		} ),
		false
	);
	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'LIVE' );
	assert.equal( readMarker( siteRoot ), '1.0.0' );
} );

test( 'refresh restores the live tree when the final rename fails', async () => {
	const siteRoot = tmpDir();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	writeSite( wordpressDir, { code: 'LIVE', db: 'USER DATA' } );
	writeMarker( siteRoot, '1.0.0' );
	const snapshotZip = await makeSnapshotZip( {
		code: 'NEW',
		db: 'SEED',
	} );
	const renameSync = fs.renameSync;
	let renameCount = 0;
	fs.renameSync = ( from, to ) => {
		renameCount += 1;
		if ( renameCount === 2 ) {
			throw new Error( 'simulated rename failure' );
		}
		return renameSync( from, to );
	};

	try {
		assert.equal(
			await refreshSiteIfOutdated( {
				snapshotZip,
				siteRoot,
				version: '2.0.0',
			} ),
			false
		);
	} finally {
		fs.renameSync = renameSync;
	}

	assert.equal( read( path.join( wordpressDir, 'index.php' ) ), 'LIVE' );
	assert.equal(
		read( path.join( wordpressDir, 'wp-content/database/.ht.sqlite' ) ),
		'USER DATA'
	);
	assert.equal( readMarker( siteRoot ), '1.0.0' );
} );
