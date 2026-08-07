import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire( import.meta.url );
const Module = require( 'node:module' );

function loadMenu( platform = 'darwin' ) {
	const resolved = require.resolve( '../lib/menu.js' );
	delete require.cache[ resolved ];

	const originalLoad = Module._load;
	const originalPlatform = Object.getOwnPropertyDescriptor(
		process,
		'platform'
	);
	Object.defineProperty( process, 'platform', { value: platform } );
	Module._load = function ( request, parent, isMain ) {
		if ( request === 'electron' ) {
			return {
				app: { name: 'Cortext' },
				Menu: {
					buildFromTemplate: ( template ) => template,
				},
			};
		}
		return originalLoad.call( this, request, parent, isMain );
	};

	try {
		return require( resolved );
	} finally {
		Module._load = originalLoad;
		Object.defineProperty( process, 'platform', originalPlatform );
	}
}

function menuOptions( enableDevTools ) {
	return {
		updateLabel: 'Check for Updates…',
		onUpdateItem: () => {},
		autoInstallUpdates: true,
		onToggleAutoInstall: () => {},
		enableDevTools,
	};
}

test( 'production View menu keeps reload and zoom but omits DevTools', () => {
	const { buildAppMenu } = loadMenu();
	const template = buildAppMenu( menuOptions( false ) );
	const viewMenu = template.find( ( item ) => item.label === 'View' );

	assert.ok( viewMenu );
	assert.deepEqual(
		viewMenu.submenu
			.filter( ( item ) => item.role )
			.map( ( item ) => item.role ),
		[
			'reload',
			'forceReload',
			'resetZoom',
			'zoomIn',
			'zoomOut',
			'togglefullscreen',
		]
	);
	assert.equal(
		viewMenu.submenu.some( ( item ) => item.role === 'toggleDevTools' ),
		false
	);
} );

test( "development uses Electron's standard View menu", () => {
	const { buildAppMenu } = loadMenu( 'linux' );
	const template = buildAppMenu( menuOptions( true ) );

	assert.equal(
		template.some( ( item ) => item.role === 'viewMenu' ),
		true
	);
} );
