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
const http = require( 'node:http' );
const path = require( 'node:path' );
const { existsSync, mkdtempSync, rmSync } = require( 'node:fs' );
const os = require( 'node:os' );

const APP_PATH = path.resolve( __dirname, '..' );
const SNAPSHOT_PATH = path.join( APP_PATH, 'snapshot.zip' );
let e2eTempRoot;
let untrustedServer;
let untrustedOrigin;

test.beforeAll( async () => {
	if ( ! existsSync( SNAPSHOT_PATH ) ) {
		throw new Error(
			`Missing ${ SNAPSHOT_PATH }. Run 'npm --prefix apps/desktop run snapshot' first.`
		);
	}
	e2eTempRoot = mkdtempSync(
		path.join( os.tmpdir(), 'cortext-desktop-e2e-' )
	);
	untrustedServer = http.createServer( ( request, response ) => {
		if ( request.url === '/redirect-runtime' ) {
			response.writeHead( 302, {
				'Cache-Control': 'no-store',
				Location: 'http://127.0.0.1:9402/wp-includes/images/blank.gif',
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
					src="http://127.0.0.1:9402/wp-includes/images/blank.gif"
					onload="document.body.dataset.runtimeImage='loaded'"
					onerror="document.body.dataset.runtimeImage='blocked'"
				>
				<a
					id="runtime-link"
					target="_top"
					href="http://127.0.0.1:9402/wp-json/"
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

function launchDesktopApp() {
	const userDataPath = mkdtempSync( path.join( e2eTempRoot, 'user-data-' ) );
	return electron.launch( {
		args: [ APP_PATH ],
		env: {
			...process.env,
			CORTEXT_DEVTOOLS: '0',
			CORTEXT_E2E: '1',
			CORTEXT_E2E_USER_DATA_DIR: userDataPath,
		},
	} );
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

test( 'opens Cortext and rejects untrusted runtime requests', async () => {
	const app = await launchDesktopApp();

	try {
		const window = await waitForCortextShell( app );
		await expect.poll( () => window.title() ).toBe( 'Cortext' );
		const staticAssetUrl = new URL(
			'/wp-includes/css/dashicons.min.css',
			window.url()
		);
		await expect(
			requestWithoutRuntimeAuth( staticAssetUrl )
		).resolves.toBe( 403 );
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

		const untrustedFrameNavigation = window.waitForEvent(
			'framenavigated',
			( frame ) => frame.url() === untrustedOrigin
		);
		await window.evaluate( ( url ) => {
			const frame = document.createElement( 'iframe' );
			frame.src = url;
			frame.style =
				'position:fixed;z-index:2147483647;inset:0;width:100vw;height:100vh;pointer-events:auto';
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
		await untrustedFrame.locator( '#runtime-link' ).click();
		await window.waitForURL( 'http://127.0.0.1:9402/wp-json/' );
		await expect( window.locator( 'body' ) ).toHaveText( 'Forbidden' );
	} finally {
		await app.close();
	}
} );

test( 'exits after closing its only window', async () => {
	const app = await launchDesktopApp();
	let didExit = false;

	try {
		const window = await waitForCortextShell( app );
		await window.reload();
		await expect(
			window.locator(
				'.cortext-workspace__pane[data-active="true"] .cortext-canvas'
			)
		).toBeVisible( { timeout: 30 * 1000 } );
		const exitPromise = waitForProcessExit( app );
		await window.close();
		await exitPromise;
		didExit = true;
	} finally {
		if ( ! didExit ) {
			await app.close();
		}
	}
} );
