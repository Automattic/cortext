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
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from '@wordpress/element';

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

function DocumentCommandRegistration( { canvasRef, document } ) {
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
		keywords: [ document.kind ],
		disabled: ! document.path,
		callback: goToDocument,
	} );
	return null;
}

function firstDocumentValue( documents ) {
	const first = documents[ 0 ];
	if ( ! first ) {
		return undefined;
	}
	return `document-cortext/document/${ first.kind }-${ first.id }`;
}

function DocumentResultsRegistration( {
	canvasRef,
	search,
	onPendingChange,
	onDescriptionsChange,
	onDocumentsResolved,
} ) {
	const { documents, hasResolved, error } = useDocuments( {
		search,
		perPage: 10,
	} );
	const hasFreshDocuments = hasResolved && ! error;
	// `useDocuments` keeps the previous documents while a refresh is in
	// flight (intentional, to avoid flicker during refinement) and also on
	// a failed fetch (which we explicitly hide below). Track whether we
	// have ever resolved successfully so we don't render anything before
	// the first response arrives.
	const [ hasEverResolved, setHasEverResolved ] = useState( false );

	useEffect( () => {
		onPendingChange( ! hasResolved );
		return () => onPendingChange( false );
	}, [ hasResolved, onPendingChange ] );

	// `useLayoutEffect` so the parent's controlled `selectedValue` gets
	// pointed at the new first document in the same commit as the freshly
	// mounted DocumentCommandRegistration children. With a plain
	// `useEffect`, the user would see a frame where the new documents
	// rendered without a visible highlight (cmdk's old pick is filtered
	// out by the new query) before React flushed the selection update.
	useLayoutEffect( () => {
		if ( ! hasFreshDocuments ) {
			return;
		}
		setHasEverResolved( true );
		onDocumentsResolved( firstDocumentValue( documents ) );
	}, [ hasFreshDocuments, documents, onDocumentsResolved ] );

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

	// Hide everything until the first successful response, and drop the
	// stale list whenever a fetch fails so the user does not navigate to a
	// document that no longer matches their query.
	if ( ! hasEverResolved || error ) {
		return null;
	}

	return documents.map( ( doc ) => (
		<DocumentCommandRegistration
			key={ `${ doc.kind }:${ doc.id }` }
			canvasRef={ canvasRef }
			document={ doc }
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
	// Controlled cmdk selection. When the first batch of documents arrives,
	// anchor the selection on the first result so it doesn't sit on whatever
	// recent/static command was selected before. After that cmdk owns the
	// value: arrow-key moves, item unmounts (search refinement that drops
	// the prior selection) and clicks all flow back here. Clearing the
	// input resets the anchor so the next session starts fresh.
	const [ selectedValue, setSelectedValue ] = useState();
	const isPaletteOpen = useSelect(
		( select ) => select( commandsStore ).isOpen(),
		[]
	);

	const isDebouncing = search !== debouncedSearch;
	const shouldFetchDocuments = isPaletteOpen && Boolean( debouncedSearch );
	const isDocumentSearchPending =
		Boolean( search ) && ( isDebouncing || isFetchingDocuments );

	useEffect( () => {
		if ( ! search ) {
			setSelectedValue( undefined );
		}
	}, [ search ] );

	// Reset the input and the controlled selection whenever the palette
	// closes, regardless of how it closed. Picking a result calls
	// `close()` directly without going through `closeAndReset`, so without
	// this the next open would land with a stale search string and a
	// selection pinned to an item that may no longer be relevant.
	useEffect( () => {
		if ( ! isPaletteOpen ) {
			setSearch( '' );
			setSelectedValue( undefined );
		}
	}, [ isPaletteOpen ] );

	const handleDocumentsResolved = useCallback( ( firstValue ) => {
		if ( ! firstValue ) {
			return;
		}
		setSelectedValue( ( current ) => current ?? firstValue );
	}, [] );

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
					onDocumentsResolved={ handleDocumentsResolved }
				/>
			) }
			<CortextCommandMenu
				search={ search }
				setSearch={ setSearch }
				isDocumentSearchPending={ isDocumentSearchPending }
				selectedValue={ selectedValue }
				onSelectedValueChange={ setSelectedValue }
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
