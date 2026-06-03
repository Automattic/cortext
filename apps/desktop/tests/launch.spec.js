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
const path = require( 'node:path' );
const { existsSync, rmSync } = require( 'node:fs' );
const os = require( 'node:os' );

const APP_PATH = path.resolve( __dirname, '..' );
const SNAPSHOT_PATH = path.join( APP_PATH, 'snapshot.zip' );

// Electron's `app.getPath('userData')` uses the package name on macOS and
// Linux. Start from a fresh userData dir so launch has to extract the
// snapshot, same as a first run.
function getUserDataPath() {
	const home = os.homedir();
	if ( process.platform === 'darwin' ) {
		return path.join( home, 'Library/Application Support/cortext-desktop' );
	}
	if ( process.platform === 'win32' ) {
		return path.join( process.env.APPDATA ?? home, 'cortext-desktop' );
	}
	return path.join(
		process.env.XDG_CONFIG_HOME ?? path.join( home, '.config' ),
		'cortext-desktop'
	);
}

test.beforeAll( () => {
	if ( ! existsSync( SNAPSHOT_PATH ) ) {
		throw new Error(
			`Missing ${ SNAPSHOT_PATH }. Run 'npm --prefix apps/desktop run snapshot' first.`
		);
	}
	const userData = getUserDataPath();
	if ( existsSync( userData ) ) {
		rmSync( userData, { recursive: true, force: true } );
	}
} );

function launchDesktopApp() {
	return electron.launch( {
		args: [ APP_PATH ],
		env: {
			...process.env,
			CORTEXT_DEVTOOLS: '0',
		},
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

test( 'opens the first Cortext document', async () => {
	const app = await launchDesktopApp();

	try {
		const window = await waitForCortextShell( app );
		await expect.poll( () => window.title() ).toBe( 'Cortext' );
	} finally {
		await app.close();
	}
} );

test( 'exits after closing its only window', async () => {
	const app = await launchDesktopApp();
	let didExit = false;

	try {
		const window = await waitForCortextShell( app );
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
