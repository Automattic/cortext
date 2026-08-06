// tech-debt.md#td-command-palette-host-glue: use WordPress' palette UI, but keep it on a local
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
import { home as homeIcon } from '@wordpress/icons';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from '@wordpress/element';

import CommandPalettePreview from './CommandPalettePreview';
import CortextCommandMenu, {
	CommandDescriptionContext,
} from './CortextCommandMenu';
import useDebouncedValue from '../hooks/useDebouncedValue';
import useDocuments from '../hooks/useDocuments';
import { useRecents } from '../hooks/useRecents';
import { useWorkspaceHomePath } from '../hooks/useWorkspaceHomePath';
import { collectionHint, listIconForRecord } from '../documents';

const OPEN_COMMAND_PALETTE_EVENT = 'cortext:open-command-palette';
const DEFAULT_COMMAND_CONTEXT = 'root';
// cmdk item values, as CortextCommandMenu builds them from the command name.
const DOCUMENT_COMMAND_VALUE_PREFIX = 'document-cortext/document/';
const RECENT_COMMAND_VALUE_PREFIX = 'recent-cortext/recent/';
const EMPTY_DOCUMENTS = [];

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

function documentTitle( doc ) {
	const title = doc?.title?.trim?.() || __( '(untitled)', 'cortext' );
	const collectionTitle = doc?.collection?.title?.trim?.();
	if ( ! collectionTitle ) {
		return title;
	}
	return sprintf(
		/* translators: 1: row title, 2: collection title */
		__( '%1$s in %2$s', 'cortext' ),
		title,
		collectionTitle
	);
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
		name: `cortext/recent/${ recent.id }`,
		label: documentTitle( recent ),
		searchLabel: sprintf(
			/* translators: %s: recent item title */
			__( 'Open recent: %s', 'cortext' ),
			documentTitle( recent )
		),
		context: DEFAULT_COMMAND_CONTEXT,
		icon: listIconForRecord( recent ),
		keywords: [ __( 'recent', 'cortext' ) ],
		disabled: ! recent.path,
		callback: goToRecent,
	} );
	return null;
}

function documentDescription( doc ) {
	// Rows ship their parent collection on `doc.collection` so identical row
	// titles in the search results stay disambiguated. Pages and collections
	// have no parent on the wire and fall back to the search excerpt.
	return collectionHint( doc ) || doc?.excerpt?.trim?.() || '';
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
		name: `cortext/document/${ document.id }`,
		label: document.title?.trim?.() || __( '(untitled)', 'cortext' ),
		context: DEFAULT_COMMAND_CONTEXT,
		icon: listIconForRecord( document ),
		disabled: ! document.path,
		callback: goToDocument,
	} );
	return null;
}

function documentCommandValue( doc ) {
	return `${ DOCUMENT_COMMAND_VALUE_PREFIX }${ doc.id }`;
}

function documentCommandValues( documents ) {
	return documents.map( documentCommandValue );
}

function recentCommandValue( recent ) {
	return `${ RECENT_COMMAND_VALUE_PREFIX }${ recent.id }`;
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
		onDocumentsResolved( documents );
	}, [ hasFreshDocuments, documents, onDocumentsResolved ] );

	// The list drops its results on a failed fetch (below), and unmounts when
	// the input goes empty. Report that too, so the preview pane cannot keep
	// showing a document the list no longer offers.
	useEffect( () => {
		if ( error ) {
			onDocumentsResolved( EMPTY_DOCUMENTS );
		}
	}, [ error, onDocumentsResolved ] );

	useEffect( () => {
		return () => onDocumentsResolved( EMPTY_DOCUMENTS );
	}, [ onDocumentsResolved ] );

	useEffect( () => {
		if ( ! hasFreshDocuments ) {
			return undefined;
		}
		const map = new Map();
		for ( const doc of documents ) {
			const description = documentDescription( doc );
			if ( description ) {
				map.set( `cortext/document/${ doc.id }`, description );
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
			key={ doc.id }
			canvasRef={ canvasRef }
			document={ doc }
		/>
	) );
}

function CommandPaletteContents( {
	appRegistry,
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
	const [ resolvedDocuments, setResolvedDocuments ] =
		useState( EMPTY_DOCUMENTS );
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

	// cmdk only reports its pick through `onValueChange` while the value is
	// controlled. Left to itself with an empty input it highlights the first
	// recent without telling anyone, and the preview pane has nothing to show.
	// Anchoring on that same first recent keeps the highlight where cmdk would
	// have put it and makes it visible to the pane.
	useEffect( () => {
		if ( search ) {
			return;
		}
		setSelectedValue(
			recents.length ? recentCommandValue( recents[ 0 ] ) : undefined
		);
	}, [ search, recents ] );

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

	const handleDocumentsResolved = useCallback( ( documents ) => {
		setResolvedDocuments( documents );
		if ( documents.length === 0 ) {
			return;
		}
		const values = documentCommandValues( documents );
		setSelectedValue( ( current ) => {
			// If the user's current selection survived into the new
			// result set, keep it. Otherwise jump to the first new doc so
			// the highlight does not blink off while cmdk's internal
			// recovery is still scheduled.
			if ( current && values.includes( current ) ) {
				return current;
			}
			return values[ 0 ];
		} );
	}, [] );

	// Recents and search results are both documents, so both preview. Commands
	// have nothing to show and leave the pane empty rather than closing it.
	const previewDoc = useMemo( () => {
		if ( ! selectedValue ) {
			return null;
		}
		if ( search ) {
			return (
				resolvedDocuments.find(
					( doc ) => documentCommandValue( doc ) === selectedValue
				) ?? null
			);
		}
		return (
			recents.find(
				( recent ) => recentCommandValue( recent ) === selectedValue
			) ?? null
		);
	}, [ search, selectedValue, resolvedDocuments, recents ] );

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
					key={ `recent:${ recent.id }` }
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
				previewPane={
					// Back on the app registry. The block editor store only
					// lives there, and the preview's provider reads that
					// store's private actions off its parent.
					<RegistryProvider value={ appRegistry }>
						<CommandPalettePreview doc={ previewDoc } />
					</RegistryProvider>
				}
			/>
		</CommandDescriptionContext.Provider>
	);
}

export default function CommandPalette( { canvasRef } ) {
	const { homePath, isResolvingHomePath } = useWorkspaceHomePath();
	const appRegistry = useRegistry();
	const registry = useMemo(
		() => createCommandPaletteRegistry( appRegistry ),
		[ appRegistry ]
	);

	return (
		<RegistryProvider value={ registry }>
			<CommandPaletteContents
				appRegistry={ appRegistry }
				canvasRef={ canvasRef }
				homePath={ homePath }
				isResolvingHomePath={ isResolvingHomePath }
			/>
		</RegistryProvider>
	);
}
