import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire( import.meta.url );
const { secureWebPreferences } = require( '../lib/web-preferences' );

test( 'production disables DevTools and uses the runtime session', () => {
	const runtimeSession = {};
	const preferences = secureWebPreferences(
		{
			allowRunningInsecureContent: true,
			devTools: true,
			nodeIntegration: true,
			partition: 'attacker',
			preload: '/tmp/attacker.js',
			session: {},
			webSecurity: false,
		},
		runtimeSession,
		false
	);

	assert.equal( preferences.devTools, false );
	assert.equal( preferences.session, runtimeSession );
	assert.equal( preferences.contextIsolation, true );
	assert.equal( preferences.nodeIntegration, false );
	assert.equal( preferences.sandbox, true );
	assert.equal( preferences.webSecurity, true );
	assert.equal( preferences.allowRunningInsecureContent, false );
	assert.equal( 'partition' in preferences, false );
	assert.equal( 'preload' in preferences, false );
} );

test( 'development enables DevTools without changing isolation', () => {
	const preferences = secureWebPreferences( {}, {}, true );

	assert.equal( preferences.devTools, true );
	assert.equal( preferences.contextIsolation, true );
	assert.equal( preferences.nodeIntegration, false );
	assert.equal( preferences.sandbox, true );
} );
