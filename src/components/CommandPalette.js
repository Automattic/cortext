// tech-debt.md#38: use WordPress' palette UI, but keep it on a local
// registry so core/wp-admin commands do not show up in Cortext.

import { store as commandsStore, useCommand } from '@wordpress/commands';
import { store as keyboardShortcutsStore } from '@wordpress/keyboard-shortcuts';
import { store as preferencesStore } from '@wordpress/preferences';
import {
	createRegistry,
	RegistryProvider,
	useDispatch,
	useRegistry,
} from '@wordpress/data';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { home as homeIcon, listItem, table } from '@wordpress/icons';
import { useCallback, useEffect, useMemo } from '@wordpress/element';

import CortextCommandMenu from './CortextCommandMenu';
import PageIcon from './PageIcon';
import { useRecents } from '../hooks/useRecents';
import { useWorkspaceHomePath } from '../hooks/useWorkspaceHomePath';

const OPEN_COMMAND_PALETTE_EVENT = 'cortext:open-command-palette';
const DEFAULT_COMMAND_CONTEXT = 'root';

export function openCommandPalette() {
	window.dispatchEvent( new Event( OPEN_COMMAND_PALETTE_EVENT ) );
}

function createCommandPaletteRegistry( parentRegistry ) {
	const registry = createRegistry( {}, parentRegistry );
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

function recentCommandIcon( recent ) {
	if ( recent?.kind === 'collection' ) {
		return table;
	}
	if ( recent?.kind === 'row' ) {
		return listItem;
	}
	return <PageIcon icon={ recent?.icon ?? '' } size={ 16 } />;
}

function recentTitle( recent ) {
	const title = recent?.title?.trim?.() || __( '(untitled)', 'cortext' );
	if ( recent?.kind === 'row' && recent?.collection?.title ) {
		return sprintf(
			/* translators: 1: row title, 2: collection title */
			__( '%1$s in %2$s', 'cortext' ),
			title,
			recent.collection.title
		);
	}
	return title;
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

function RecentCommandRegistration( { canvasRef, recent } ) {
	const navigate = useNavigate();
	const goToRecent = useCallback(
		( { close } ) => {
			if ( recent?.path ) {
				navigate( {
					to: '/$',
					params: { _splat: recent.path },
				} );
			}
			close();
			focusCanvasAfterPaletteCloses( canvasRef );
		},
		[ canvasRef, navigate, recent?.path ]
	);

	useCommand( {
		name: `cortext/recent/${ recent.kind }-${ recent.id }`,
		label: recentTitle( recent ),
		searchLabel: sprintf(
			/* translators: %s: recent item title */
			__( 'Open recent: %s', 'cortext' ),
			recentTitle( recent )
		),
		context: DEFAULT_COMMAND_CONTEXT,
		icon: recentCommandIcon( recent ),
		keywords: [ __( 'recent', 'cortext' ), recent.kind ],
		disabled: ! recent.path,
		callback: goToRecent,
	} );
	return null;
}

function CommandPaletteContents( {
	canvasRef,
	homePath,
	isResolvingHomePath,
} ) {
	const { recents } = useRecents();

	return (
		<>
			<CommandPaletteOpenBridge />
			<HomeCommandRegistration
				canvasRef={ canvasRef }
				homePath={ homePath }
				isResolvingHomePath={ isResolvingHomePath }
			/>
			{ recents.map( ( recent ) => (
				<RecentCommandRegistration
					key={ `${ recent.kind }:${ recent.id }` }
					canvasRef={ canvasRef }
					recent={ recent }
				/>
			) ) }
			<CortextCommandMenu />
		</>
	);
}

export default function CommandPalette( { canvasRef } ) {
	const { homePath, isResolvingHomePath } = useWorkspaceHomePath();
	const parentRegistry = useRegistry();
	const registry = useMemo(
		() => createCommandPaletteRegistry( parentRegistry ),
		[ parentRegistry ]
	);

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
