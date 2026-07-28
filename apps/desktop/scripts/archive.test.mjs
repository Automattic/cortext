import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import archiveHelpers from '../lib/archive.js';
import zipHelpers from './zip.js';

const { assertSafeEntry, assertSafeEntryName, extractZip } = archiveHelpers;
const { zipDirectory } = zipHelpers;

function tmpDir() {
	return fs.mkdtempSync( path.join( os.tmpdir(), 'cortext-archive-' ) );
}

function writeFile( file, contents ) {
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	fs.writeFileSync( file, contents );
}

function replaceAllBytes( buffer, fromString, toString ) {
	const from = Buffer.from( fromString );
	const to = Buffer.from( toString );
	assert.equal( from.length, to.length );

	let count = 0;
	let offset = 0;
	while ( ( offset = buffer.indexOf( from, offset ) ) !== -1 ) {
		to.copy( buffer, offset );
		offset += to.length;
		count += 1;
	}
	return count;
}

test( 'ZIP extraction rejects paths outside the destination', () => {
	assert.throws(
		() => assertSafeEntryName( '../outside.txt', tmpDir() ),
		/Unsafe ZIP entry path/
	);
	assert.throws(
		() => assertSafeEntryName( 'C:\\outside.txt', tmpDir() ),
		/Unsafe ZIP entry path/
	);
} );

test( 'ZIP extraction rejects unsafe entries before creating any directories', async () => {
	const root = tmpDir();
	const source = path.join( root, 'source' );
	const archive = path.join( root, 'unsafe.zip' );
	const destination = path.join( root, 'destination' );
	const escapedDirectory = path.join( root, 'escaped-dir' );
	writeFile(
		path.join( source, 'aa/escaped-dir/file.txt' ),
		'DO NOT EXTRACT'
	);
	await zipDirectory( source, archive, '' );

	const bytes = fs.readFileSync( archive );
	assert.equal(
		replaceAllBytes(
			bytes,
			'aa/escaped-dir/file.txt',
			'../escaped-dir/file.txt'
		),
		2
	);
	fs.writeFileSync( archive, bytes );

	await assert.rejects(
		extractZip( archive, destination ),
		/invalid relative path|Unsafe ZIP entry path/
	);
	assert.equal( fs.existsSync( destination ), false );
	assert.equal( fs.existsSync( escapedDirectory ), false );
} );

test( 'zipDirectory reports a file it cannot read and removes the archive', async () => {
	const root = tmpDir();
	const source = path.join( root, 'source' );
	const archive = path.join( root, 'partial.zip' );
	for ( const name of [ 'a', 'b', 'c', 'd' ] ) {
		writeFile(
			path.join( source, `${ name }.txt` ),
			name.repeat( 200000 )
		);
	}

	const pending = zipDirectory( source, archive, 'wordpress' );
	// yazl opens each file lazily, after zipDirectory has walked the tree.
	fs.rmSync( path.join( source, 'c.txt' ) );

	await assert.rejects( pending, /ENOENT|not a file/ );
	assert.equal( fs.existsSync( archive ), false );
} );

test( 'ZIP extraction rejects symbolic links', () => {
	assert.throws(
		() =>
			assertSafeEntry(
				{
					fileName: 'wordpress/link',
					versionMadeBy: 3 << 8,
					externalFileAttributes: 0xa000 << 16,
				},
				tmpDir()
			),
		/ZIP entry is a symbolic link/
	);
} );

test( 'ZIP extraction rejects symlink mode bits regardless of creator platform', () => {
	assert.throws(
		() =>
			assertSafeEntry(
				{
					fileName: 'wordpress/link',
					versionMadeBy: 0,
					externalFileAttributes: 0xa000 << 16,
				},
				tmpDir()
			),
		/ZIP entry is a symbolic link/
	);
} );
