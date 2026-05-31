const fs = require( 'fs' );
const path = require( 'path' );
const { execFileSync } = require( 'child_process' );

const baseGlobalSetup = require( '@wordpress/scripts/config/playwright/global-setup.js' );

const ALPHA_NOTICE_STORAGE_KEY = 'cortext.alphaNoticeSeen';

/**
 * @param {string} storageStatePath
 * @param {string} origin
 */
function markAlphaNoticeSeen( storageStatePath, origin ) {
	const storageState = JSON.parse(
		fs.readFileSync( storageStatePath, 'utf8' )
	);
	const origins = storageState.origins || [];
	let originState = origins.find( ( item ) => item.origin === origin );

	if ( ! originState ) {
		originState = { origin, localStorage: [] };
		origins.push( originState );
	}

	const localStorage = originState.localStorage || [];
	const existingEntry = localStorage.find(
		( item ) => item.name === ALPHA_NOTICE_STORAGE_KEY
	);

	if ( existingEntry ) {
		existingEntry.value = 'true';
	} else {
		localStorage.push( {
			name: ALPHA_NOTICE_STORAGE_KEY,
			value: 'true',
		} );
	}

	originState.localStorage = localStorage;
	storageState.origins = origins;

	fs.writeFileSync(
		storageStatePath,
		`${ JSON.stringify( storageState, null, 2 ) }\n`
	);
}

function runWpCli( args, options = {} ) {
	const projectRoot = path.resolve( __dirname, '../..' );
	const wpEnvBin = path.join(
		projectRoot,
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'wp-env.cmd' : 'wp-env'
	);

	execFileSync( wpEnvBin, [ 'run', 'cli', 'wp', ...args ], {
		cwd: projectRoot,
		stdio: 'inherit',
		...options,
	} );
}

function deactivateLocalAutologin() {
	try {
		runWpCli( [ 'plugin', 'deactivate', 'dev-autologin' ], {
			stdio: 'ignore',
		} );
	} catch {
		// The local dev-autologin plugin only exists in some wp-env overrides.
	}
}

function flushRewriteRules() {
	runWpCli( [ 'rewrite', 'flush' ] );
}

/**
 * @param {import('@playwright/test').FullConfig} config
 * @return {Promise<void>}
 */
async function globalSetup( config ) {
	await baseGlobalSetup( config );
	deactivateLocalAutologin();
	flushRewriteRules();

	const { storageState, baseURL } = config.projects[ 0 ].use;
	if ( typeof storageState !== 'string' || ! baseURL ) {
		return;
	}

	markAlphaNoticeSeen( storageState, new URL( baseURL ).origin );
}

module.exports = globalSetup;
