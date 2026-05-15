const { app, BrowserWindow } = require( 'electron' );
const { spawn, spawnSync } = require( 'child_process' );
const path = require( 'path' );
const fs = require( 'fs' );
const http = require( 'http' );

const PUBLIC_PORT = 9402;
const PLAYGROUND_PORT = 9410;
const PLUGIN_ROOT = path.resolve( __dirname, '..', '..' );
const SNAPSHOT_ZIP = path.resolve( __dirname, 'snapshot.zip' );
const CLI_BIN = path.resolve( PLUGIN_ROOT, 'node_modules', '.bin', 'wp-playground-cli' );

// Extensions we serve straight from disk, bypassing PHP-WASM. Every request
// that goes through Playground costs ~50-100ms because it boots PHP and
// WordPress per request; for a thumbnail that's a static byte stream, that
// cost has no upside. Limiting the list to image MIME types keeps the
// fast-path safe from anything that needs WordPress's redirect/auth/router
// machinery (PHP files, admin endpoints, REST, etc.).
const STATIC_EXTENSIONS = new Set( [
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.webp',
	'.svg',
	'.ico',
	'.avif',
] );

const MIME_TYPES = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.avif': 'image/avif',
};

let playgroundProcess = null;
let playgroundReady = null;
let proxyServer = null;
let quitting = false;

function getSiteRoot() {
	return path.join( app.getPath( 'userData' ), 'site' );
}

function ensureSiteFromSnapshot() {
	const siteRoot = getSiteRoot();
	const wordpressDir = path.join( siteRoot, 'wordpress' );
	if ( fs.existsSync( wordpressDir ) ) {
		return wordpressDir;
	}
	if ( ! fs.existsSync( SNAPSHOT_ZIP ) ) {
		throw new Error(
			`Snapshot not found at ${ SNAPSHOT_ZIP }. Run 'npm run snapshot' from apps/desktop/.`
		);
	}
	console.log( `[cortext-desktop] extracting snapshot to ${ siteRoot }` );
	fs.mkdirSync( siteRoot, { recursive: true } );
	spawnSync(
		'unzip',
		[ '-q', '-o', SNAPSHOT_ZIP, '-d', siteRoot ],
		{ stdio: [ 'ignore', 'ignore', 'ignore' ] }
	);
	if ( ! fs.existsSync( path.join( wordpressDir, 'index.php' ) ) ) {
		throw new Error( `Snapshot extraction failed: ${ wordpressDir } is empty.` );
	}
	return wordpressDir;
}

function startPlayground( wordpressDir ) {
	playgroundProcess = spawn(
		CLI_BIN,
		[
			'server',
			'--mount', `${ wordpressDir }:/wordpress`,
			'--wordpress-install-mode', 'do-not-attempt-installing',
			'--login',
			'--port', String( PLAYGROUND_PORT ),
			'--site-url', `http://127.0.0.1:${ PUBLIC_PORT }`,
			'--wp', '6.9',
		],
		{
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			cwd: PLUGIN_ROOT,
		}
	);

	// Wait for the cli's "Ready!" line on stdout before letting the renderer
	// navigate. The cli binds the TCP port well before WordPress is wired up,
	// and any request that hits it during that window gets a 502 with body
	// "WordPress is not ready yet". Waiting on the explicit signal avoids
	// landing the user on that intermediate response.
	playgroundReady = new Promise( ( resolve, reject ) => {
		const timer = setTimeout( () => {
			reject( new Error( 'Playground startup timed out (120s)' ) );
		}, 120000 );
		let stdoutBuffer = '';
		playgroundProcess.stdout.on( 'data', ( chunk ) => {
			const text = chunk.toString();
			process.stdout.write( text );
			stdoutBuffer += text;
			if ( stdoutBuffer.includes( 'Ready! WordPress is running' ) ) {
				clearTimeout( timer );
				resolve();
			}
		} );
		playgroundProcess.stderr.on( 'data', ( chunk ) => {
			process.stderr.write( chunk );
		} );
		playgroundProcess.once( 'exit', () => {
			clearTimeout( timer );
			reject( new Error( 'Playground exited before reporting ready' ) );
		} );
	} );

	playgroundProcess.on( 'exit', ( code ) => {
		console.log( `[cortext-desktop] playground exited (code=${ code })` );
		if ( ! quitting ) {
			app.quit();
		}
	} );
}

function stopPlayground() {
	if ( playgroundProcess && ! playgroundProcess.killed ) {
		playgroundProcess.kill( 'SIGTERM' );
	}
}

function tryServeStaticUpload( req, res, wordpressDir ) {
	const url = new URL( req.url, `http://127.0.0.1:${ PUBLIC_PORT }` );
	if ( ! url.pathname.startsWith( '/wp-content/uploads/' ) ) {
		return false;
	}
	const ext = path.extname( url.pathname ).toLowerCase();
	if ( ! STATIC_EXTENSIONS.has( ext ) ) {
		return false;
	}
	const uploadsRoot = path.join( wordpressDir, 'wp-content', 'uploads' );
	const relative = url.pathname.slice( '/wp-content/uploads/'.length );
	const resolved = path.resolve( uploadsRoot, relative );
	// Reject any path that escapes the uploads dir via `..` or symlink
	// trickery. `path.resolve` collapses traversal, so the prefix check is
	// the actual safety guard.
	if ( ! resolved.startsWith( uploadsRoot + path.sep ) ) {
		res.writeHead( 403 );
		res.end();
		return true;
	}
	fs.stat( resolved, ( err, stat ) => {
		if ( err || ! stat.isFile() ) {
			// Fall through to PHP-WASM. WordPress may know how to serve
			// (or generate) this file even though it's not on disk where we
			// expect it.
			proxyToPlayground( req, res );
			return;
		}
		res.writeHead( 200, {
			'Content-Type': MIME_TYPES[ ext ] ?? 'application/octet-stream',
			'Content-Length': stat.size,
			'Cache-Control': 'public, max-age=31536000, immutable',
		} );
		fs.createReadStream( resolved ).pipe( res );
	} );
	return true;
}

function proxyToPlayground( req, res ) {
	const upstream = http.request(
		{
			host: '127.0.0.1',
			port: PLAYGROUND_PORT,
			path: req.url,
			method: req.method,
			headers: req.headers,
		},
		( upstreamRes ) => {
			res.writeHead( upstreamRes.statusCode, upstreamRes.headers );
			upstreamRes.pipe( res );
		}
	);
	upstream.on( 'error', ( err ) => {
		console.error( '[cortext-desktop] upstream error:', err.message );
		if ( ! res.headersSent ) {
			res.writeHead( 502 );
		}
		res.end();
	} );
	req.pipe( upstream );
}

function startProxy( wordpressDir ) {
	proxyServer = http.createServer( ( req, res ) => {
		// Static image fast-path. Anything that isn't an image upload, or
		// fails to resolve on disk, falls through to the cli on the
		// internal port (which still runs the full WordPress request cycle
		// in PHP-WASM).
		if ( ! tryServeStaticUpload( req, res, wordpressDir ) ) {
			proxyToPlayground( req, res );
		}
	} );
	proxyServer.listen( PUBLIC_PORT, '127.0.0.1' );
}

function stopProxy() {
	if ( proxyServer ) {
		proxyServer.close();
		proxyServer = null;
	}
}

async function createWindow() {
	const win = new BrowserWindow( {
		width: 1280,
		height: 800,
		title: 'Cortext',
		backgroundColor: '#1d1d1d',
		webPreferences: {
			contextIsolation: true,
		},
	} );

	await win.loadFile( path.resolve( __dirname, 'loading.html' ) );

	try {
		await playgroundReady;
		await win.loadURL( `http://127.0.0.1:${ PUBLIC_PORT }/wp-admin/admin.php?page=cortext` );
		if ( process.env.CORTEXT_DEVTOOLS !== '0' ) {
			win.webContents.openDevTools( { mode: 'detach' } );
		}
	} catch ( err ) {
		console.error( '[cortext-desktop] failed to reach Playground:', err );
		await win.loadFile( path.resolve( __dirname, 'error.html' ) );
	}
}

app.whenReady().then( () => {
	try {
		const wordpressDir = ensureSiteFromSnapshot();
		startPlayground( wordpressDir );
		startProxy( wordpressDir );
		createWindow();
	} catch ( err ) {
		console.error( '[cortext-desktop]', err );
		app.quit();
	}
} );

app.on( 'window-all-closed', () => {
	quitting = true;
	stopProxy();
	stopPlayground();
	if ( process.platform !== 'darwin' ) {
		app.quit();
	}
} );

app.on( 'before-quit', () => {
	quitting = true;
	stopProxy();
	stopPlayground();
} );
