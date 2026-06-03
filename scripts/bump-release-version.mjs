#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const VERSIONED_JSON_FILES = [ 'package.json', 'apps/desktop/package.json' ];

function assertVersion( version ) {
	if ( ! VERSION_PATTERN.test( version ) ) {
		throw new Error(
			`Release versions must use the WordPress-style format 0.1.0, without a leading "v". Received "${ version }".`
		);
	}
}

function writeJsonVersion( rootDir, relativePath, version ) {
	const filePath = path.join( rootDir, relativePath );
	const data = JSON.parse( fs.readFileSync( filePath, 'utf8' ) );
	data.version = version;
	fs.writeFileSync( filePath, `${ JSON.stringify( data, null, '\t' ) }\n` );
}

function updateTextFile( rootDir, relativePath, replacements ) {
	const filePath = path.join( rootDir, relativePath );
	let content = fs.readFileSync( filePath, 'utf8' );

	for ( const [ pattern, replacement ] of replacements ) {
		if ( ! pattern.test( content ) ) {
			throw new Error(
				`Could not update ${ relativePath }; missing pattern ${ pattern }.`
			);
		}
		content = content.replace( pattern, replacement );
	}

	fs.writeFileSync( filePath, content );
}

function writeDesktopPackageLockVersion( rootDir, version ) {
	const relativePath = 'apps/desktop/package-lock.json';
	const filePath = path.join( rootDir, relativePath );
	const data = JSON.parse( fs.readFileSync( filePath, 'utf8' ) );

	data.version = version;
	if ( ! data.packages || ! data.packages[ '' ] ) {
		throw new Error(
			`Could not update ${ relativePath }; missing root package.`
		);
	}
	data.packages[ '' ].version = version;

	fs.writeFileSync( filePath, `${ JSON.stringify( data, null, '\t' ) }\n` );
}

export function bumpReleaseVersion( rootDir, version ) {
	assertVersion( version );

	for ( const relativePath of VERSIONED_JSON_FILES ) {
		writeJsonVersion( rootDir, relativePath, version );
	}

	writeDesktopPackageLockVersion( rootDir, version );

	updateTextFile( rootDir, 'cortext.php', [
		[
			/^ \* Version:\s*\d+\.\d+\.\d+$/m,
			` * Version:           ${ version }`,
		],
		[
			/define\( 'CORTEXT_VERSION', '\d+\.\d+\.\d+' \);/,
			`define( 'CORTEXT_VERSION', '${ version }' );`,
		],
	] );

	updateTextFile( rootDir, 'readme.txt', [
		[ /^Stable tag:\s*\d+\.\d+\.\d+$/m, `Stable tag: ${ version }` ],
	] );
}

async function main() {
	const version = process.argv[ 2 ];
	if ( ! version ) {
		throw new Error(
			'Usage: node scripts/bump-release-version.mjs <version>'
		);
	}

	bumpReleaseVersion( process.cwd(), version.trim() );
}

if (
	process.argv[ 1 ] &&
	path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url )
) {
	main().catch( ( error ) => {
		console.error( error.message );
		process.exit( 1 );
	} );
}
