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

const projectRoot = path.resolve( __dirname, '../..' );

function readWpEnvPort( configPath ) {
	try {
		const resolvedPath = path.resolve( projectRoot, configPath );
		const config = JSON.parse( fs.readFileSync( resolvedPath, 'utf8' ) );
		return config.port ? Number( config.port ) : null;
	} catch {
		return null;
	}
}

function baseUrlPort( baseURL ) {
	try {
		const { port, protocol } = new URL( baseURL );
		if ( port ) {
			return Number( port );
		}
		return protocol === 'https:' ? 443 : 80;
	} catch {
		return null;
	}
}

function resolveWpEnvConfig( baseURL ) {
	if ( process.env.WP_ENV_CONFIG ) {
		return process.env.WP_ENV_CONFIG;
	}

	const port = baseUrlPort( baseURL );
	if ( port && port === readWpEnvPort( '.wp-env.test.json' ) ) {
		return '.wp-env.test.json';
	}

	if ( port && port === readWpEnvPort( '.wp-env.override.json' ) ) {
		return null;
	}

	if ( port && port === readWpEnvPort( '.wp-env.json' ) ) {
		return null;
	}

	return false;
}

function runWpCli( args, wpEnvConfig, options = {} ) {
	const wpEnvBin = path.join(
		projectRoot,
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'wp-env.cmd' : 'wp-env'
	);
	const configArgs = wpEnvConfig ? [ '--config', wpEnvConfig ] : [];

	execFileSync( wpEnvBin, [ ...configArgs, 'run', 'cli', 'wp', ...args ], {
		cwd: projectRoot,
		stdio: 'inherit',
		...options,
	} );
}

function deactivateLocalAutologin( wpEnvConfig ) {
	try {
		runWpCli( [ 'plugin', 'deactivate', 'dev-autologin' ], wpEnvConfig, {
			stdio: 'ignore',
		} );
	} catch {
		// The local dev-autologin plugin only exists in some wp-env overrides.
	}
}

function flushRewriteRules( wpEnvConfig ) {
	runWpCli( [ 'rewrite', 'flush' ], wpEnvConfig );
}

/**
 * @param {import('@playwright/test').FullConfig} config
 * @return {Promise<void>}
 */
async function globalSetup( config ) {
	await baseGlobalSetup( config );
	const { storageState, baseURL } = config.projects[ 0 ].use;

	const wpEnvConfig = resolveWpEnvConfig( baseURL );
	if ( wpEnvConfig !== false ) {
		deactivateLocalAutologin( wpEnvConfig );
		flushRewriteRules( wpEnvConfig );
	}

	if ( typeof storageState !== 'string' || ! baseURL ) {
		return;
	}

	markAlphaNoticeSeen( storageState, new URL( baseURL ).origin );
}

module.exports = globalSetup;
