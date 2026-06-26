const { spawnSync } = require( 'child_process' );
const fs = require( 'fs' );
const path = require( 'path' );
const { parseVersion, isNewer } = require( './version' );

// The extracted site stores the app version that created it. When a newer app
// ships a newer snapshot, refresh the code and keep user data.
const MARKER_FILE = '.cortext-snapshot-version';
const BAK_PREFIX = '.cortext-wordpress-bak-';
const NEXT_PREFIX = '.next-';

// Desktop disables wp-admin file edits and plugin/theme installs
// (DISALLOW_FILE_MODS). For this app, the SQLite database, uploads, and
// generated wp-config are the user state we carry across a code refresh. Paths
// are relative to the WordPress root.
const PRESERVE = [
	'wp-content/database',
	'wp-content/uploads',
	'wp-config.php',
];

function markerPath( siteRoot ) {
	return path.join( siteRoot, MARKER_FILE );
}

function readMarker( siteRoot ) {
	try {
		return fs.readFileSync( markerPath( siteRoot ), 'utf8' ).trim();
	} catch {
		return null;
	}
}

function writeMarker( siteRoot, version ) {
	fs.mkdirSync( siteRoot, { recursive: true } );
	fs.writeFileSync( markerPath( siteRoot ), String( version ) );
}

function extractSnapshot( snapshotZip, dest ) {
	fs.mkdirSync( dest, { recursive: true } );
		// macOS `unzip` can exit 1 for warnings, such as stripped absolute paths.
		// Check the extracted files instead.
	spawnSync( 'unzip', [ '-q', '-o', snapshotZip, '-d', dest ], {
		stdio: [ 'ignore', 'ignore', 'ignore' ],
	} );
	if ( ! fs.existsSync( path.join( dest, 'wordpress/index.php' ) ) ) {
		throw new Error( `Snapshot extraction failed under ${ dest }` );
	}
}

function carryOver( fromWordpress, toWordpress ) {
	for ( const rel of PRESERVE ) {
		const src = path.join( fromWordpress, rel );
		if ( ! fs.existsSync( src ) ) {
			continue;
		}
		const dest = path.join( toWordpress, rel );
		fs.rmSync( dest, { recursive: true, force: true } );
		fs.mkdirSync( path.dirname( dest ), { recursive: true } );
		fs.cpSync( src, dest, { recursive: true } );
	}
}

// If the app was killed after the old tree was stashed but before the new tree
// landed, restore the user's site before first-run extraction can seed a fresh
// one.
function recoverInterruptedSwap( siteRoot ) {
	if ( ! fs.existsSync( siteRoot ) ) {
		return;
	}
		// Remove scratch extraction dirs left by a killed refresh so they do not
		// pile up.
	for ( const name of fs.readdirSync( siteRoot ) ) {
		if ( name.startsWith( NEXT_PREFIX ) ) {
			fs.rmSync( path.join( siteRoot, name ), {
				recursive: true,
				force: true,
			} );
		}
	}
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	if ( fs.existsSync( wordpressDir ) ) {
		return;
	}
	const baks = fs
		.readdirSync( siteRoot )
		.filter( ( name ) => name.startsWith( BAK_PREFIX ) )
		.sort();
	if ( baks.length ) {
		fs.renameSync(
			path.join( siteRoot, baks[ baks.length - 1 ] ),
			wordpressDir
		);
	}
}

// Refresh the extracted site's code from the bundled snapshot when this app is
// newer than the marker. Keep the user's database, uploads, and wp-config.
// Returns true when it swapped files.
function refreshSiteIfOutdated( { snapshotZip, siteRoot, version } ) {
	recoverInterruptedSwap( siteRoot );

	const wordpressDir = path.join( siteRoot, 'wordpress' );
	if ( ! fs.existsSync( wordpressDir ) ) {
			// No site has been extracted yet; first-run extraction writes the marker.
		return false;
	}

	const markerString = readMarker( siteRoot );
	const current = parseVersion( version );
	const marker = parseVersion( markerString );
		// Exact same build, including prerelease suffix: no refresh needed.
	if ( markerString && markerString === String( version ) ) {
		return false;
	}
		// Never downgrade. If the marker is numerically newer, the user already ran
		// a build ahead of this bundle; replacing code under that database could
		// break it. parseVersion compares only the numeric core, so same-core
		// prereleases (0.2.0-rc.1 -> 0.2.0-rc.2) still refresh, matching the app
		// binary swap.
	if ( current && marker && isNewer( marker, current ) ) {
		return false;
	}
	if ( ! fs.existsSync( snapshotZip ) ) {
		return false;
	}

	const stamp = `${ Date.now() }-${ process.pid }`;
	const nextSite = path.join( siteRoot, `.next-${ stamp }` );
	const bakDir = path.join( siteRoot, `${ BAK_PREFIX }${ stamp }` );

	fs.rmSync( nextSite, { recursive: true, force: true } );
	try {
		extractSnapshot( snapshotZip, nextSite );
		carryOver( wordpressDir, path.join( nextSite, 'wordpress' ) );

			// Keep the swap on one volume. Each rename is atomic: stash the live
			// tree, promote the new tree, restore the stash if promotion fails.
		fs.renameSync( wordpressDir, bakDir );
		try {
			fs.renameSync( path.join( nextSite, 'wordpress' ), wordpressDir );
		} catch ( swapErr ) {
			fs.renameSync( bakDir, wordpressDir );
			throw swapErr;
		}

		writeMarker( siteRoot, version );
		fs.rmSync( bakDir, { recursive: true, force: true } );
		fs.rmSync( nextSite, { recursive: true, force: true } );
		console.log( `[cortext-desktop] site refreshed to ${ version }` );
		return true;
	} catch ( err ) {
		fs.rmSync( nextSite, { recursive: true, force: true } );
		console.log( '[cortext-desktop] site refresh skipped:', err.message );
		return false;
	}
}

module.exports = {
	refreshSiteIfOutdated,
	recoverInterruptedSwap,
	readMarker,
	writeMarker,
	MARKER_FILE,
	BAK_PREFIX,
	PRESERVE,
};
