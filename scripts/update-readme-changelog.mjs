#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const STOP_SECTIONS = new Set( [
	'Contributors',
	'Release note warnings',
	'Installing the macOS app',
] );

function assertVersion( version ) {
	if ( ! VERSION_PATTERN.test( version ) ) {
		throw new Error(
			`Release versions must use the WordPress-style format 0.1.0, without a leading "v". Received "${ version }".`
		);
	}
}

export function buildWordPressChangelog( version, releaseNotes ) {
	assertVersion( version );

	const lines = releaseNotes.replaceAll( '\r\n', '\n' ).split( '\n' );
	const titleIndex = lines.findIndex(
		( line ) => line.trim() === `# Cortext ${ version }`
	);
	if ( titleIndex === -1 ) {
		throw new Error(
			`Release notes must start with the heading "# Cortext ${ version }".`
		);
	}

	const changelogLines = [];
	for ( const line of lines.slice( titleIndex + 1 ) ) {
		const section = line.match( /^## (.+)$/ );
		if ( section ) {
			if ( STOP_SECTIONS.has( section[ 1 ] ) ) {
				break;
			}
			changelogLines.push( `${ section[ 1 ] }:` );
			continue;
		}

		const area = line.match( /^### (.+)$/ );
		if ( area ) {
			changelogLines.push( `**${ area[ 1 ] }**` );
			continue;
		}

		changelogLines.push( line.replace( /^- /, '* ' ) );
	}

	while ( changelogLines[ 0 ] === '' ) {
		changelogLines.shift();
	}
	while ( changelogLines.at( -1 ) === '' ) {
		changelogLines.pop();
	}

	if ( ! changelogLines.length ) {
		throw new Error( `Release notes for ${ version } have no changelog.` );
	}

	return `= ${ version } =\n${ changelogLines.join( '\n' ) }\n`;
}

export function upsertReadmeChangelog( readme, version, releaseNotes ) {
	const changelog = buildWordPressChangelog( version, releaseNotes );
	const changelogSection = /^== Changelog ==$/m.exec( readme );
	if ( ! changelogSection ) {
		throw new Error(
			'readme.txt is missing the "== Changelog ==" section.'
		);
	}

	const versionHeadings = [
		...readme.matchAll( /^= (\d+\.\d+\.\d+) =$/gm ),
	].filter( ( match ) => match.index > changelogSection.index );
	const existingIndex = versionHeadings.findIndex(
		( match ) => match[ 1 ] === version
	);

	if ( existingIndex !== -1 ) {
		const existing = versionHeadings[ existingIndex ];
		const next = versionHeadings[ existingIndex + 1 ];
		const end = next?.index ?? readme.length;
		return `${ readme.slice(
			0,
			existing.index
		) }${ changelog }\n${ readme.slice( end ) }`;
	}

	const insertAt = changelogSection.index + changelogSection[ 0 ].length;
	const remainder = readme.slice( insertAt ).replace( /^\n*/, '' );
	return `${ readme.slice( 0, insertAt ) }\n\n${ changelog }\n${ remainder }`;
}

function main() {
	const [ version, releaseNotesPath, readmePath = 'readme.txt' ] =
		process.argv.slice( 2 );
	if ( ! version || ! releaseNotesPath ) {
		throw new Error(
			'Usage: node scripts/update-readme-changelog.mjs <version> <release-notes-path> [readme-path]'
		);
	}

	const releaseNotes = fs.readFileSync( releaseNotesPath, 'utf8' );
	const readme = fs.readFileSync( readmePath, 'utf8' );
	fs.writeFileSync(
		readmePath,
		upsertReadmeChangelog( readme, version.trim(), releaseNotes )
	);
}

if (
	process.argv[ 1 ] &&
	path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url )
) {
	try {
		main();
	} catch ( error ) {
		console.error( error.message );
		process.exit( 1 );
	}
}
