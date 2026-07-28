import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildWpConfig } from './wp-config.mjs';

const BOOTSTRAP_PATH = fileURLToPath(
	new URL( '../runtime/bootstrap.php', import.meta.url )
);

test( 'desktop wp-config disables WordPress self-updates', () => {
	const config = buildWpConfig();

	assert.match( config, /define\( 'AUTOMATIC_UPDATER_DISABLED', true \);/ );
	assert.match( config, /define\( 'WP_AUTO_UPDATE_CORE', false \);/ );
	assert.match( config, /define\( 'DISALLOW_FILE_MODS', true \);/ );
	assert.match( config, /define\( 'DISALLOW_FILE_EDIT', true \);/ );
} );

test( 'desktop wp-config loads the runtime origin without a fixed port', () => {
	const config = buildWpConfig();

	assert.match(
		config,
		/require_once __DIR__ \. '\/cortext-runtime-bootstrap\.php';/
	);
	assert.doesNotMatch( config, /127\.0\.0\.1:9402/ );
	assert.doesNotMatch( config, /define\( 'WP_(?:HOME|SITEURL)'/ );
} );

test( 'runtime bootstrap defines the current origin before legacy config', () => {
	const origin = 'http://127.0.0.1:54321';
	const result = spawnSync(
		'php',
		[
			'-r',
			`require ${ JSON.stringify(
				BOOTSTRAP_PATH
			) }; if ( ! defined( 'WP_HOME' ) ) { define( 'WP_HOME', 'http://127.0.0.1:9402' ); } echo WP_HOME . "\\n" . WP_SITEURL;`,
		],
		{
			encoding: 'utf8',
			env: {
				...process.env,
				CORTEXT_DESKTOP_RUNTIME_ORIGIN: origin,
			},
		}
	);

	assert.equal( result.status, 0, result.stderr );
	assert.equal( result.stdout, `${ origin }\n${ origin }` );
} );

test( 'runtime bootstrap fails closed for a non-loopback origin', () => {
	const result = spawnSync(
		'php',
		[ '-r', `require ${ JSON.stringify( BOOTSTRAP_PATH ) };` ],
		{
			encoding: 'utf8',
			env: {
				...process.env,
				CORTEXT_DESKTOP_RUNTIME_ORIGIN: 'https://example.com',
			},
		}
	);

	assert.notEqual( result.status, 0 );
	assert.match( result.stderr, /Invalid Cortext desktop runtime origin/ );
} );
