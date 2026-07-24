const { app, BrowserWindow, Menu } = require( 'electron' );
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
const RUNTIME_ORIGIN = `http://127.0.0.1:${ PORT }`;

let runtimeHandle = null;
let quitting = false;

function configureE2EUserData() {
	if ( process.env.CORTEXT_E2E !== '1' ) {
		return;
	}

	const configuredPath = process.env.CORTEXT_E2E_USER_DATA_DIR;
	if ( ! configuredPath ) {
		throw new Error(
			'CORTEXT_E2E_USER_DATA_DIR is required when CORTEXT_E2E=1.'
		);
	}

	const userDataPath = path.resolve( configuredPath );
	fs.mkdirSync( userDataPath, { recursive: true } );
	if ( ! fs.statSync( userDataPath ).isDirectory() ) {
		throw new Error(
			`CORTEXT_E2E_USER_DATA_DIR is not a directory: ${ userDataPath }`
		);
	}
	app.setPath( 'userData', userDataPath );
}

function hasOrigin( requestUrl, origin ) {
	try {
		return new URL( requestUrl ).origin === origin;
	} catch {
		return false;
	}
}

function getRequestHeader( requestHeaders, name ) {
	const headerName = Object.keys( requestHeaders ).find(
		( header ) => header.toLowerCase() === name.toLowerCase()
	);
	return headerName ? requestHeaders[ headerName ] : undefined;
}

function hasTrustedRuntimeInitiator( details, webContents ) {
	if (
		details.webContentsId !== webContents.id ||
		webContents.isDestroyed()
	) {
		return false;
	}

	const currentUrl = webContents.getURL();
	const isSameOriginRequest =
		getRequestHeader(
			details.requestHeaders,
			'Sec-Fetch-Site'
		)?.toLowerCase() === 'same-origin';
	if (
		details.resourceType === 'mainFrame' ||
		details.resourceType === 'subFrame'
	) {
		if (
			details.resourceType === 'mainFrame' &&
			currentUrl === LOADING_URL
		) {
			return true;
		}
		if (
			details.resourceType === 'mainFrame' &&
			! hasOrigin( currentUrl, RUNTIME_ORIGIN )
		) {
			return false;
		}
		return isSameOriginRequest;
	}

	return (
		isSameOriginRequest &&
		( hasOrigin( details.frame?.url, RUNTIME_ORIGIN ) ||
			hasOrigin( details.referrer, RUNTIME_ORIGIN ) )
	);
}

function installRuntimeAuthHeader( webContents, authToken ) {
	// Observe every destination so a redirect cannot carry the private header
	// away from the runtime. Only Cortext content in this window may receive it.
	webContents.session.webRequest.onBeforeSendHeaders(
		{ urls: [ '<all_urls>' ] },
		( details, callback ) => {
			const existingHeaders = Object.keys(
				details.requestHeaders
			).filter(
				( header ) =>
					header.toLowerCase() === RUNTIME_AUTH_HEADER.toLowerCase()
			);
			const shouldAuthenticate =
				hasOrigin( details.url, RUNTIME_ORIGIN ) &&
				hasTrustedRuntimeInitiator( details, webContents );

			if ( existingHeaders.length === 0 && ! shouldAuthenticate ) {
				callback( {} );
				return;
			}

			const requestHeaders = { ...details.requestHeaders };
			for ( const header of existingHeaders ) {
				delete requestHeaders[ header ];
			}
			if ( shouldAuthenticate ) {
				requestHeaders[ RUNTIME_AUTH_HEADER ] = authToken;
			}
			callback( { requestHeaders } );
		}
	);
}

configureE2EUserData();

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

function createWindow() {
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
		await win.loadFile( path.resolve( __dirname, 'error.html' ) );
	}
}

app.whenReady().then( async () => {
	let win = null;
	try {
		const authToken = crypto.randomBytes( 32 ).toString( 'hex' );

		if (
			process.platform === 'darwin' &&
			app.dock &&
			fs.existsSync( APP_ICON )
		) {
			app.dock.setIcon( APP_ICON );
		}

		refreshMenu();
		win = createWindow();
		installRuntimeAuthHeader( win.webContents, authToken );
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
			win.loadFile( path.resolve( __dirname, 'error.html' ) );
		} else {
			app.quit();
		}
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
