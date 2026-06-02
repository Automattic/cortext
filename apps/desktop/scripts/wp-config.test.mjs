import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWpConfig } from './wp-config.mjs';

test( 'desktop wp-config disables WordPress self-updates', () => {
	const config = buildWpConfig();

	assert.match( config, /define\( 'AUTOMATIC_UPDATER_DISABLED', true \);/ );
	assert.match( config, /define\( 'WP_AUTO_UPDATE_CORE', false \);/ );
	assert.match( config, /define\( 'DISALLOW_FILE_MODS', true \);/ );
	assert.match( config, /define\( 'DISALLOW_FILE_EDIT', true \);/ );
} );
