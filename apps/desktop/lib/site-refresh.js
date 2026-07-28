const fs = require( 'fs' );
const path = require( 'path' );
const { extractZip } = require( './archive' );
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

async function extractSnapshot( snapshotZip, dest ) {
	fs.mkdirSync( dest, { recursive: true } );
	await extractZip( snapshotZip, dest );
	if ( ! fs.existsSync( path.join( dest, 'wordpress/index.php' ) ) ) {
		throw new Error(
			`Snapshot extraction failed: wordpress/index.php is missing from ${ dest }.`
		);
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

function backupDirectories( siteRoot, prefix = BAK_PREFIX ) {
	return fs
		.readdirSync( siteRoot )
		.filter( ( name ) => name.startsWith( prefix ) )
		.sort();
}

// A previous process may have installed a complete tree and exited before
// deleting its first-run backup. Copy the user data from each backup into the
// live tree before deleting it. This also preserves the original data when two
// app processes start at the same time.
function reconcileBackupsIntoLiveSite( siteRoot ) {
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	if ( ! fs.existsSync( path.join( wordpressDir, 'index.php' ) ) ) {
		return;
	}
	for ( const name of backupDirectories(
		siteRoot,
		`${ BAK_PREFIX }first-run-`
	) ) {
		const backupDir = path.join( siteRoot, name );
		carryOver( backupDir, wordpressDir );
		fs.rmSync( backupDir, { recursive: true, force: true } );
	}
}

// If the app stopped after renaming the old tree but before installing the new
// one, restore the backup before the next first-run extraction.
function recoverInterruptedSwap( siteRoot ) {
	if ( ! fs.existsSync( siteRoot ) ) {
		return;
	}
	// Remove temporary extraction directories left by an interrupted refresh.
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
		reconcileBackupsIntoLiveSite( siteRoot );
		return;
	}
	const baks = backupDirectories( siteRoot );
	if ( baks.length ) {
		fs.renameSync(
			path.join( siteRoot, baks[ baks.length - 1 ] ),
			wordpressDir
		);
	}
}

// Extract a new site into a temporary directory. If Electron exits before
// extraction finishes, the next launch deletes the temporary directory and
// retries, so WordPress does not start from a partial tree.
async function ensureSiteFromSnapshot( { snapshotZip, siteRoot, version } ) {
	recoverInterruptedSwap( siteRoot );

	const wordpressDir = path.join( siteRoot, 'wordpress' );
	const wordpressIndex = path.join( wordpressDir, 'index.php' );
	if ( fs.existsSync( wordpressIndex ) ) {
		return wordpressDir;
	}
	if ( ! fs.existsSync( snapshotZip ) ) {
		throw new Error(
			`No snapshot was found at ${ snapshotZip }. Run 'npm run snapshot' in apps/desktop.`
		);
	}

	fs.mkdirSync( siteRoot, { recursive: true } );
	const stamp = `${ Date.now() }-${ process.pid }`;
	const nextSite = path.join( siteRoot, `.next-first-run-${ stamp }` );
	fs.rmSync( nextSite, { recursive: true, force: true } );

	try {
		await extractSnapshot( snapshotZip, nextSite );

		// Another launch may finish extraction first. Keep its valid WordPress
		// tree instead of replacing it.
		if ( ! fs.existsSync( wordpressIndex ) ) {
			const nextWordpress = path.join( nextSite, 'wordpress' );
			const liveTreeExists = fs.existsSync( wordpressDir );
			const bakDir = path.join(
				siteRoot,
				`${ BAK_PREFIX }first-run-${ stamp }`
			);

			// An incomplete code tree may still contain the user's database,
			// uploads, and wp-config. Copy them into the extracted tree before
			// backing up the current directory.
			if ( liveTreeExists ) {
				carryOver( wordpressDir, nextWordpress );
				fs.renameSync( wordpressDir, bakDir );
			}
			let promoted = false;
			try {
				fs.renameSync( nextWordpress, wordpressDir );
				promoted = true;
				writeMarker( siteRoot, version );
			} catch ( swapError ) {
				if (
					! promoted &&
					fs.existsSync( path.join( wordpressDir, 'index.php' ) )
				) {
					// Another process installed its tree first. Copy the user data
					// from the first-run backup into that tree.
					reconcileBackupsIntoLiveSite( siteRoot );
					return wordpressDir;
				}
				if ( promoted ) {
					fs.rmSync( wordpressDir, {
						recursive: true,
						force: true,
					} );
				}
				if ( liveTreeExists && fs.existsSync( bakDir ) ) {
					fs.renameSync( bakDir, wordpressDir );
				}
				throw swapError;
			}
			reconcileBackupsIntoLiveSite( siteRoot );
		}
		return wordpressDir;
	} finally {
		fs.rmSync( nextSite, { recursive: true, force: true } );
	}
}

// Refresh the extracted site's code from the bundled snapshot when this app is
// newer than the marker. Keep the user's database, uploads, and wp-config.
// Returns true when it replaces the code.
async function refreshSiteIfOutdated( { snapshotZip, siteRoot, version } ) {
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
		await extractSnapshot( snapshotZip, nextSite );
		carryOver( wordpressDir, path.join( nextSite, 'wordpress' ) );

		// Keep both directories on one volume so each rename is atomic. Back up
		// the live tree, install the new one, and restore the backup if needed.
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
		console.log( '[cortext-desktop] could not refresh site:', err.message );
		return false;
	}
}

module.exports = {
	ensureSiteFromSnapshot,
	refreshSiteIfOutdated,
	recoverInterruptedSwap,
	readMarker,
	writeMarker,
	MARKER_FILE,
	BAK_PREFIX,
	PRESERVE,
};
