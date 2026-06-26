const { app } = require( 'electron' );
const fs = require( 'fs' );
const path = require( 'path' );

const DEFAULTS = {
	// Download updates in the background and install them after the user
	// restarts. When off, ask before downloading and do not install on quit.
	autoInstallUpdates: true,
};

let cache = null;

function settingsPath() {
	return path.join( app.getPath( 'userData' ), 'settings.json' );
}

function readAll() {
	if ( cache ) {
		return cache;
	}
	try {
		cache = {
			...DEFAULTS,
			...JSON.parse( fs.readFileSync( settingsPath(), 'utf8' ) ),
		};
	} catch {
		cache = { ...DEFAULTS };
	}
	return cache;
}

function get( key ) {
	return readAll()[ key ];
}

// Write through a sibling temp file, then rename it over settings.json. A
// crash mid-write leaves the old file intact.
function set( key, value ) {
	const next = { ...readAll(), [ key ]: value };
	const file = settingsPath();
	const tmp = `${ file }.${ process.pid }.tmp`;
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	fs.writeFileSync( tmp, JSON.stringify( next, null, 2 ) );
	fs.renameSync( tmp, file );
	cache = next;
	return value;
}

module.exports = { get, set, DEFAULTS };
