import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import test from 'node:test';

const require = createRequire( import.meta.url );
const Module = require( 'node:module' );

function requireWithMocks( modulePath, mocks ) {
	const resolved = require.resolve( modulePath );
	delete require.cache[ resolved ];

	const originalLoad = Module._load;
	Module._load = function ( request, parent, isMain ) {
		if ( Object.hasOwn( mocks, request ) ) {
			return mocks[ request ];
		}
		return originalLoad.call( this, request, parent, isMain );
	};

	try {
		return require( resolved );
	} finally {
		Module._load = originalLoad;
	}
}

function runtimeHandle() {
	return {
		origin: 'http://127.0.0.1:9403',
		port: 9403,
		ready: Promise.resolve(),
	};
}

function loadMain(
	app,
	stopRuntime,
	showErrorBox = () => {},
	{
		BrowserWindow = class {},
		ensureSiteFromSnapshot = async () => {},
		installRuntimeAuthHeader = () => () => {},
		Menu = {},
		refreshSiteIfOutdated = async () => {},
		runtimeSession = {
			clearStorageData: async () => {},
		},
		scheduleUpdateCheck = () => {},
		startRuntime = runtimeHandle,
	} = {}
) {
	// Every test here runs as the instance that holds the lock.
	app.requestSingleInstanceLock ??= () => true;
	requireWithMocks( '../main.js', {
		electron: {
			app,
			BrowserWindow,
			dialog: { showErrorBox },
			Menu,
			protocol: {
				registerSchemesAsPrivileged: () => {},
			},
			session: {
				fromPartition: () => runtimeSession,
			},
			shell: {
				openExternal: async () => {},
			},
		},
		'./lib/runtime': {
			LEGACY_PORT: 9402,
			RUNTIME_AUTH_HEADER: 'X-Cortext-Desktop-Token',
			isValidPort: ( port ) =>
				Number.isInteger( port ) && port >= 1 && port <= 65535,
			startRuntime,
			stopRuntime,
		},
		'./lib/runtime-session': {
			hasOrigin: ( value, origin ) => {
				try {
					return new URL( value ).origin === origin;
				} catch {
					return false;
				}
			},
			installRuntimeAuthHeader,
			isTrustedRuntimeFrame: () => true,
		},
		'./lib/session-permissions': {
			installSessionPermissions: () => {},
		},
		'./lib/shell-protocol': {
			ERROR_URL: 'cortext-shell://app/error',
			LOADING_URL: 'cortext-shell://app/loading',
			installShellProtocol: () => {},
			registerShellScheme: () => {},
		},
		'./lib/auto-update': {
			scheduleUpdateCheck,
			checkForUpdatesInteractive: () => {},
			isUpdateReadyToInstall: () => false,
			setAutoDownload: () => {},
		},
		'./lib/site-refresh': {
			ensureSiteFromSnapshot,
			refreshSiteIfOutdated,
			recoverInterruptedSwap: () => {},
		},
		'./lib/menu': { buildAppMenu: () => [] },
		'./lib/settings': {
			get: ( key ) => ( key === 'autoInstallUpdates' ? true : undefined ),
			set: () => {},
		},
	} );
}

function quitEvent() {
	return {
		preventDefaultCalled: false,
		preventDefault() {
			this.preventDefaultCalled = true;
		},
	};
}

test( 'a second instance leaves without touching the site', async () => {
	let exitCalls = 0;
	let ensureCalls = 0;

	const app = new EventEmitter();
	Object.assign( app, {
		isPackaged: false,
		name: 'Cortext',
		exit: () => {
			exitCalls += 1;
		},
		quit: () => {},
		requestSingleInstanceLock: () => false,
		whenReady: () => Promise.resolve(),
	} );

	loadMain(
		app,
		() => Promise.resolve(),
		() => {},
		{
			ensureSiteFromSnapshot: async () => {
				ensureCalls += 1;
			},
		}
	);
	await new Promise( ( resolve ) => setImmediate( resolve ) );

	assert.equal( exitCalls, 1 );
	assert.equal( ensureCalls, 0 );
} );

test( 'repeated before-quit events stop the runtime only once', async () => {
	let quitCalls = 0;
	let stopCalls = 0;
	let finishShutdown;
	const shutdownFinished = new Promise( ( resolve ) => {
		finishShutdown = resolve;
	} );

	const app = new EventEmitter();
	Object.assign( app, {
		isPackaged: false,
		name: 'Cortext',
		quit: () => {
			quitCalls += 1;
		},
		whenReady: () => new Promise( () => {} ),
	} );

	loadMain( app, () => {
		stopCalls += 1;
		return shutdownFinished;
	} );

	const firstEvent = quitEvent();
	const secondEvent = quitEvent();
	app.emit( 'before-quit', firstEvent );
	app.emit( 'before-quit', secondEvent );
	await Promise.resolve();

	assert.equal( firstEvent.preventDefaultCalled, true );
	assert.equal( secondEvent.preventDefaultCalled, true );
	assert.equal( stopCalls, 1 );
	assert.equal( quitCalls, 0 );

	finishShutdown();
	await new Promise( ( resolve ) => setImmediate( resolve ) );
	assert.equal( quitCalls, 1 );
} );

test( 'before-quit keeps the app open after a stop failure and retries on the next quit', async () => {
	let quitCalls = 0;
	let stopCalls = 0;
	const errors = [];
	const app = new EventEmitter();
	Object.assign( app, {
		isPackaged: false,
		name: 'Cortext',
		quit: () => {
			quitCalls += 1;
		},
		whenReady: () => new Promise( () => {} ),
	} );

	loadMain(
		app,
		() => {
			stopCalls += 1;
			return Promise.reject( new Error( 'PHP is still running' ) );
		},
		( title, message ) => errors.push( { title, message } )
	);

	const event = quitEvent();
	app.emit( 'before-quit', event );
	await new Promise( ( resolve ) => setImmediate( resolve ) );

	assert.equal( event.preventDefaultCalled, true );
	assert.equal( quitCalls, 0 );
	assert.equal( stopCalls, 1 );
	assert.equal( errors.length, 1 );
	assert.match( errors[ 0 ].message, /PHP is still running/ );

	app.emit( 'before-quit', quitEvent() );
	await new Promise( ( resolve ) => setImmediate( resolve ) );
	assert.equal( stopCalls, 2 );
	assert.equal( quitCalls, 0 );
	assert.equal( errors.length, 2 );
} );

test( 'updater closes the window, then waits for the runtime before quitting', async () => {
	let quitCalls = 0;
	let stopCalls = 0;
	let finishShutdown;
	let updaterOptions = null;
	let removeRuntimeAuthHeaderCalls = 0;
	const windows = [];
	const shutdownFinished = new Promise( ( resolve ) => {
		finishShutdown = resolve;
	} );

	class FakeWindow extends EventEmitter {
		constructor( options ) {
			super();
			this.webContents = new EventEmitter();
			Object.assign( this.webContents, {
				openDevTools: () => {},
				session: options.webPreferences.session,
				setWindowOpenHandler: () => {},
			} );
			windows.push( this );
		}

		loadFile() {
			return Promise.resolve();
		}

		loadURL() {
			return Promise.resolve();
		}

		setTitle() {}
	}

	const app = new EventEmitter();
	Object.assign( app, {
		isPackaged: false,
		name: 'Cortext',
		getPath: ( name ) => `/tmp/cortext-${ name }`,
		getVersion: () => '1.0.0',
		quit: () => {
			quitCalls += 1;
		},
		whenReady: () => Promise.resolve(),
	} );

	loadMain(
		app,
		() => {
			stopCalls += 1;
			return shutdownFinished;
		},
		undefined,
		{
			BrowserWindow: FakeWindow,
			installRuntimeAuthHeader: () => () => {
				removeRuntimeAuthHeaderCalls += 1;
			},
			Menu: { setApplicationMenu: () => {} },
			scheduleUpdateCheck: ( options ) => {
				updaterOptions = options;
			},
			startRuntime: runtimeHandle,
		}
	);

	for ( let attempt = 0; attempt < 5 && ! updaterOptions; attempt++ ) {
		await new Promise( ( resolve ) => setImmediate( resolve ) );
	}
	assert.ok( updaterOptions );
	assert.equal( windows.length, 1 );

	updaterOptions.prepareQuit();
	const closeEvent = quitEvent();
	windows[ 0 ].emit( 'close', closeEvent );
	assert.equal( closeEvent.preventDefaultCalled, false );

	const beforeQuitEvent = quitEvent();
	app.emit( 'before-quit', beforeQuitEvent );
	await Promise.resolve();
	assert.equal( beforeQuitEvent.preventDefaultCalled, true );
	assert.equal( stopCalls, 1 );
	assert.equal( quitCalls, 0 );
	assert.equal( removeRuntimeAuthHeaderCalls, 0 );

	finishShutdown();
	await new Promise( ( resolve ) => setImmediate( resolve ) );
	assert.equal( quitCalls, 1 );
	assert.equal( removeRuntimeAuthHeaderCalls, 1 );
} );

test( 'closing during site preparation never starts the runtime', async () => {
	let finishExtraction;
	let quitCalls = 0;
	let refreshCalls = 0;
	let startCalls = 0;
	let stopCalls = 0;
	const windows = [];
	const extractionFinished = new Promise( ( resolve ) => {
		finishExtraction = resolve;
	} );

	class FakeWindow extends EventEmitter {
		constructor( options ) {
			super();
			this.webContents = new EventEmitter();
			Object.assign( this.webContents, {
				openDevTools: () => {},
				session: options.webPreferences.session,
				setWindowOpenHandler: () => {},
			} );
			windows.push( this );
		}

		loadFile() {
			return Promise.resolve();
		}

		loadURL() {
			return Promise.resolve();
		}

		setTitle() {}
	}

	const app = new EventEmitter();
	Object.assign( app, {
		isPackaged: false,
		name: 'Cortext',
		getPath: ( name ) => `/tmp/cortext-${ name }`,
		getVersion: () => '1.0.0',
		quit: () => {
			quitCalls += 1;
		},
		whenReady: () => Promise.resolve(),
	} );

	loadMain(
		app,
		async () => {
			stopCalls += 1;
		},
		undefined,
		{
			BrowserWindow: FakeWindow,
			ensureSiteFromSnapshot: () => extractionFinished,
			Menu: { setApplicationMenu: () => {} },
			refreshSiteIfOutdated: async () => {
				refreshCalls += 1;
			},
			startRuntime: () => {
				startCalls += 1;
				return runtimeHandle();
			},
		}
	);

	for ( let attempt = 0; attempt < 5 && windows.length === 0; attempt++ ) {
		await new Promise( ( resolve ) => setImmediate( resolve ) );
	}
	assert.equal( windows.length, 1 );

	const closeEvent = quitEvent();
	windows[ 0 ].emit( 'close', closeEvent );
	await new Promise( ( resolve ) => setImmediate( resolve ) );
	assert.equal( closeEvent.preventDefaultCalled, true );
	assert.equal( stopCalls, 1 );
	assert.equal( quitCalls, 1 );

	finishExtraction();
	await new Promise( ( resolve ) => setImmediate( resolve ) );
	assert.equal( refreshCalls, 0 );
	assert.equal( startCalls, 0 );
} );

test( 'closing while runtime storage is cleared never finishes startup', async () => {
	let finishStorageClear;
	let markStorageClearStarted;
	let installHeaderCalls = 0;
	let runtimeLoadCalls = 0;
	let quitCalls = 0;
	let stopCalls = 0;
	const windows = [];
	const storageClearFinished = new Promise( ( resolve ) => {
		finishStorageClear = resolve;
	} );
	const storageClearStarted = new Promise( ( resolve ) => {
		markStorageClearStarted = resolve;
	} );

	class FakeWindow extends EventEmitter {
		constructor( options ) {
			super();
			this.webContents = new EventEmitter();
			Object.assign( this.webContents, {
				openDevTools: () => {},
				session: options.webPreferences.session,
				setWindowOpenHandler: () => {},
			} );
			windows.push( this );
		}

		loadFile() {
			return Promise.resolve();
		}

		loadURL( url ) {
			if ( url.startsWith( 'http://127.0.0.1:' ) ) {
				runtimeLoadCalls += 1;
			}
			return Promise.resolve();
		}

		setTitle() {}
	}

	const app = new EventEmitter();
	Object.assign( app, {
		isPackaged: false,
		name: 'Cortext',
		getPath: ( name ) => `/tmp/cortext-${ name }`,
		getVersion: () => '1.0.0',
		quit: () => {
			quitCalls += 1;
		},
		whenReady: () => Promise.resolve(),
	} );

	loadMain(
		app,
		async () => {
			stopCalls += 1;
		},
		undefined,
		{
			BrowserWindow: FakeWindow,
			installRuntimeAuthHeader: () => {
				installHeaderCalls += 1;
				return () => {};
			},
			Menu: { setApplicationMenu: () => {} },
			runtimeSession: {
				clearStorageData: () => {
					markStorageClearStarted();
					return storageClearFinished;
				},
			},
			startRuntime: runtimeHandle,
		}
	);

	await storageClearStarted;
	assert.equal( windows.length, 1 );

	const closeEvent = quitEvent();
	windows[ 0 ].emit( 'close', closeEvent );
	await new Promise( ( resolve ) => setImmediate( resolve ) );
	assert.equal( closeEvent.preventDefaultCalled, true );
	assert.equal( stopCalls, 1 );
	assert.equal( quitCalls, 1 );

	finishStorageClear();
	await new Promise( ( resolve ) => setImmediate( resolve ) );
	assert.equal( installHeaderCalls, 0 );
	assert.equal( runtimeLoadCalls, 0 );
} );
