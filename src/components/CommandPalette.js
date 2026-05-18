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
	useSelect,
} from '@wordpress/data';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { home as homeIcon, listItem, table } from '@wordpress/icons';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';

import CortextCommandMenu, {
	CommandDescriptionContext,
} from './CortextCommandMenu';
import PageIcon from './PageIcon';
import useDocuments from '../hooks/useDocuments';
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

function documentCommandIcon( doc ) {
	if ( doc?.kind === 'collection' ) {
		return table;
	}
	if ( doc?.kind === 'row' ) {
		return listItem;
	}
	return <PageIcon icon={ doc?.icon ?? '' } size={ 16 } />;
}

function documentTitle( doc ) {
	const title = doc?.title?.trim?.() || __( '(untitled)', 'cortext' );
	if ( doc?.kind === 'row' && doc?.collection?.title ) {
		return sprintf(
			/* translators: 1: row title, 2: collection title */
			__( '%1$s in %2$s', 'cortext' ),
			title,
			doc.collection.title
		);
	}
	return title;
}

function rowCollectionHint( doc ) {
	if ( doc?.kind !== 'row' || ! doc?.collection?.title ) {
		return '';
	}
	return sprintf(
		/* translators: %s: parent collection title */
		__( 'in %s', 'cortext' ),
		doc.collection.title
	);
}

function useDebouncedValue( value, delay ) {
	const [ debounced, setDebounced ] = useState( value );
	useEffect( () => {
		const id = setTimeout( () => setDebounced( value ), delay );
		return () => clearTimeout( id );
	}, [ value, delay ] );
	return debounced;
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
		label: documentTitle( recent ),
		searchLabel: sprintf(
			/* translators: %s: recent item title */
			__( 'Open recent: %s', 'cortext' ),
			documentTitle( recent )
		),
		context: DEFAULT_COMMAND_CONTEXT,
		icon: documentCommandIcon( recent ),
		keywords: [ __( 'recent', 'cortext' ), recent.kind ],
		disabled: ! recent.path,
		callback: goToRecent,
	} );
	return null;
}

function documentDescription( doc ) {
	if ( doc.kind === 'page' ) {
		return doc.excerpt ?? '';
	}
	return rowCollectionHint( doc );
}

function DocumentCommandRegistration( { canvasRef, document, search } ) {
	const navigate = useNavigate();
	const goToDocument = useCallback(
		( { close } ) => {
			if ( document?.path ) {
				navigate( {
					to: '/$',
					params: { _splat: document.path },
				} );
			}
			close();
			focusCanvasAfterPaletteCloses( canvasRef );
		},
		[ canvasRef, navigate, document?.path ]
	);

	useCommand( {
		name: `cortext/document/${ document.kind }-${ document.id }`,
		label: document.title?.trim?.() || __( '(untitled)', 'cortext' ),
		context: DEFAULT_COMMAND_CONTEXT,
		icon: documentCommandIcon( document ),
		// Give cmdk the active search term so server-side body/meta matches stay
		// visible even when the title does not include the query.
		keywords: [ search, document.kind ],
		disabled: ! document.path,
		callback: goToDocument,
	} );
	return null;
}

function DocumentResultsRegistration( {
	canvasRef,
	search,
	onPendingChange,
	onDescriptionsChange,
} ) {
	const { documents, hasResolved, error } = useDocuments( {
		search,
		perPage: 10,
	} );
	const hasFreshDocuments = hasResolved && ! error;
	// `useDocuments` keeps the previous documents while a refresh is in
	// flight or after a failure. Tag the rendered commands with the search
	// that actually produced them so cmdk filters them out naturally when
	// the new query no longer matches, instead of unmounting and re-mounting
	// (which would flicker every time the user refined their input).
	const [ lastResolvedSearch, setLastResolvedSearch ] = useState( '' );

	useEffect( () => {
		onPendingChange( ! hasResolved );
		return () => onPendingChange( false );
	}, [ hasResolved, onPendingChange ] );

	useEffect( () => {
		if ( ! hasFreshDocuments ) {
			return;
		}
		setLastResolvedSearch( search );
	}, [ hasFreshDocuments, search ] );

	useEffect( () => {
		if ( ! hasFreshDocuments ) {
			return undefined;
		}
		const map = new Map();
		for ( const doc of documents ) {
			const description = documentDescription( doc );
			if ( description ) {
				map.set(
					`cortext/document/${ doc.kind }-${ doc.id }`,
					description
				);
			}
		}
		onDescriptionsChange( map );
		return undefined;
	}, [ documents, hasFreshDocuments, onDescriptionsChange ] );

	useEffect( () => {
		return () => onDescriptionsChange( new Map() );
	}, [ onDescriptionsChange ] );

	if ( ! lastResolvedSearch ) {
		return null;
	}

	return documents.map( ( doc ) => (
		<DocumentCommandRegistration
			key={ `${ doc.kind }:${ doc.id }` }
			canvasRef={ canvasRef }
			document={ doc }
			search={ lastResolvedSearch }
		/>
	) );
}

function CommandPaletteContents( {
	canvasRef,
	homePath,
	isResolvingHomePath,
} ) {
	const { recents } = useRecents();
	const [ search, setSearch ] = useState( '' );
	const debouncedSearch = useDebouncedValue( search, 150 );
	const [ isFetchingDocuments, setIsFetchingDocuments ] = useState( false );
	const [ documentDescriptions, setDocumentDescriptions ] = useState(
		() => new Map()
	);
	const isPaletteOpen = useSelect(
		( select ) => select( commandsStore ).isOpen(),
		[]
	);

	const isDebouncing = search !== debouncedSearch;
	const shouldFetchDocuments = isPaletteOpen && Boolean( debouncedSearch );
	const isDocumentSearchPending =
		Boolean( search ) && ( isDebouncing || isFetchingDocuments );

	return (
		<CommandDescriptionContext.Provider value={ documentDescriptions }>
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
			{ shouldFetchDocuments && (
				<DocumentResultsRegistration
					canvasRef={ canvasRef }
					search={ debouncedSearch }
					onPendingChange={ setIsFetchingDocuments }
					onDescriptionsChange={ setDocumentDescriptions }
				/>
			) }
			<CortextCommandMenu
				search={ search }
				setSearch={ setSearch }
				isDocumentSearchPending={ isDocumentSearchPending }
			/>
		</CommandDescriptionContext.Provider>
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
