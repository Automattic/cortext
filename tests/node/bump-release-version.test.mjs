import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { bumpReleaseVersion } from '../../scripts/bump-release-version.mjs';

function writeFile( rootDir, relativePath, content ) {
	const filePath = path.join( rootDir, relativePath );
	fs.mkdirSync( path.dirname( filePath ), { recursive: true } );
	fs.writeFileSync( filePath, content );
}

function readFile( rootDir, relativePath ) {
	return fs.readFileSync( path.join( rootDir, relativePath ), 'utf8' );
}

function readJson( rootDir, relativePath ) {
	return JSON.parse( readFile( rootDir, relativePath ) );
}

function fixture() {
	const rootDir = fs.mkdtempSync( path.join( os.tmpdir(), 'cortext-bump-' ) );

	writeFile(
		rootDir,
		'package.json',
		JSON.stringify(
			{
				name: 'cortext',
				version: '0.1.0',
				private: true,
			},
			null,
			'\t'
		) + '\n'
	);
	writeFile(
		rootDir,
		'apps/desktop/package.json',
		JSON.stringify(
			{
				name: 'cortext-desktop',
				version: '0.0.1',
				private: true,
			},
			null,
			'\t'
		) + '\n'
	);
	writeFile(
		rootDir,
		'apps/desktop/package-lock.json',
		JSON.stringify(
			{
				name: 'cortext-desktop',
				version: '0.0.1',
				lockfileVersion: 3,
				packages: {
					'': {
						name: 'cortext-desktop',
						version: '0.0.1',
					},
				},
			},
			null,
			'\t'
		) + '\n'
	);
	writeFile(
		rootDir,
		'cortext.php',
		`<?php
/**
 * Plugin Name:       Cortext
 * Version:           0.1.0
 */

define( 'CORTEXT_VERSION', '0.1.0' );
`
	);
	writeFile(
		rootDir,
		'readme.txt',
		`=== Cortext ===
Stable tag: 0.1.0
`
	);

	return rootDir;
}

describe( 'bump release version', () => {
	it( 'updates release versions across plugin and package metadata', () => {
		const rootDir = fixture();

		bumpReleaseVersion( rootDir, '0.2.3' );

		assert.equal( readJson( rootDir, 'package.json' ).version, '0.2.3' );
		assert.equal(
			readJson( rootDir, 'apps/desktop/package.json' ).version,
			'0.2.3'
		);

		const lock = readJson( rootDir, 'apps/desktop/package-lock.json' );
		assert.equal( lock.version, '0.2.3' );
		assert.equal( lock.packages[ '' ].version, '0.2.3' );

		assert.match(
			readFile( rootDir, 'cortext.php' ),
			/\* Version:\s+0\.2\.3/
		);
		assert.match(
			readFile( rootDir, 'cortext.php' ),
			/define\( 'CORTEXT_VERSION', '0\.2\.3' \);/
		);
		assert.match(
			readFile( rootDir, 'readme.txt' ),
			/Stable tag: 0\.2\.3/
		);
	} );

	it( 'allows rerunning when metadata already matches the release version', () => {
		const rootDir = fixture();

		bumpReleaseVersion( rootDir, '0.2.3' );
		bumpReleaseVersion( rootDir, '0.2.3' );

		assert.equal( readJson( rootDir, 'package.json' ).version, '0.2.3' );
		assert.match(
			readFile( rootDir, 'cortext.php' ),
			/define\( 'CORTEXT_VERSION', '0\.2\.3' \);/
		);
	} );

	it( 'rejects versions outside the release tag format', () => {
		assert.throws(
			() => bumpReleaseVersion( fixture(), 'v0.2.3' ),
			/without a leading "v"/
		);
	} );
} );
