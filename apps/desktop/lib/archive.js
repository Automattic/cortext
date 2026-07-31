const path = require( 'path' );
const extract = require( 'extract-zip' );
const yauzl = require( 'yauzl' );

function assertSafeEntryName( entryName, destination ) {
	const normalized = entryName.replace( /\\/g, '/' );
	if (
		! normalized ||
		normalized.includes( '\0' ) ||
		path.posix.isAbsolute( normalized ) ||
		/^[A-Za-z]:/.test( normalized )
	) {
		throw new Error( `Unsafe ZIP entry path: ${ entryName }` );
	}

	const segments = normalized.split( '/' ).filter( Boolean );
	if ( segments.includes( '..' ) ) {
		throw new Error( `Unsafe ZIP entry path: ${ entryName }` );
	}

	const root = path.resolve( destination );
	const target = path.resolve( root, ...segments );
	if ( target !== root && ! target.startsWith( `${ root }${ path.sep }` ) ) {
		throw new Error( `Unsafe ZIP entry path: ${ entryName }` );
	}
}

function assertSafeEntry( entry, destination ) {
	assertSafeEntryName( entry.fileName, destination );

	const unixMode = entry.externalFileAttributes >>> 16;
	const fileType = unixMode & 0xf000;
	// Match extract-zip by checking symlink mode bits for every creator platform.
	if ( fileType === 0xa000 ) {
		throw new Error(
			`ZIP entry is a symbolic link and cannot be extracted: ${ entry.fileName }`
		);
	}
}

// extract-zip creates parent directories before onEntry runs, so validate every
// entry first to avoid creating directories outside the destination.
function validateZipEntries( archivePath, destination ) {
	return new Promise( ( resolve, reject ) => {
		yauzl.open(
			archivePath,
			{ autoClose: true, lazyEntries: true },
			( openError, zipFile ) => {
				if ( openError ) {
					reject( openError );
					return;
				}

				let settled = false;
				const fail = ( error ) => {
					if ( settled ) {
						return;
					}
					settled = true;
					zipFile.close();
					reject( error );
				};

				zipFile.on( 'error', fail );
				zipFile.on( 'entry', ( entry ) => {
					try {
						assertSafeEntry( entry, destination );
						zipFile.readEntry();
					} catch ( error ) {
						fail( error );
					}
				} );
				zipFile.on( 'end', () => {
					if ( settled ) {
						return;
					}
					settled = true;
					resolve();
				} );
				zipFile.readEntry();
			}
		);
	} );
}

async function extractZip( archivePath, destination ) {
	const absoluteDestination = path.resolve( destination );
	await validateZipEntries( archivePath, absoluteDestination );
	await extract( archivePath, {
		dir: absoluteDestination,
		onEntry: ( entry ) => {
			assertSafeEntry( entry, absoluteDestination );
		},
	} );
}

module.exports = {
	assertSafeEntry,
	assertSafeEntryName,
	extractZip,
	validateZipEntries,
};
