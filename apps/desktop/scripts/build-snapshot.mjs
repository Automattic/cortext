#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	cpSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const DESKTOP_DIR = resolve( __dirname, '..' );
const REPO_ROOT = resolve( DESKTOP_DIR, '..', '..' );
const WORK_DIR = resolve( DESKTOP_DIR, '.snapshot-work' );
const CACHE_DIR = resolve( DESKTOP_DIR, '.snapshot-cache' );
const STAGED_PLUGIN = resolve( WORK_DIR, 'cortext' );
const SITE_DIR = resolve( WORK_DIR, 'wordpress' );
const RUNTIME_DIR = resolve( DESKTOP_DIR, 'runtime' );
const OUTFILE = resolve( DESKTOP_DIR, 'snapshot.zip' );

const WP_VERSION = '6.9';
const WP_DOWNLOAD_URL = `https://wordpress.org/wordpress-${ WP_VERSION }.zip`;
const SQLITE_PLUGIN_URL =
	'https://downloads.wordpress.org/plugin/sqlite-database-integration.latest-stable.zip';
const WP_CLI_PHAR_URL =
	'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar';

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

function shellQuote( value ) {
	return `'${ String( value ).replace( /'/g, "'\\''" ) }'`;
}

function commandExists( command ) {
	if ( command.includes( '/' ) ) {
		return existsSync( command ) ? command : null;
	}
	const result = spawnSync( 'which', [ command ], {
		stdio: [ 'ignore', 'pipe', 'ignore' ],
		encoding: 'utf8',
	} );
	return result.status === 0 ? result.stdout.trim() : null;
}

function resolvePhpBin() {
	const configured = process.env.CORTEXT_PHP_BIN;
	if ( configured ) {
		const resolved = commandExists( configured );
		if ( resolved ) {
			return resolved;
		}
		throw new Error( `CORTEXT_PHP_BIN points to a missing executable: ${ configured }` );
	}
	const bundled = resolve( RUNTIME_DIR, 'bin/php' );
	if ( existsSync( bundled ) ) {
		return bundled;
	}
	const fromPath = commandExists( 'php' );
	if ( fromPath ) {
		return fromPath;
	}
	throw new Error(
		'Missing php. Install PHP 8.1+, set CORTEXT_PHP_BIN, or bundle apps/desktop/runtime/bin/php.'
	);
}

// macOS `unzip` can exit 1 for warnings, including archives with stored
// absolute paths. Callers verify the files they need after extraction.
function unzipQuiet( zipPath, dest ) {
	spawnSync(
		'unzip',
		[ '-q', '-o', zipPath, '-d', dest ],
		{ stdio: [ 'ignore', 'ignore', 'ignore' ] }
	);
}

function downloadFile( url, dest ) {
	return new Promise( ( resolveDownload, rejectDownload ) => {
		const file = createWriteStream( dest );
		https
			.get( url, ( response ) => {
				if (
					response.statusCode === 301 ||
					response.statusCode === 302
				) {
					downloadFile( response.headers.location, dest ).then(
						resolveDownload,
						rejectDownload
					);
					return;
				}
				if ( response.statusCode !== 200 ) {
					rejectDownload(
						new Error(
							`Download failed: ${ url } returned ${ response.statusCode }`
						)
					);
					return;
				}
				response.pipe( file );
				file.on( 'finish', () =>
					file.close( () => resolveDownload() )
				);
			} )
			.on( 'error', rejectDownload );
	} );
}

async function ensureCachedDownload( url, cachePath ) {
	if ( existsSync( cachePath ) ) {
		return cachePath;
	}
	mkdirSync( dirname( cachePath ), { recursive: true } );
	await downloadFile( url, cachePath );
	return cachePath;
}

function randomSalt() {
	// 64 ASCII chars, matching WP's generated salt length.
	return randomBytes( 48 ).toString( 'base64' ).slice( 0, 64 );
}

function buildWpConfig() {
	const constants = [
		[ 'DB_NAME', 'database_name_here' ],
		[ 'DB_USER', 'username_here' ],
		[ 'DB_PASSWORD', 'password_here' ],
		[ 'DB_HOST', 'localhost' ],
		[ 'DB_CHARSET', 'utf8mb4' ],
		[ 'DB_COLLATE', '' ],
	];
	const saltKeys = [
		'AUTH_KEY',
		'SECURE_AUTH_KEY',
		'LOGGED_IN_KEY',
		'NONCE_KEY',
		'AUTH_SALT',
		'SECURE_AUTH_SALT',
		'LOGGED_IN_SALT',
		'NONCE_SALT',
	];
	const lines = [ '<?php' ];
	for ( const [ name, value ] of constants ) {
		lines.push( `define( '${ name }', '${ value }' );` );
	}
	for ( const key of saltKeys ) {
		lines.push( `define( '${ key }', '${ randomSalt() }' );` );
	}
	lines.push( "$table_prefix = 'wp_';" );
	lines.push(
		"if ( ! defined( 'WP_HOME' ) ) { define( 'WP_HOME', 'http://127.0.0.1:9402' ); }"
	);
	lines.push(
		"if ( ! defined( 'WP_SITEURL' ) ) { define( 'WP_SITEURL', 'http://127.0.0.1:9402' ); }"
	);
	lines.push(
		"if ( ! defined( 'CORTEXT_DESKTOP' ) ) { define( 'CORTEXT_DESKTOP', true ); }"
	);
	lines.push(
		"if ( ! defined( 'DISABLE_WP_CRON' ) ) { define( 'DISABLE_WP_CRON', true ); }"
	);
	lines.push( "$GLOBALS['cortext_desktop_request_start'] = microtime( true );" );
	lines.push( "if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', __DIR__ . '/' ); }" );
	lines.push( "require_once ABSPATH . 'wp-settings.php';" );
	return lines.join( '\n' ) + '\n';
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

console.log( `[snapshot] Fetching WordPress ${ WP_VERSION }` );
const wpZipPath = resolve( CACHE_DIR, `wordpress-${ WP_VERSION }.zip` );
await ensureCachedDownload( WP_DOWNLOAD_URL, wpZipPath );
unzipQuiet( wpZipPath, WORK_DIR );
if ( ! existsSync( resolve( SITE_DIR, 'index.php' ) ) ) {
	throw new Error( `WordPress extraction failed: ${ SITE_DIR } missing index.php` );
}

console.log( '[snapshot] Installing sqlite-database-integration plugin' );
const sqliteZipPath = resolve( CACHE_DIR, 'sqlite-database-integration.zip' );
await ensureCachedDownload( SQLITE_PLUGIN_URL, sqliteZipPath );
const pluginsDir = resolve( SITE_DIR, 'wp-content/plugins' );
unzipQuiet( sqliteZipPath, pluginsDir );
if (
	! existsSync(
		resolve( pluginsDir, 'sqlite-database-integration/db.copy' )
	)
) {
	throw new Error(
		'sqlite-database-integration plugin extraction failed: db.copy not found'
	);
}
cpSync(
	resolve( pluginsDir, 'sqlite-database-integration/db.copy' ),
	resolve( SITE_DIR, 'wp-content/db.php' )
);

console.log( '[snapshot] Installing Cortext plugin' );
cpSync( STAGED_PLUGIN, resolve( pluginsDir, 'cortext' ), { recursive: true } );

console.log( '[snapshot] Adding runtime files (router + worker + mu-plugins)' );
cpSync(
	resolve( RUNTIME_DIR, 'router.php' ),
	resolve( SITE_DIR, 'router.php' )
);
cpSync(
	resolve( RUNTIME_DIR, 'worker.php' ),
	resolve( SITE_DIR, 'worker.php' )
);
const muPluginsDest = resolve( SITE_DIR, 'wp-content/mu-plugins' );
mkdirSync( muPluginsDest, { recursive: true } );
cpSync( resolve( RUNTIME_DIR, 'mu-plugins' ), muPluginsDest, {
	recursive: true,
} );

console.log( '[snapshot] Writing wp-config.php' );
writeFileSync( resolve( SITE_DIR, 'wp-config.php' ), buildWpConfig() );

console.log( `[snapshot] Fetching wp-cli` );
const wpCliPhar = resolve( CACHE_DIR, 'wp-cli.phar' );
await ensureCachedDownload( WP_CLI_PHAR_URL, wpCliPhar );
const PHP_BIN = resolvePhpBin();

function wpCli( args ) {
	run(
		`${ shellQuote( PHP_BIN ) } ${ shellQuote( wpCliPhar ) } --path=${ shellQuote(
			SITE_DIR
		) } ${ args }`
	);
}

console.log( '[snapshot] Installing WordPress' );
wpCli(
	'core install ' +
		'--url=http://127.0.0.1:9402 ' +
		'--title=Cortext ' +
		'--admin_user=admin ' +
		`--admin_password=${ randomSalt().replace( /[^A-Za-z0-9]/g, '' ).slice( 0, 24 ) } ` +
		'--admin_email=admin@example.com ' +
		'--skip-email'
);

console.log( '[snapshot] Activating Cortext' );
wpCli( 'plugin activate cortext' );

console.log( '[snapshot] Seeding sample content' );
wpCli( 'cortext seed' );

console.log( '[snapshot] Zipping site' );
rmSync( OUTFILE, { force: true } );
run( `cd "${ WORK_DIR }" && zip -q -r "${ OUTFILE }" wordpress` );

console.log( '[snapshot] Cleaning staging dir' );
rmSync( WORK_DIR, { recursive: true, force: true } );

console.log( `[snapshot] Done. Output: ${ OUTFILE }` );
