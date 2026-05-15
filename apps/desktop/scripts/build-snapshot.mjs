#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const DESKTOP_DIR = resolve( __dirname, '..' );
const REPO_ROOT = resolve( DESKTOP_DIR, '..', '..' );
const WORK_DIR = resolve( DESKTOP_DIR, '.snapshot-work' );
const STAGED_PLUGIN = resolve( WORK_DIR, 'cortext' );
const OUTFILE = resolve( DESKTOP_DIR, 'snapshot.zip' );
const BLUEPRINT = resolve( DESKTOP_DIR, 'blueprint.json' );
const CLI = resolve( REPO_ROOT, 'node_modules', '.bin', 'wp-playground-cli' );

const PLUGIN_INCLUDES = [
	'cortext.php',
	'readme.txt',
	'LICENSE',
	'includes',
	'build',
	'templates',
	'src/blocks',
	'seed-assets',
	'vendor',
];

function run( cmd, opts = {} ) {
	execSync( cmd, { stdio: 'inherit', ...opts } );
}

console.log( '[snapshot] Building plugin assets' );
run( 'npm run build', { cwd: REPO_ROOT } );

console.log( '[snapshot] Staging plugin files' );
rmSync( WORK_DIR, { recursive: true, force: true } );
mkdirSync( STAGED_PLUGIN, { recursive: true } );
for ( const entry of PLUGIN_INCLUDES ) {
	const src = resolve( REPO_ROOT, entry );
	if ( ! existsSync( src ) ) {
		continue;
	}
	const dest = resolve( STAGED_PLUGIN, entry );
	mkdirSync( dirname( dest ), { recursive: true } );
	cpSync( src, dest, { recursive: true } );
}

console.log( '[snapshot] Running wp-playground-cli build-snapshot' );
rmSync( OUTFILE, { force: true } );
run(
	[
		CLI,
		'build-snapshot',
		`--blueprint=${ BLUEPRINT }`,
		'--wp=6.9',
		`--mount=${ STAGED_PLUGIN }:/wordpress/wp-content/plugins/cortext`,
		`--outfile=${ OUTFILE }`,
	].join( ' ' )
);

console.log( '[snapshot] Cleaning staging dir' );
rmSync( WORK_DIR, { recursive: true, force: true } );

console.log( `[snapshot] Done. Output: ${ OUTFILE }` );
