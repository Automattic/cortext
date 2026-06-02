const { app, BrowserWindow } = require( 'electron' );
const { spawnSync } = require( 'child_process' );
const path = require( 'path' );
const fs = require( 'fs' );
const {
	DEFAULT_PORT: PORT,
	startRuntime,
	stopRuntime,
} = require( './lib/runtime' );
const { scheduleUpdateCheck } = require( './lib/update-check' );

// Bundled resources (the snapshot and the PHP runtime) sit next to the app in
// dev and under `process.resourcesPath` once packaged into the .app.
const RESOURCES_DIR = app.isPackaged ? process.resourcesPath : __dirname;
const SNAPSHOT_ZIP = path.join( RESOURCES_DIR, 'snapshot.zip' );
const APP_ICON = path.join( __dirname, 'assets/icon.png' );

let runtimeHandle = null;
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
	spawnSync( 'unzip', [ '-q', '-o', SNAPSHOT_ZIP, '-d', siteRoot ], {
		stdio: [ 'ignore', 'ignore', 'ignore' ],
	} );
	if ( ! fs.existsSync( path.join( wordpressDir, 'index.php' ) ) ) {
		throw new Error(
			`Snapshot extraction failed: ${ wordpressDir } is empty.`
		);
	}
	return wordpressDir;
}

async function createWindow() {
	const win = new BrowserWindow( {
		width: 1280,
		height: 800,
		title: 'Cortext',
		icon: APP_ICON,
		backgroundColor: '#1d1d1d',
		webPreferences: {
			contextIsolation: true,
		},
	} );

	win.on( 'page-title-updated', ( event ) => {
		event.preventDefault();
		win.setTitle( 'Cortext' );
	} );

	await win.loadFile( path.resolve( __dirname, 'loading.html' ) );

	try {
		await runtimeHandle.ready;
		await win.loadURL(
			`http://127.0.0.1:${ PORT }/wp-admin/admin.php?page=cortext`
		);
		if ( ! app.isPackaged && process.env.CORTEXT_DEVTOOLS !== '0' ) {
			win.webContents.openDevTools( { mode: 'detach' } );
		}
		scheduleUpdateCheck();
	} catch ( err ) {
		console.error( '[cortext-desktop] failed to reach PHP server:', err );
		await win.loadFile( path.resolve( __dirname, 'error.html' ) );
	}
}

app.whenReady().then( () => {
	try {
		if (
			process.platform === 'darwin' &&
			app.dock &&
			fs.existsSync( APP_ICON )
		) {
			app.dock.setIcon( APP_ICON );
		}

		const wordpressDir = ensureSiteFromSnapshot();
		runtimeHandle = startRuntime( {
			appDir: RESOURCES_DIR,
			wordpressDir,
			runtimeStateDir: path.join(
				app.getPath( 'temp' ),
				'cortext-desktop-runtime'
			),
			onUnexpectedExit: () => {
				if ( ! quitting ) {
					app.quit();
				}
			},
		} );
		createWindow();
	} catch ( err ) {
		console.error( '[cortext-desktop]', err );
		app.quit();
	}
} );

app.on( 'window-all-closed', () => {
	quitting = true;
	stopRuntime( runtimeHandle );
	app.quit();
} );

app.on( 'before-quit', () => {
	quitting = true;
	stopRuntime( runtimeHandle );
} );
