/**
 * Smoke test for desktop startup.
 *
 * This only checks the path a user hits on launch: extract the snapshot,
 * start PHP, open BrowserWindow, and mount the Cortext shell. Editor flows
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

test( 'launches and loads the Cortext shell', async () => {
	const app = await electron.launch( {
		args: [ APP_PATH ],
		env: {
			...process.env,
			CORTEXT_DEVTOOLS: '0',
		},
	} );

	try {
		const window = await app.firstWindow();
		// The window starts on `loading.html`. After PHP comes up, main.js
		// sends it to wp-admin. Wait for that navigation before reading the DOM.
		await window.waitForURL( /admin\.php\?page=cortext/, {
			timeout: 90 * 1000,
		} );
		await expect( window.locator( '#cortext-root' ) ).toBeVisible( {
			timeout: 30 * 1000,
		} );
		await expect.poll( () => window.title() ).toBe( 'Cortext' );
	} finally {
		await app.close();
	}
} );
