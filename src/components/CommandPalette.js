// Cortext uses the WordPress command palette UI, but not the shared admin
// command store. A local registry keeps core/wp-admin commands out of this app.

import {
	CommandMenu,
	store as commandsStore,
	useCommand,
} from '@wordpress/commands';
import { store as keyboardShortcutsStore } from '@wordpress/keyboard-shortcuts';
import { store as preferencesStore } from '@wordpress/preferences';
import { createRegistry, RegistryProvider, useDispatch } from '@wordpress/data';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { home as homeIcon } from '@wordpress/icons';
import { useCallback, useEffect, useMemo } from '@wordpress/element';

import { useWorkspaceHomePath } from '../hooks/useWorkspaceHomePath';

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

function focusCanvasAfterPaletteCloses( canvasRef ) {
	window.setTimeout( () => {
		canvasRef?.current?.focus( { preventScroll: true } );
	}, 0 );
}

function HomeCommandRegistration( {
	canvasRef,
	homePath,
	isResolvingHomePath,
} ) {
	const navigate = useNavigate();
	const goHome = useCallback(
		( { close } ) => {
			if ( ! homePath ) {
				close();
				focusCanvasAfterPaletteCloses( canvasRef );
				return;
			}
			navigate( {
				to: '/$',
				params: { _splat: homePath },
			} );
			close();
			focusCanvasAfterPaletteCloses( canvasRef );
		},
		[ canvasRef, homePath, navigate ]
	);

	useCommand( {
		name: 'cortext/home',
		label: __( 'Go to home', 'cortext' ),
		context: DEFAULT_COMMAND_CONTEXT,
		icon: homeIcon,
		disabled: ! homePath || isResolvingHomePath,
		callback: goHome,
	} );
	return null;
}

function CommandPaletteContents( {
	canvasRef,
	homePath,
	isResolvingHomePath,
} ) {
	return (
		<>
			<CommandPaletteOpenBridge />
			<HomeCommandRegistration
				canvasRef={ canvasRef }
				homePath={ homePath }
				isResolvingHomePath={ isResolvingHomePath }
			/>
			<CommandMenu />
		</>
	);
}

export default function CommandPalette( { canvasRef } ) {
	const { homePath, isResolvingHomePath } = useWorkspaceHomePath();
	const registry = useMemo( createCommandPaletteRegistry, [] );

	return (
		<RegistryProvider value={ registry }>
			<CommandPaletteContents
				canvasRef={ canvasRef }
				homePath={ homePath }
				isResolvingHomePath={ isResolvingHomePath }
			/>
		</RegistryProvider>
	);
}
