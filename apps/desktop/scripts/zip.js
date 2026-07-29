const fs = require( 'fs' );
const path = require( 'path' );
const yazl = require( 'yazl' );

function walkDirectory( dir, relativeDir = '' ) {
	const entries = [];
	for ( const entry of fs.readdirSync( dir, { withFileTypes: true } ) ) {
		const relativePath = path.posix.join(
			relativeDir,
			entry.name.replace( /\\/g, '/' )
		);
		const absolutePath = path.join( dir, entry.name );
		if ( entry.isSymbolicLink() ) {
			throw new Error(
				`Symbolic links cannot be added to ZIP files: ${ absolutePath }`
			);
		}
		if ( entry.isDirectory() ) {
			entries.push( {
				type: 'directory',
				relativePath: `${ relativePath }/`,
			} );
			entries.push( ...walkDirectory( absolutePath, relativePath ) );
		} else if ( entry.isFile() ) {
			entries.push( {
				type: 'file',
				absolutePath,
				relativePath,
			} );
		}
	}
	return entries;
}

function zipDirectory(
	sourceDir,
	archivePath,
	rootName = path.basename( sourceDir )
) {
	const archive = new yazl.ZipFile();
	const normalizedRoot = rootName.replace( /\\/g, '/' ).replace( /\/+$/, '' );
	for ( const entry of walkDirectory( sourceDir ) ) {
		const archiveEntry = path.posix.join(
			normalizedRoot,
			entry.relativePath
		);
		if ( entry.type === 'directory' ) {
			archive.addEmptyDirectory( archiveEntry );
		} else {
			archive.addFile( entry.absolutePath, archiveEntry );
		}
	}

	fs.mkdirSync( path.dirname( archivePath ), { recursive: true } );
	return new Promise( ( resolve, reject ) => {
		const output = fs.createWriteStream( archivePath );
		let failure = null;
		// yazl reports a file it cannot stat or read on the ZipFile itself, not
		// on its output stream.
		const fail = ( error ) => {
			if ( failure ) {
				return;
			}
			failure = error;
			output.destroy();
		};
		const finish = () => {
			if ( ! failure ) {
				resolve();
				return;
			}
			// Never leave a half-written archive where a caller can mistake it
			// for a finished one.
			fs.rmSync( archivePath, { force: true } );
			reject( failure );
		};
		archive.once( 'error', fail );
		archive.outputStream.once( 'error', fail );
		output.once( 'error', fail );
		output.once( 'close', finish );
		archive.outputStream.pipe( output );
		archive.end();
	} );
}

module.exports = { zipDirectory };
