#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const TYPE_LABELS = new Map( [
	[ 'type: enhancement', 'Enhancements' ],
	[ 'type: bug', 'Bug fixes' ],
	[ 'type: docs', 'Documentation' ],
	[ 'type: tooling', 'Tooling' ],
	[ 'type: code quality', 'Code quality' ],
] );

const TYPE_ORDER = [
	'Enhancements',
	'Bug fixes',
	'Documentation',
	'Tooling',
	'Code quality',
];

function parseArgs() {
	const args = process.argv.slice( 2 );
	const options = {
		repo: process.env.GITHUB_REPOSITORY || 'Automattic/cortext',
		milestone: '',
		version: '',
		strict: false,
	};

	for ( let i = 0; i < args.length; i++ ) {
		const arg = args[ i ];
		const next = args[ i + 1 ];
		if ( arg === '--repo' && next ) {
			options.repo = next;
			i++;
			continue;
		}
		if ( arg === '--milestone' && next ) {
			options.milestone = next;
			i++;
			continue;
		}
		if ( arg === '--version' && next ) {
			options.version = next;
			i++;
			continue;
		}
		if ( arg === '--strict' ) {
			options.strict = true;
			continue;
		}
		throw new Error( `Unknown or incomplete argument: ${ arg }` );
	}

	if ( ! options.milestone ) {
		throw new Error( 'Missing required --milestone value.' );
	}

	return options;
}

function ghJson( args ) {
	const result = spawnSync( 'gh', args, {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024 * 16,
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );

	if ( result.error ) {
		throw result.error;
	}
	if ( result.status !== 0 ) {
		throw new Error(
			result.stderr.trim() || `gh ${ args.join( ' ' ) } failed.`
		);
	}

	return JSON.parse( result.stdout || '[]' );
}

function normalizeTitle( title ) {
	const normalized = title
		.replace(
			/^(feat|feature|fix|bugfix|docs|build|chore|internal)(\([^)]+\))?!?:\s*/i,
			''
		)
		.trim();
	return normalized
		? normalized[ 0 ].toUpperCase() + normalized.slice( 1 )
		: title;
}

function sentence( text ) {
	return /[.!?]$/.test( text ) ? text : `${ text }.`;
}

function getTypeLabels( pr ) {
	return pr.labels
		.map( ( label ) => label.name )
		.filter( ( name ) => TYPE_LABELS.has( name.toLowerCase() ) );
}

function formatPr( pr ) {
	const title = sentence( normalizeTitle( pr.title ) );
	return `- ${ title } ([#${ pr.number }](${ pr.html_url || pr.url }))`;
}

async function main() {
	const options = parseArgs();
	const [ owner, repoName ] = options.repo.split( '/' );
	if ( ! owner || ! repoName ) {
		throw new Error( `Invalid --repo value: ${ options.repo }` );
	}

	const milestones = ghJson( [
		'api',
		`repos/${ owner }/${ repoName }/milestones`,
		'--method',
		'GET',
		'--paginate',
		'-f',
		'state=all',
	] );

	const milestone = milestones.find(
		( item ) => item.title === options.milestone
	);
	if ( ! milestone ) {
		throw new Error(
			`Cannot find milestone "${ options.milestone }" in ${ options.repo }.`
		);
	}

	const items = ghJson( [
		'api',
		`repos/${ owner }/${ repoName }/issues`,
		'--method',
		'GET',
		'--paginate',
		'-f',
		'state=closed',
		'-f',
		`milestone=${ milestone.number }`,
	] );

	const pullRequests = items
		.filter( ( item ) => item.pull_request )
		.sort( ( a, b ) => a.number - b.number );

	const errors = [];
	const grouped = new Map( TYPE_ORDER.map( ( type ) => [ type, [] ] ) );

	for ( const pr of pullRequests ) {
		const typeLabels = getTypeLabels( pr );
		if ( typeLabels.length !== 1 ) {
			errors.push(
				`#${ pr.number } needs exactly one type:* label; found ${
					typeLabels.length ? typeLabels.join( ', ' ) : 'none'
				}.`
			);
			continue;
		}

		const section = TYPE_LABELS.get( typeLabels[ 0 ].toLowerCase() );
		grouped.get( section ).push( pr );
	}

	if ( errors.length && options.strict ) {
		throw new Error(
			`Release note classification failed:\n${ errors.join( '\n' ) }`
		);
	}

	const title = options.version
		? `# Cortext ${ options.version }`
		: `# ${ options.milestone }`;
	let notes = `${ title }\n\n`;

	if ( ! pullRequests.length ) {
		notes += 'No pull requests were found for this milestone.\n';
	} else {
		for ( const section of TYPE_ORDER ) {
			const prs = grouped.get( section );
			if ( ! prs.length ) {
				continue;
			}
			notes += `## ${ section }\n\n`;
			notes += `${ prs.map( formatPr ).join( '\n' ) }\n\n`;
		}
	}

	const contributors = [
		...new Set(
			pullRequests
				.map( ( pr ) => pr.user?.login )
				.filter( Boolean )
				.filter( ( login ) => ! login.endsWith( '[bot]' ) )
		),
	].sort( ( a, b ) => a.localeCompare( b ) );

	if ( contributors.length ) {
		notes += '## Contributors\n\n';
		notes += contributors.map( ( login ) => `@${ login }` ).join( ' ' );
		notes += '\n\n';
	}

	if ( errors.length ) {
		notes += '## Release note warnings\n\n';
		notes += errors.map( ( error ) => `- ${ error }` ).join( '\n' );
		notes += '\n';
	}

	process.stdout.write( notes );
}

main().catch( ( error ) => {
	console.error( error.message );
	process.exit( 1 );
} );
