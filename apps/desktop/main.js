const {
	app,
	BrowserWindow,
	dialog,
	Menu,
	session,
	shell,
} = require( 'electron' );
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
	isTrustedRuntimeFrame,
} = require( './lib/runtime-session' );
const {
	scheduleUpdateCheck,
	checkForUpdatesInteractive,
	isUpdateReadyToInstall,
	setAutoDownload,
} = require( './lib/auto-update' );
const {
	ensureSiteFromSnapshot,
	refreshSiteIfOutdated,
	recoverInterruptedSwap,
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
// The local shell pages Cortext loads itself, before and instead of the runtime.
const TRUSTED_DOCUMENT_URLS = [ LOADING_URL, ERROR_URL ];

// One instance owns the extracted site and the runtime port. A second launch
// would extract on top of the first one's half-written files, so hand focus
// back to the window already running and leave.
if ( ! app.requestSingleInstanceLock() ) {
	app.exit( 0 );
}

let runtimeHandle = null;
let removeRuntimeAuthHeader = null;
let quitting = false;
const childWindows = new Set();
let allowQuit = false;
let updaterQuitRequested = false;
let runtimeStopPromise = null;
let appQuitPromise = null;

function getSiteRoot() {
	return path.join( app.getPath( 'userData' ), 'site' );
}

function stopRuntimeBeforeQuit() {
	quitting = true;
	if ( ! runtimeStopPromise ) {
		runtimeStopPromise = Promise.resolve()
			.then( () => stopRuntime( runtimeHandle ) )
			.then( () => {
				runtimeHandle = null;
				if ( removeRuntimeAuthHeader ) {
					removeRuntimeAuthHeader();
					removeRuntimeAuthHeader = null;
				}
			} )
			.catch( ( error ) => {
				runtimeStopPromise = null;
				quitting = false;
				throw error;
			} );
	}
	return runtimeStopPromise;
}

function quitAfterRuntimeStops() {
	if ( appQuitPromise ) {
		return appQuitPromise;
	}
	appQuitPromise = stopRuntimeBeforeQuit()
		.then( () => {
			allowQuit = true;
			app.quit();
			return true;
		} )
		.catch( ( err ) => {
			console.error(
				'[cortext-desktop] failed to stop PHP before quitting:',
				err
			);
			runtimeStopPromise = null;
			appQuitPromise = null;
			quitting = false;
			dialog.showErrorBox(
				"Cortext couldn't quit",
				`The local PHP process is still running. Try quitting Cortext again.\n\n${ String(
					err?.message || err
				) }`
			);
			return false;
		} );
	return appQuitPromise;
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

function isAllowedTopLevelUrl( url ) {
	return (
		hasOrigin( url, RUNTIME_ORIGIN ) ||
		TRUSTED_DOCUMENT_URLS.includes( url )
	);
}

// Third-party frames may render so blocks such as Embed keep working. They
// cannot reach the runtime: the token only rides on requests whose frame origin
// is Cortext's own, and that origin is inherited, not claimed.
function isAllowedFrameUrl( url ) {
	if ( url === 'about:blank' || url === 'about:srcdoc' ) {
		return true;
	}
	// The editor canvas is a blob: frame, which carries the runtime origin.
	if ( hasOrigin( url, RUNTIME_ORIGIN ) ) {
		return true;
	}
	try {
		return [ 'http:', 'https:' ].includes( new URL( url ).protocol );
	} catch {
		return false;
	}
}

function isAllowedDocumentUrl( url, isMainFrame ) {
	return isMainFrame ? isAllowedTopLevelUrl( url ) : isAllowedFrameUrl( url );
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
		if ( ! isAllowedTopLevelUrl( event.url ) ) {
			event.preventDefault();
			openExternalUrl( event.url );
			return;
		}
		// An embedded frame must not be able to steer the app window, even to a
		// runtime address.
		if (
			! isTrustedRuntimeFrame(
				event.initiator,
				RUNTIME_ORIGIN,
				TRUSTED_DOCUMENT_URLS
			)
		) {
			event.preventDefault();
		}
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
	win.on( 'close', ( event ) => {
		// electron-updater closes all windows before it emits before-quit. Allow
		// the windows to close; before-quit will wait for PHP.
		if ( allowQuit || updaterQuitRequested ) {
			return;
		}
		event.preventDefault();
		void quitAfterRuntimeStops();
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
				updaterQuitRequested = true;
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
			trustedDocumentUrls: TRUSTED_DOCUMENT_URLS,
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
		console.log( `[cortext-desktop] preparing site at ${ siteRoot }` );
		await ensureSiteFromSnapshot( {
			snapshotZip: SNAPSHOT_ZIP,
			siteRoot,
			version: app.getVersion(),
		} );
		if ( quitting ) {
			return;
		}
		// Update bundled WordPress/Cortext files before PHP starts. User data
		// stays in place.
		await refreshSiteIfOutdated( {
			snapshotZip: SNAPSHOT_ZIP,
			siteRoot,
			version: app.getVersion(),
		} );
		if ( quitting ) {
			return;
		}
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

app.on( 'second-instance', () => {
	const [ existing ] = BrowserWindow.getAllWindows();
	if ( ! existing ) {
		return;
	}
	if ( existing.isMinimized() ) {
		existing.restore();
	}
	existing.focus();
} );

app.on( 'window-all-closed', () => {
	app.quit();
} );

app.on( 'before-quit', ( event ) => {
	quitting = true;
	if ( allowQuit ) {
		return;
	}
	event.preventDefault();
	void quitAfterRuntimeStops();
} );
