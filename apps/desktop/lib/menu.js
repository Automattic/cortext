const { app, Menu } = require( 'electron' );

const isMac = process.platform === 'darwin';

function productionViewMenu() {
	return {
		label: 'View',
		submenu: [
			{ role: 'reload' },
			{ role: 'forceReload' },
			{ type: 'separator' },
			{ role: 'resetZoom' },
			{ role: 'zoomIn' },
			{ role: 'zoomOut' },
			{ type: 'separator' },
			{ role: 'togglefullscreen' },
		],
	};
}

// Once we replace the default menu, add the standard roles back by hand. The
// whole-submenu roles keep copy/paste/select-all/window shortcuts working, and
// the app menu gets the update controls.
function buildAppMenu( {
	updateLabel,
	onUpdateItem,
	autoInstallUpdates,
	onToggleAutoInstall,
	enableDevTools = false,
} ) {
	const template = [
		...( isMac
			? [
					{
						label: app.name,
						submenu: [
							{ role: 'about' },
							{ type: 'separator' },
							{ label: updateLabel, click: onUpdateItem },
							{
								label: 'Automatically install updates',
								type: 'checkbox',
								checked: autoInstallUpdates,
								click: ( item ) =>
									onToggleAutoInstall( item.checked ),
							},
							{ type: 'separator' },
							{ role: 'services' },
							{ type: 'separator' },
							{ role: 'hide' },
							{ role: 'hideOthers' },
							{ role: 'unhide' },
							{ type: 'separator' },
							{ role: 'quit' },
						],
					},
			  ]
			: [] ),
		{ role: 'editMenu' },
		enableDevTools ? { role: 'viewMenu' } : productionViewMenu(),
		{ role: 'windowMenu' },
	];
	return Menu.buildFromTemplate( template );
}

module.exports = { buildAppMenu, productionViewMenu };
