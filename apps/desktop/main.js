const { app, BrowserWindow } = require( 'electron' );
const { spawn, spawnSync } = require( 'child_process' );
const path = require( 'path' );
const fs = require( 'fs' );

const PORT = 9402;
const SNAPSHOT_ZIP = path.resolve( __dirname, 'snapshot.zip' );

let phpProcess = null;
let phpReady = null;
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
	// macOS `unzip` can exit 1 for warnings such as "stripped absolute path".
	// Treat extraction as successful only if the WordPress files appear below.
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

function startPhp( wordpressDir ) {
	const routerPath = path.join( wordpressDir, 'router.php' );
	if ( ! fs.existsSync( routerPath ) ) {
		throw new Error(
			`router.php not found at ${ routerPath }. The snapshot is missing runtime files.`
		);
	}
	console.log(
		`[cortext-desktop] starting PHP server (127.0.0.1:${ PORT }) against ${ wordpressDir }`
	);
	phpProcess = spawn(
		'php',
		[
			'-S',
			`127.0.0.1:${ PORT }`,
			'-t',
			wordpressDir,
			routerPath,
		],
		{
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);

	// PHP writes its "Development Server ... started" line to stderr after
	// binding the port. Wait for that before loading the admin screen.
	phpReady = new Promise( ( resolve, reject ) => {
		const timer = setTimeout( () => {
			reject( new Error( 'PHP server startup timed out (30s)' ) );
		}, 30000 );
		phpProcess.stdout.on( 'data', ( chunk ) => {
			process.stdout.write( chunk );
		} );
		phpProcess.stderr.on( 'data', ( chunk ) => {
			const text = chunk.toString();
			process.stderr.write( text );
			if (
				text.includes( 'Development Server' ) &&
				text.includes( 'started' )
			) {
				clearTimeout( timer );
				resolve();
			}
		} );
		phpProcess.once( 'exit', () => {
			clearTimeout( timer );
			reject( new Error( 'PHP server exited before reporting ready' ) );
		} );
	} );

	phpProcess.on( 'exit', ( code ) => {
		console.log( `[cortext-desktop] php exited (code=${ code })` );
		if ( ! quitting ) {
			app.quit();
		}
	} );
}

function stopPhp() {
	if ( phpProcess && ! phpProcess.killed ) {
		phpProcess.kill( 'SIGTERM' );
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
		await phpReady;
		await win.loadURL(
			`http://127.0.0.1:${ PORT }/wp-admin/admin.php?page=cortext`
		);
		if ( process.env.CORTEXT_DEVTOOLS !== '0' ) {
			win.webContents.openDevTools( { mode: 'detach' } );
		}
	} catch ( err ) {
		console.error( '[cortext-desktop] failed to reach PHP server:', err );
		await win.loadFile( path.resolve( __dirname, 'error.html' ) );
	}
}

app.whenReady().then( () => {
	try {
		const wordpressDir = ensureSiteFromSnapshot();
		startPhp( wordpressDir );
		createWindow();
	} catch ( err ) {
		console.error( '[cortext-desktop]', err );
		app.quit();
	}
} );

app.on( 'window-all-closed', () => {
	quitting = true;
	stopPhp();
	if ( process.platform !== 'darwin' ) {
		app.quit();
	}
} );

app.on( 'before-quit', () => {
	quitting = true;
	stopPhp();
} );
