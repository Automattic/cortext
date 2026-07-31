/**
 * Smoke test for desktop launch.
 *
 * This follows the first thing a user sees: extract the snapshot, start PHP,
 * open the window, and paint the first Cortext document. Deeper editor flows
 * can move here once the desktop surface settles.
 *
 * Requires `apps/desktop/snapshot.zip` to exist before running. CI builds
 * it in a separate step; locally, run `npm --prefix apps/desktop run
 * snapshot` first.
 */
const { test, expect, _electron: electron } = require( '@playwright/test' );
const { spawn } = require( 'node:child_process' );
const { once } = require( 'node:events' );
const http = require( 'node:http' );
const path = require( 'node:path' );
const {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} = require( 'node:fs' );
const os = require( 'node:os' );

const APP_PATH = path.resolve( __dirname, '..' );
const SNAPSHOT_PATH = path.join( APP_PATH, 'snapshot.zip' );
let e2eTempRoot;
let untrustedServer;
let untrustedOrigin;
let untrustedRequests;
let runtimeOrigin;

test.beforeAll( async () => {
	if ( ! existsSync( SNAPSHOT_PATH ) ) {
		throw new Error(
			`Missing ${ SNAPSHOT_PATH }. Run 'npm --prefix apps/desktop run snapshot' first.`
		);
	}
	e2eTempRoot = mkdtempSync(
		path.join( os.tmpdir(), 'cortext-desktop-e2e-' )
	);
	untrustedRequests = [];
	untrustedServer = http.createServer( ( request, response ) => {
		untrustedRequests.push( {
			url: request.url,
			runtimeToken: request.headers[ 'x-cortext-desktop-token' ],
		} );
		if ( request.url === '/redirect-runtime' ) {
			response.writeHead( 302, {
				'Cache-Control': 'no-store',
				Location: `${ runtimeOrigin }/wp-includes/images/blank.gif`,
			} );
			response.end();
			return;
		}

		response.writeHead( 200, {
			'Content-Type': 'text/html; charset=utf-8',
			'Referrer-Policy': 'no-referrer',
		} );
		response.end(
			`<!doctype html>
			<body data-runtime-image="pending">
				<img
					src="${ runtimeOrigin }/wp-includes/images/blank.gif"
					onload="document.body.dataset.runtimeImage='loaded'"
					onerror="document.body.dataset.runtimeImage='blocked'"
				>
				<a
					id="runtime-link"
					target="_top"
					href="${ runtimeOrigin }/wp-json/"
					style="position:fixed;inset:0;display:block"
				>Open runtime</a>
			</body>`
		);
	} );
	await new Promise( ( resolve, reject ) => {
		untrustedServer.once( 'error', reject );
		untrustedServer.listen( 0, '127.0.0.1', resolve );
	} );
	const address = untrustedServer.address();
	if ( ! address || typeof address === 'string' ) {
		throw new Error( 'Failed to start the untrusted E2E server.' );
	}
	untrustedOrigin = `http://127.0.0.1:${ address.port }/`;
} );

test.afterAll( async () => {
	if ( untrustedServer ) {
		await new Promise( ( resolve, reject ) => {
			untrustedServer.close( ( error ) => {
				if ( error ) {
					reject( error );
					return;
				}
				resolve();
			} );
		} );
	}
	if ( e2eTempRoot ) {
		rmSync( e2eTempRoot, {
			recursive: true,
			force: true,
			maxRetries: 3,
		} );
	}
} );

async function launchDesktopApp(
	userDataPath = mkdtempSync( path.join( e2eTempRoot, 'user-data-' ) ),
	preferredRuntimePort = null
) {
	if ( preferredRuntimePort !== null ) {
		mkdirSync( userDataPath, { recursive: true } );
		writeFileSync(
			path.join( userDataPath, 'settings.json' ),
			JSON.stringify( { runtimePort: preferredRuntimePort } )
		);
	}
	const app = await electron.launch( {
		args: [ APP_PATH, `--user-data-dir=${ userDataPath }` ],
		env: {
			...process.env,
			CORTEXT_DEVTOOLS: '0',
			CORTEXT_E2E: '1',
		},
	} );
	return { app, userDataPath };
}

async function expectTemporaryUserData( app, userDataPath ) {
	await expect
		.poll(
			async () => {
				try {
					const actualUserDataPath = await app.evaluate(
						( { app } ) => app.getPath( 'userData' )
					);
					return realpathSync( actualUserDataPath );
				} catch {
					// Electron can replace its initial execution context while
					// the first BrowserWindow is navigating.
					return null;
				}
			},
			{ timeout: 10 * 1000 }
		)
		.toBe( realpathSync( userDataPath ) );
}

function requestWithoutRuntimeAuth( url ) {
	return new Promise( ( resolve, reject ) => {
		const request = http.get( url, ( response ) => {
			response.resume();
			response.once( 'end', () => resolve( response.statusCode ) );
		} );
		request.setTimeout( 10000, () => {
			request.destroy(
				new Error( `Unauthenticated request timed out: ${ url }` )
			);
		} );
		request.once( 'error', reject );
	} );
}

async function waitForCortextShell( app ) {
	const window = await app.firstWindow();
	// The window starts on `loading.html`, then moves to wp-admin once PHP is
	// ready. Wait for that hop before reading the DOM.
	await window.waitForURL( /admin\.php\?page=cortext/, {
		timeout: 90 * 1000,
	} );
	await expect( window.locator( '#cortext-root' ) ).toBeVisible( {
		timeout: 30 * 1000,
	} );
	await expect(
		window.locator(
			'.cortext-workspace__pane[data-active="true"] .cortext-canvas__loading'
		)
	).toHaveCount( 0, { timeout: 30 * 1000 } );
	await expect(
		window.locator(
			'.cortext-workspace__pane[data-active="true"] .cortext-canvas'
		)
	).toBeVisible( { timeout: 30 * 1000 } );
	return window;
}

function reloadFirstRuntimeNavigationFromMenu( app ) {
	return app.evaluate( ( { BrowserWindow, Menu } ) => {
		return new Promise( ( resolve, reject ) => {
			const win = BrowserWindow.getAllWindows()[ 0 ];
			const webContents = win.webContents;
			let origin = null;
			const findMenuItem = ( items, role ) => {
				for ( const item of items ) {
					if ( item.role === role ) {
						return item;
					}
					if ( item.submenu ) {
						const nested = findMenuItem( item.submenu.items, role );
						if ( nested ) {
							return nested;
						}
					}
				}
				return null;
			};
			const reloadItem = findMenuItem(
				Menu.getApplicationMenu().items,
				'reload'
			);
			if ( ! reloadItem ) {
				reject( new Error( 'Reload menu item not found.' ) );
				return;
			}

			let reloadStarted = false;
			const timer = setTimeout( () => {
				cleanup();
				reject(
					new Error(
						'The first runtime navigation was not reloaded from the menu.'
					)
				);
			}, 90 * 1000 );
			const cleanup = () => {
				clearTimeout( timer );
				webContents.off( 'did-navigate', onNavigate );
				webContents.off( 'did-start-navigation', onStart );
				webContents.off( 'did-finish-load', onFinish );
			};
			const onStart = ( event ) => {
				if (
					event.isMainFrame &&
					origin &&
					event.url.startsWith( `${ origin }/` )
				) {
					reloadStarted = true;
				}
			};
			const onFinish = () => {
				if ( ! reloadStarted ) {
					return;
				}
				cleanup();
				resolve( webContents.getURL() );
			};
			const onNavigate = ( _event, url ) => {
				const navigatedUrl = new URL( url );
				if (
					navigatedUrl.hostname !== '127.0.0.1' ||
					navigatedUrl.pathname !== '/wp-admin/admin.php' ||
					navigatedUrl.searchParams.get( 'page' ) !== 'cortext'
				) {
					return;
				}
				origin = navigatedUrl.origin;
				webContents.off( 'did-navigate', onNavigate );
				webContents.on( 'did-start-navigation', onStart );
				webContents.on( 'did-finish-load', onFinish );
				reloadItem.click( {}, win, webContents );
			};

			webContents.on( 'did-navigate', onNavigate );
		} );
	} );
}

function openExternalFromRuntime(
	app,
	externalUrl,
	target,
	windowUrlSuffix = null
) {
	return app.evaluate(
		( { BrowserWindow, shell }, options ) => {
			return new Promise( ( resolve, reject ) => {
				const originalOpenExternal = shell.openExternal;
				let settled = false;
				const finish = ( callback, value ) => {
					if ( settled ) {
						return;
					}
					settled = true;
					clearTimeout( timer );
					shell.openExternal = originalOpenExternal;
					callback( value );
				};
				const timer = setTimeout( () => {
					finish(
						reject,
						new Error(
							'External navigation was not routed to the OS browser.'
						)
					);
				}, 10 * 1000 );
				shell.openExternal = ( openedUrl ) => {
					finish( resolve, openedUrl );
					return Promise.resolve();
				};

				const targetWindow = BrowserWindow.getAllWindows().find(
					( candidate ) => {
						const url = candidate.webContents.getURL();
						return options.windowUrlSuffix
							? url.endsWith( options.windowUrlSuffix )
							: url.startsWith( `${ options.runtimeOrigin }/` );
					}
				);
				if ( ! targetWindow ) {
					finish(
						reject,
						new Error( 'Cortext runtime window not found.' )
					);
					return;
				}

				const script =
					options.target === '_blank'
						? `window.open(${ JSON.stringify(
								options.externalUrl
						  ) }, '_blank')`
						: `window.location.assign(${ JSON.stringify(
								options.externalUrl
						  ) })`;
				targetWindow.webContents
					.executeJavaScript( script )
					.catch( ( error ) => finish( reject, error ) );
			} );
		},
		{ externalUrl, target, windowUrlSuffix, runtimeOrigin }
	);
}

function waitForProcessExit( app, timeoutMs = 10000 ) {
	const child = app.process();
	return new Promise( ( resolve, reject ) => {
		if ( child.exitCode !== null || child.signalCode !== null ) {
			resolve();
			return;
		}

		const onExit = () => {
			clearTimeout( timer );
			resolve();
		};
		const timer = setTimeout( () => {
			child.off( 'exit', onExit );
			reject(
				new Error(
					`Electron stayed open for more than ${ timeoutMs }ms.`
				)
			);
		}, timeoutMs );

		child.once( 'exit', onExit );
	} );
}

async function expectSecondInstanceToExit( app, userDataPath ) {
	await app.evaluate( ( { app } ) => {
		globalThis.__cortextE2ESecondInstanceSeen = false;
		app.once( 'second-instance', () => {
			globalThis.__cortextE2ESecondInstanceSeen = true;
		} );
	} );
	const secondInstanceArgs = [
		APP_PATH,
		`--user-data-dir=${ userDataPath }`,
	];
	// Playwright disables Chromium's sandbox for its Electron process on
	// Linux. Match that test-only launch mode so the second process reaches
	// Electron's single-instance lock instead of exiting during bootstrap.
	if ( process.platform === 'linux' ) {
		secondInstanceArgs.unshift( '--no-sandbox' );
	}
	const secondInstance = spawn( app.process().spawnfile, secondInstanceArgs, {
		env: {
			...process.env,
			CORTEXT_DEVTOOLS: '0',
			CORTEXT_E2E: '1',
		},
		stdio: 'ignore',
	} );
	let timeoutId;
	const timeout = new Promise( ( _resolve, reject ) => {
		timeoutId = setTimeout( () => {
			secondInstance.kill( 'SIGKILL' );
			reject( new Error( 'Second Cortext instance stayed open.' ) );
		}, 10 * 1000 );
		timeoutId.unref?.();
	} );
	await Promise.race( [ once( secondInstance, 'exit' ), timeout ] );
	clearTimeout( timeoutId );
	await expect
		.poll(
			() =>
				app.evaluate( () => globalThis.__cortextE2ESecondInstanceSeen ),
			{ timeout: 10 * 1000 }
		)
		.toBe( true );
}

test( 'opens Cortext and rejects untrusted runtime requests', async () => {
	const occupiedPortServer = http.createServer( ( _request, response ) => {
		response.writeHead( 200 );
		response.end( 'occupied' );
	} );
	await new Promise( ( resolve, reject ) => {
		occupiedPortServer.once( 'error', reject );
		occupiedPortServer.listen( 0, '127.0.0.1', resolve );
	} );
	const occupiedAddress = occupiedPortServer.address();
	if ( ! occupiedAddress || typeof occupiedAddress === 'string' ) {
		throw new Error( 'Failed to reserve the preferred E2E runtime port.' );
	}
	const { app, userDataPath } = await launchDesktopApp(
		undefined,
		occupiedAddress.port
	);
	untrustedRequests.length = 0;

	try {
		await expectTemporaryUserData( app, userDataPath );
		const window = await waitForCortextShell( app );
		runtimeOrigin = new URL( window.url() ).origin;
		expect( new URL( runtimeOrigin ).port ).not.toBe(
			String( occupiedAddress.port )
		);
		await expect.poll( () => window.title() ).toBe( 'Cortext' );
		const staticAssetUrl = new URL(
			'/wp-includes/css/dashicons.min.css',
			window.url()
		);
		const sessionSecurity = await app.evaluate(
			async ( { BrowserWindow, session }, assetUrl ) => {
				const mainWindow = BrowserWindow.getAllWindows()[ 0 ];
				const runtimeSession =
					session.fromPartition( 'persist:cortext' );
				// The token rides on Cortext frames, not on the session handle,
				// so a fetch with no frame behind it is rejected even here.
				const framelessResponse =
					await runtimeSession.fetch( assetUrl );
				await framelessResponse.arrayBuffer();
				const untrustedResponse =
					await session.defaultSession.fetch( assetUrl );
				await untrustedResponse.arrayBuffer();
				return {
					mainUsesRuntimeSession:
						mainWindow.webContents.session === runtimeSession,
					cacheSize: await runtimeSession.getCacheSize(),
					isPersistent: runtimeSession.isPersistent(),
					framelessStatus: framelessResponse.status,
					untrustedStatus: untrustedResponse.status,
				};
			},
			staticAssetUrl.href
		);
		expect( sessionSecurity ).toEqual( {
			mainUsesRuntimeSession: true,
			cacheSize: 0,
			isPersistent: true,
			framelessStatus: 403,
			untrustedStatus: 403,
		} );
		await expect(
			requestWithoutRuntimeAuth( staticAssetUrl )
		).resolves.toBe( 403 );
		const wordpressOrigins = await window.evaluate( async () => {
			const response = await fetch( '/?rest_route=/' );
			const body = await response.json();
			return { home: body.home, url: body.url };
		} );
		expect( wordpressOrigins ).toEqual( {
			home: runtimeOrigin,
			url: runtimeOrigin,
		} );

		const redirectedImageStatus = await window.evaluate( ( origin ) => {
			return new Promise( ( resolve ) => {
				const image = new Image();
				image.onload = () => resolve( 'loaded' );
				image.onerror = () => resolve( 'blocked' );
				image.src = new URL( '/redirect-runtime', origin ).href;
				document.body.append( image );
			} );
		}, untrustedOrigin );
		expect( redirectedImageStatus ).toBe( 'blocked' );
		expect(
			untrustedRequests.find(
				( request ) => request.url === '/redirect-runtime'
			)?.runtimeToken
		).toBeUndefined();

		// Third-party frames render, because blocks such as Embed put a
		// provider's iframe on the page. They still sit outside the boundary.
		const untrustedFrameNavigation = window.waitForEvent(
			'framenavigated',
			( frame ) => frame.url() === untrustedOrigin
		);
		await window.evaluate( ( url ) => {
			const frame = document.createElement( 'iframe' );
			frame.id = 'untrusted-frame';
			frame.src = url;
			document.body.append( frame );
		}, untrustedOrigin );
		const untrustedFrame = await untrustedFrameNavigation;
		await expect
			.poll( () =>
				untrustedFrame
					.locator( 'body' )
					.getAttribute( 'data-runtime-image' )
			)
			.toBe( 'blocked' );

		await window
			.locator( '#untrusted-frame' )
			.evaluate( ( frame ) => frame.remove() );

		const externalUrl = 'https://example.com/cortext-test';
		await expect(
			openExternalFromRuntime( app, externalUrl, '_blank' )
		).resolves.toBe( externalUrl );
		await expect(
			openExternalFromRuntime( app, externalUrl, '_self' )
		).resolves.toBe( externalUrl );
		await expect.poll( () => window.url() ).not.toBe( externalUrl );

		const popupPromise = app.waitForEvent( 'window' );
		await window.evaluate( () => {
			window.open(
				'/wp-json/',
				'_blank',
				'nodeIntegration=yes,contextIsolation=no,sandbox=no,webSecurity=no'
			);
		} );
		const popup = await popupPromise;
		await popup.waitForURL( `${ runtimeOrigin }/wp-json/` );
		await expect( popup.locator( 'body' ) ).not.toHaveText( 'Forbidden' );
		const popupSecurity = await app.evaluate(
			( { session, webContents } ) => {
				const runtimeSession =
					session.fromPartition( 'persist:cortext' );
				const popupContents = webContents
					.getAllWebContents()
					.find( ( candidate ) =>
						candidate.getURL().endsWith( '/wp-json/' )
					);
				if ( ! popupContents ) {
					throw new Error(
						'Internal runtime popup WebContents not found.'
					);
				}
				const preferences = popupContents.getLastWebPreferences();
				return {
					contextIsolation: preferences.contextIsolation,
					nodeIntegration: preferences.nodeIntegration,
					sameSession: popupContents.session === runtimeSession,
					sandbox: preferences.sandbox,
					webSecurity: preferences.webSecurity,
					isPersistent: popupContents.session.isPersistent(),
				};
			}
		);
		expect( popupSecurity ).toEqual( {
			contextIsolation: true,
			nodeIntegration: false,
			sameSession: true,
			sandbox: true,
			webSecurity: true,
			isPersistent: true,
		} );
		await expect(
			openExternalFromRuntime( app, externalUrl, '_self', '/wp-json/' )
		).resolves.toBe( externalUrl );
		await expect
			.poll( () => popup.url() )
			.toBe( `${ runtimeOrigin }/wp-json/` );
		await popup.close();

		const untrustedWindowPromise = app.waitForEvent( 'window' );
		await app.evaluate( async ( { BrowserWindow }, url ) => {
			const untrustedWindow = new BrowserWindow( {
				show: false,
				webPreferences: {
					contextIsolation: true,
					sandbox: true,
				},
			} );
			globalThis.__cortextE2EUntrustedWindow = untrustedWindow;
			await untrustedWindow.loadURL( url );
		}, untrustedOrigin );
		const untrustedWindow = await untrustedWindowPromise;
		await expect
			.poll( () =>
				untrustedWindow
					.locator( 'body' )
					.getAttribute( 'data-runtime-image' )
			)
			.toBe( 'blocked' );
		await untrustedWindow.locator( '#runtime-link' ).click();
		await untrustedWindow.waitForURL( `${ runtimeOrigin }/wp-json/` );
		await expect( untrustedWindow.locator( 'body' ) ).toHaveText(
			'Forbidden'
		);
		await untrustedWindow.close();
		await app.evaluate( () => {
			globalThis.__cortextE2EUntrustedWindow = null;
		} );

		// Last, because a cancelled top-level navigation leaves the page with a
		// pending navigation that Playwright's auto-waiting never resolves.
		// An embedded frame must not steer the app window, runtime URL or not.
		const frameNavigation = window.waitForEvent(
			'framenavigated',
			( frame ) => frame.url() === untrustedOrigin
		);
		await window.evaluate( ( url ) => {
			const frame = document.createElement( 'iframe' );
			frame.src = url;
			document.body.append( frame );
		}, untrustedOrigin );
		const steeringFrame = await frameNavigation;
		const appUrlBeforeSteering = window.url();
		await steeringFrame.evaluate( () =>
			document.getElementById( 'runtime-link' ).click()
		);
		await expect
			.poll( () =>
				app.evaluate( ( { BrowserWindow } ) =>
					BrowserWindow.getAllWindows()[ 0 ].webContents.getURL()
				)
			)
			.toBe( appUrlBeforeSteering );

		expect( untrustedRequests.length ).toBeGreaterThan( 0 );
		expect(
			untrustedRequests.every(
				( request ) => request.runtimeToken === undefined
			)
		).toBe( true );
	} finally {
		await app.close();
		await new Promise( ( resolve, reject ) => {
			occupiedPortServer.close( ( error ) => {
				if ( error ) {
					reject( error );
					return;
				}
				resolve();
			} );
		} );
	}
} );

test( 'reloads, preserves preferences, and exits with its window', async () => {
	const { app, userDataPath } = await launchDesktopApp();
	let didExit = false;
	let relaunchedApp = null;

	try {
		await app.firstWindow();
		const menuReload = reloadFirstRuntimeNavigationFromMenu( app );
		await expectTemporaryUserData( app, userDataPath );
		const window = await waitForCortextShell( app );
		runtimeOrigin = new URL( window.url() ).origin;
		await expectSecondInstanceToExit( app, userDataPath );
		await expect( window.locator( '#cortext-root' ) ).toBeVisible();
		const reloadedUrl = await menuReload;
		expect( new URL( reloadedUrl ).origin ).toBe( runtimeOrigin );
		await expect( window.locator( 'body' ) ).not.toHaveText( 'Forbidden' );
		await expect(
			window.locator(
				'.cortext-workspace__pane[data-active="true"] .cortext-canvas'
			)
		).toBeVisible( { timeout: 30 * 1000 } );
		await window.evaluate( () => {
			window.localStorage.setItem(
				'cortext.e2ePersistentPreference',
				'preserved'
			);
		} );
		const exitPromise = waitForProcessExit( app );
		await window.close();
		await exitPromise;
		didExit = true;

		( { app: relaunchedApp } = await launchDesktopApp( userDataPath ) );
		await expectTemporaryUserData( relaunchedApp, userDataPath );
		const relaunchedWindow = await waitForCortextShell( relaunchedApp );
		expect( new URL( relaunchedWindow.url() ).origin ).toBe(
			runtimeOrigin
		);
		await expect
			.poll( () =>
				relaunchedWindow.evaluate( () =>
					window.localStorage.getItem(
						'cortext.e2ePersistentPreference'
					)
				)
			)
			.toBe( 'preserved' );
	} finally {
		if ( ! didExit ) {
			await app.close();
		}
		if ( relaunchedApp ) {
			await relaunchedApp.close();
		}
	}
} );
