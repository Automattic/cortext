import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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

test( 'E2E mode skips both update checkers', () => {
	const previousE2E = process.env.CORTEXT_E2E;
	let legacyChecks = 0;
	process.env.CORTEXT_E2E = '1';

	try {
		const { scheduleUpdateCheck } = requireWithMocks(
			'../lib/auto-update',
			{
				electron: {
					app: { isPackaged: true },
					dialog: {},
				},
				'./update-check': {
					scheduleUpdateCheck: () => {
						legacyChecks += 1;
					},
				},
			}
		);

		scheduleUpdateCheck();
		assert.equal( legacyChecks, 0 );
	} finally {
		if ( previousE2E === undefined ) {
			delete process.env.CORTEXT_E2E;
		} else {
			process.env.CORTEXT_E2E = previousE2E;
		}
	}
} );
