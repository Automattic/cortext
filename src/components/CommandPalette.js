// Mounts Cortext's command palette and registers Cortext-owned commands.
// The editor packages register their own commands in the default data
// registry, so this palette uses an isolated registry to keep the menu scoped
// to Cortext commands only.

import {
	CommandMenu,
	store as commandsStore,
	useCommand,
} from '@wordpress/commands';
import { useEntityRecords } from '@wordpress/core-data';
import { store as keyboardShortcutsStore } from '@wordpress/keyboard-shortcuts';
import { store as preferencesStore } from '@wordpress/preferences';
import { createRegistry, RegistryProvider, useDispatch } from '@wordpress/data';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { home as homeIcon } from '@wordpress/icons';
import { useCallback, useEffect, useMemo } from '@wordpress/element';

import { ACTIVE_PAGES_QUERY, POST_TYPE } from './page-queries';
import { firstPageInTree } from './pages-tree';
import { computeUri } from '../router/useResolveEntity';
import { useWorkspaceHome } from '../hooks/useWorkspaceHome';

const OPEN_COMMAND_PALETTE_EVENT = 'cortext:open-command-palette';
const DEFAULT_COMMAND_CONTEXT = 'root';

export function openCommandPalette() {
	window.dispatchEvent( new Event( OPEN_COMMAND_PALETTE_EVENT ) );
}

function createCommandPaletteRegistry() {
	const registry = createRegistry();
	registry.register( commandsStore );
	registry.register( keyboardShortcutsStore );
	registry.register( preferencesStore );
	return registry;
}

function CommandPaletteOpenBridge() {
	const { open } = useDispatch( commandsStore );

	useEffect( () => {
		window.addEventListener( OPEN_COMMAND_PALETTE_EVENT, open );
		return () =>
			window.removeEventListener( OPEN_COMMAND_PALETTE_EVENT, open );
	}, [ open ] );

	return null;
}

function focusCanvasAfterPaletteCloses() {
	window.setTimeout( () => {
		const canvas = document.querySelector( '.cortext-shell__canvas' );
		if ( canvas instanceof window.HTMLElement ) {
			canvas.focus( { preventScroll: true } );
		}
	}, 0 );
}

function HomeCommandRegistration( { homePath } ) {
	const navigate = useNavigate();
	const goHome = useCallback(
		( { close } ) => {
			if ( homePath ) {
				navigate( {
					to: '/$',
					params: { _splat: homePath },
				} );
			} else {
				navigate( { to: '/' } );
			}
			close();
			focusCanvasAfterPaletteCloses();
		},
		[ homePath, navigate ]
	);

	useCommand( {
		name: 'cortext/home',
		label: __( 'Go to home', 'cortext' ),
		context: DEFAULT_COMMAND_CONTEXT,
		icon: homeIcon,
		callback: goHome,
	} );
	return null;
}

function CommandPaletteContents( { homePath } ) {
	return (
		<>
			<CommandPaletteOpenBridge />
			<HomeCommandRegistration homePath={ homePath } />
			<CommandMenu />
		</>
	);
}

export default function CommandPalette() {
	const { home } = useWorkspaceHome();
	const { records } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const pages = useMemo( () => records ?? [], [ records ] );
	const fallbackHomePage = useMemo(
		() => firstPageInTree( pages ),
		[ pages ]
	);
	const homePath =
		home?.path ??
		( fallbackHomePage ? computeUri( fallbackHomePage ) : null );
	const registry = useMemo( createCommandPaletteRegistry, [] );

	return (
		<RegistryProvider value={ registry }>
			<CommandPaletteContents homePath={ homePath } />
		</RegistryProvider>
	);
}
