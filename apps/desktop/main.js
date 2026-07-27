const { app, BrowserWindow, Menu, session, shell } = require( 'electron' );
const { spawnSync } = require( 'child_process' );
const crypto = require( 'crypto' );
const path = require( 'path' );
const fs = require( 'fs' );
const { pathToFileURL } = require( 'url' );
const {
	DEFAULT_PORT: PORT,
	RUNTIME_AUTH_HEADER,
	startRuntime,
	stopRuntime,
} = require( './lib/runtime' );
const {
	hasOrigin,
	installRuntimeAuthHeader,
} = require( './lib/runtime-session' );
const {
	scheduleUpdateCheck,
	checkForUpdatesInteractive,
	isUpdateReadyToInstall,
	setAutoDownload,
} = require( './lib/auto-update' );
const {
	refreshSiteIfOutdated,
	recoverInterruptedSwap,
	writeMarker,
} = require( './lib/site-refresh' );
const { buildAppMenu } = require( './lib/menu' );
const settings = require( './lib/settings' );

// Bundled resources (the snapshot and the PHP runtime) sit next to the app in
// dev and under `process.resourcesPath` once packaged into the .app.
const RESOURCES_DIR = app.isPackaged ? process.resourcesPath : __dirname;
const SNAPSHOT_ZIP = path.join( RESOURCES_DIR, 'snapshot.zip' );
const APP_ICON = path.join( __dirname, 'assets/icon.png' );
const LOADING_PAGE = path.resolve( __dirname, 'loading.html' );
const LOADING_URL = pathToFileURL( LOADING_PAGE ).href;
const ERROR_PAGE = path.resolve( __dirname, 'error.html' );
const ERROR_URL = pathToFileURL( ERROR_PAGE ).href;
const RUNTIME_ORIGIN = `http://127.0.0.1:${ PORT }`;
const RUNTIME_SESSION_PARTITION = 'persist:cortext';

let runtimeHandle = null;
let removeRuntimeAuthHeader = null;
let quitting = false;
const childWindows = new Set();

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
	writeMarker( siteRoot, app.getVersion() );
	return wordpressDir;
}

function refreshMenu() {
	Menu.setApplicationMenu(
		buildAppMenu( {
			updateLabel: isUpdateReadyToInstall()
				? 'Restart to Apply Update'
				: 'Check for Updates…',
			onUpdateItem: () => checkForUpdatesInteractive(),
			autoInstallUpdates: settings.get( 'autoInstallUpdates' ),
			onToggleAutoInstall: ( enabled ) => {
				settings.set( 'autoInstallUpdates', enabled );
				setAutoDownload( enabled );
			},
		} )
	);
}

function isAllowedDocumentUrl( url, isMainFrame ) {
	if ( hasOrigin( url, RUNTIME_ORIGIN ) ) {
		return true;
	}
	if ( ! isMainFrame ) {
		return url === 'about:blank' || url === 'about:srcdoc';
	}
	return url === LOADING_URL || url === ERROR_URL;
}

function openExternalUrl( url ) {
	let protocol;
	try {
		protocol = new URL( url ).protocol;
	} catch {
		return;
	}
	if ( ! [ 'http:', 'https:', 'mailto:' ].includes( protocol ) ) {
		return;
	}

	setImmediate( () => {
		shell.openExternal( url ).catch( ( error ) => {
			console.error(
				'[cortext-desktop] failed to open external link:',
				error
			);
		} );
	} );
}

function secureWebPreferences( webPreferences, runtimeSession ) {
	const inheritedPreferences = { ...( webPreferences || {} ) };
	delete inheritedPreferences.partition;
	delete inheritedPreferences.preload;
	delete inheritedPreferences.session;
	return {
		...inheritedPreferences,
		session: runtimeSession,
		contextIsolation: true,
		nodeIntegration: false,
		nodeIntegrationInWorker: false,
		nodeIntegrationInSubFrames: false,
		sandbox: true,
		webviewTag: false,
		webSecurity: true,
		allowRunningInsecureContent: false,
	};
}

function configureTrustedWindow( win, runtimeSession ) {
	win.on( 'page-title-updated', ( event ) => {
		event.preventDefault();
		win.setTitle( 'Cortext' );
	} );

	const { webContents } = win;
	webContents.on( 'will-navigate', ( event ) => {
		if ( isAllowedDocumentUrl( event.url, true ) ) {
			return;
		}
		event.preventDefault();
		openExternalUrl( event.url );
	} );
	webContents.on( 'will-frame-navigate', ( event ) => {
		if ( event.isMainFrame || isAllowedDocumentUrl( event.url, false ) ) {
			return;
		}
		event.preventDefault();
	} );
	webContents.on( 'will-redirect', ( event ) => {
		if ( isAllowedDocumentUrl( event.url, event.isMainFrame ) ) {
			return;
		}
		event.preventDefault();
	} );
	webContents.setWindowOpenHandler( ( { url } ) => {
		if ( ! hasOrigin( url, RUNTIME_ORIGIN ) ) {
			openExternalUrl( url );
			return { action: 'deny' };
		}

		return {
			action: 'allow',
			createWindow: ( options ) =>
				createInternalWindow( options, runtimeSession, win )
					.webContents,
		};
	} );
}

function createInternalWindow( options, runtimeSession, parent ) {
	const windowOptions = { ...options };
	const { webPreferences } = windowOptions;
	delete windowOptions.webPreferences;
	if (
		windowOptions.webContents &&
		windowOptions.webContents.session !== runtimeSession
	) {
		windowOptions.webContents.close( { waitForBeforeUnload: false } );
		throw new Error(
			'Refusing to create an internal window outside the runtime session.'
		);
	}
	const child = new BrowserWindow( {
		...windowOptions,
		parent,
		title: 'Cortext',
		icon: APP_ICON,
		backgroundColor: '#1d1d1d',
		webPreferences: secureWebPreferences( webPreferences, runtimeSession ),
	} );
	if ( child.webContents.session !== runtimeSession ) {
		child.destroy();
		throw new Error(
			'Internal window was created outside the runtime session.'
		);
	}
	childWindows.add( child );
	child.once( 'closed', () => {
		childWindows.delete( child );
	} );
	configureTrustedWindow( child, runtimeSession );
	return child;
}

function createWindow( runtimeSession ) {
	const win = new BrowserWindow( {
		width: 1280,
		height: 800,
		title: 'Cortext',
		icon: APP_ICON,
		backgroundColor: '#1d1d1d',
		webPreferences: secureWebPreferences( {}, runtimeSession ),
	} );

	configureTrustedWindow( win, runtimeSession );
	return win;
}

async function loadSite( win ) {
	try {
		await runtimeHandle.ready;
		await win.loadURL(
			`http://127.0.0.1:${ PORT }/wp-admin/admin.php?page=cortext`
		);
		if ( ! app.isPackaged && process.env.CORTEXT_DEVTOOLS !== '0' ) {
			win.webContents.openDevTools( { mode: 'detach' } );
		}
		scheduleUpdateCheck( {
			window: win,
			onState: refreshMenu,
			prepareQuit: () => {
				quitting = true;
			},
			autoDownload: settings.get( 'autoInstallUpdates' ),
		} );
	} catch ( err ) {
		console.error( '[cortext-desktop] failed to reach PHP server:', err );
		await win.loadFile( ERROR_PAGE );
	}
}

app.whenReady().then( async () => {
	let win = null;
	try {
		const authToken = crypto.randomBytes( 32 ).toString( 'hex' );
		const runtimeSession = session.fromPartition(
			RUNTIME_SESSION_PARTITION,
			{ cache: false }
		);
		await runtimeSession.clearStorageData( {
			origin: RUNTIME_ORIGIN,
			storages: [ 'cookies', 'serviceworkers', 'cachestorage' ],
		} );
		removeRuntimeAuthHeader = installRuntimeAuthHeader( runtimeSession, {
			authHeader: RUNTIME_AUTH_HEADER,
			authToken,
			runtimeOrigin: RUNTIME_ORIGIN,
		} );

		if (
			process.platform === 'darwin' &&
			app.dock &&
			fs.existsSync( APP_ICON )
		) {
			app.dock.setIcon( APP_ICON );
		}

		refreshMenu();
		win = createWindow( runtimeSession );
		// Load the loading screen before any site refresh so users never stare at
		// a blank window.
		await win.loadFile( LOADING_PAGE );

		const siteRoot = getSiteRoot();
		recoverInterruptedSwap( siteRoot );
		ensureSiteFromSnapshot();
		// Update bundled WordPress/Cortext files before PHP starts. User data
		// stays in place.
		refreshSiteIfOutdated( {
			snapshotZip: SNAPSHOT_ZIP,
			siteRoot,
			version: app.getVersion(),
		} );
		const wordpressDir = path.join( siteRoot, 'wordpress' );

		runtimeHandle = startRuntime( {
			appDir: RESOURCES_DIR,
			authToken,
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

		await loadSite( win );
	} catch ( err ) {
		console.error( '[cortext-desktop]', err );
		if ( win ) {
			win.loadFile( ERROR_PAGE );
		} else {
			app.quit();
		}
	}
} );

function stopDesktopRuntime() {
	stopRuntime( runtimeHandle );
	runtimeHandle = null;
	if ( removeRuntimeAuthHeader ) {
		removeRuntimeAuthHeader();
		removeRuntimeAuthHeader = null;
	}
}

app.on( 'window-all-closed', () => {
	quitting = true;
	stopDesktopRuntime();
	app.quit();
} );

app.on( 'before-quit', () => {
	quitting = true;
	stopDesktopRuntime();
} );
