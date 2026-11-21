import { useNavigate } from '@wordpress/route';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import {
	DEFAULT_ROW_DETAIL_MODE,
	normalizeRowDetailMode,
	setPeekToFullStage,
} from './rowDetailUtils';
import { rowRoute } from './relations/relationUtils';
import { useActiveEditor } from './ActiveEditorContext';
import { rowSourceCollectionSearch } from '../router/rowSourceCollection';
import {
	joinNextViewTransition,
	whenViewTransitionsSettled,
} from '../hooks/viewTransition';

// Split the contexts so callers don't rerender on state they do not use:
// chips need actions, tables need peek state, and the host needs save and
// transition hooks.
//
// The action and state contexts ship with safe defaults so that consumers
// rendered outside the app shell (e.g. CollectionDataViews inside the block
// editor preview of a data-view block) keep working: opening a row is a no-op
// there, and there is no peek to read. Only the host hook requires the real
// provider, since rendering the peek surface without it makes no sense.
const NO_PEEK_ACTIONS = {
	openDocument: () => {},
	closeDocument: () => {},
	requestMode: () => {},
};
const NO_PEEK_STATE = { peek: null, isPinned: false };

const PeekActionsContext = createContext( NO_PEEK_ACTIONS );
const PeekStateContext = createContext( NO_PEEK_STATE );
const PeekOpenIdContext = createContext( null );
const PeekSurfaceContext = createContext( null );

export function useDocumentPeekActions() {
	return useContext( PeekActionsContext );
}

export function useDocumentPeekState() {
	return useContext( PeekStateContext );
}

// Tables only need to know which row is open. Reading the whole peek state
// would re-render every cell on each mode switch.
export function useOpenDocumentId() {
	return useContext( PeekOpenIdContext );
}

export function useDocumentPeekSurface() {
	const value = useContext( PeekSurfaceContext );
	if ( ! value ) {
		throw new Error(
			'useDocumentPeekSurface must be used inside DocumentPeekProvider'
		);
	}
	return value;
}

// If the route never starts a view transition for the full-screen swap, close
// the peek anyway after this long.
const PEEK_TO_FULL_FALLBACK_MS = 2000;
// Matches the shell's resize transition in RowDetailView.scss.
const PEEK_RESIZE_MS = 280;

// Keep peek state at app scope. A row opened from one collection can stay open
// while the route changes. DocumentPeekHost renders the heavy RowDetailView
// stack separately, so action-only callers do not import it.
export function DocumentPeekProvider( { children } ) {
	const navigate = useNavigate();
	const { registerPeekEditor } = useActiveEditor();

	// peek: null | { docId, slug, postType, collectionId, mode, source }
	// source is the caller's optional context: { collectionId, getRowList, refresh, onModeChange }
	const [ peek, setPeek ] = useState( null );
	const peekRef = useRef( peek );
	peekRef.current = peek;

	// The pin lives in memory. Closing the peek or opening it full-page clears
	// it, but row-to-row moves keep it so a pinned peek stays put.
	const [ isPinned, setIsPinned ] = useState( false );
	const isPinnedRef = useRef( isPinned );
	isPinnedRef.current = isPinned;

	// RowDetailView exposes flush/discard through onApi. Run it before close or
	// row switches so unsaved edits do not vanish.
	const detailApiRef = useRef( null );
	const [ pendingTransition, setPendingTransition ] = useState( null );
	const [ saveError, setSaveError ] = useState( null );

	// Full screen keeps the peek on screen until the route swaps the page in,
	// then closes it inside that view transition so the panel grows into it.
	const pendingFullExitRef = useRef( null );
	const cancelPendingFullExit = useCallback( () => {
		const pending = pendingFullExitRef.current;
		if ( ! pending ) {
			return;
		}
		pending.leave();
		clearTimeout( pending.timeout );
		pendingFullExitRef.current = null;
		setPeekToFullStage( null );
	}, [] );
	useEffect( () => cancelPendingFullExit, [ cancelPendingFullExit ] );
	const exitToFull = useCallback( () => {
		const finish = () => {
			clearTimeout( pendingFullExitRef.current?.timeout );
			pendingFullExitRef.current = null;
			setPeekToFullStage( 'entering' );
			setPeek( null );
			whenViewTransitionsSettled( 0 ).then( () =>
				setPeekToFullStage( null )
			);
		};
		setPeekToFullStage( 'leaving' );
		setPeek( ( current ) =>
			current ? { ...current, isExiting: true } : current
		);
		pendingFullExitRef.current = {
			leave: joinNextViewTransition( finish ),
			timeout: setTimeout( () => {
				pendingFullExitRef.current?.leave();
				finish();
			}, PEEK_TO_FULL_FALLBACK_MS ),
		};
	}, [] );

	const setDetailApi = useCallback(
		( api ) => {
			detailApiRef.current = api;
			registerPeekEditor( api );
		},
		[ registerPeekEditor ]
	);

	// Saving the peek mode re-renders the whole collection view, so it waits
	// until the resize is over and the main thread is free. Any other
	// transition saves it right away, while the collection is still mounted.
	const pendingModeSaveRef = useRef( null );
	const saveModeNow = useCallback( () => {
		const save = pendingModeSaveRef.current;
		pendingModeSaveRef.current = null;
		save?.();
	}, [] );
	const saveModeLater = useCallback(
		( save ) => {
			pendingModeSaveRef.current = save;
			setTimeout( () => {
				if ( typeof window.requestIdleCallback === 'function' ) {
					window.requestIdleCallback( saveModeNow, {
						timeout: 1000,
					} );
				} else {
					saveModeNow();
				}
			}, PEEK_RESIZE_MS );
		},
		[ saveModeNow ]
	);

	const applyTransition = useCallback(
		( transition ) => {
			setSaveError( null );
			setPendingTransition( null );
			cancelPendingFullExit();
			if ( transition.type !== 'mode' ) {
				saveModeNow();
			}

			if ( transition.type === 'close' ) {
				setPeek( null );
				setIsPinned( false );
			} else if ( transition.type === 'peek' ) {
				setPeek( transition.peek );
				setIsPinned( ( current ) =>
					transition.preservePin ? current : false
				);
			} else if ( transition.type === 'mode' ) {
				setPeek( ( current ) =>
					current ? { ...current, mode: transition.mode } : current
				);
			} else if ( transition.type === 'full' ) {
				setIsPinned( false );
				if ( peekRef.current ) {
					exitToFull();
				}
				navigate( {
					to: '/$',
					params: { _splat: transition.uri },
					search: rowSourceCollectionSearch(
						transition.documentId,
						transition.collectionId
					),
				} );
			}
		},
		[ cancelPendingFullExit, exitToFull, navigate, saveModeNow ]
	);

	const runTransition = useCallback(
		async ( transition, options = {} ) => {
			const api = detailApiRef.current;
			setSaveError( null );

			// Capture the open peek's source before flushing. flushNow may
			// resolve after RowDetailView has already unmounted (close / full),
			// so its onSaved won't reach us. We trigger source.refresh here
			// instead, with the same "only when there were pending edits"
			// signal the old CDV runDetailTransition used.
			const refreshAfterFlush = api?.hasPendingEdits?.() ?? false;
			const sourceToRefresh = peekRef.current?.source ?? null;

			if ( options.discard ) {
				api?.discard?.();
				applyTransition( transition );
				sourceToRefresh?.refresh?.();
				return true;
			}

			if ( api?.flushNow ) {
				const didSave = await api.flushNow();
				if ( ! didSave ) {
					setPendingTransition( transition );
					setSaveError(
						__(
							"Couldn't save changes. Retry or discard your edits to continue.",
							'cortext'
						)
					);
					return false;
				}
			}

			applyTransition( transition );
			if ( refreshAfterFlush ) {
				sourceToRefresh?.refresh?.();
			}
			return true;
		},
		[ applyTransition ]
	);

	const openDocument = useCallback(
		( {
			id,
			slug = '',
			postType = null,
			collectionId = null,
			preferredMode = DEFAULT_ROW_DETAIL_MODE,
			source = null,
		} ) => {
			if ( ! id ) {
				return;
			}
			const current = peekRef.current;
			const currentMode = current?.mode;
			// If a side/modal peek is already open, reuse its mode. Caller
			// preference only matters for the first open.
			const isSticky = currentMode === 'side' || currentMode === 'modal';
			const nextMode = isSticky
				? currentMode
				: normalizeRowDetailMode( preferredMode );
			const preservePin = isSticky && isPinnedRef.current;

			if ( nextMode === 'full' ) {
				const uri = rowRoute( { id, slug } );
				if ( uri ) {
					runTransition( {
						type: 'full',
						uri,
						documentId: id,
						collectionId,
					} );
				}
				return;
			}

			runTransition( {
				type: 'peek',
				preservePin,
				peek: {
					docId: id,
					slug,
					postType,
					collectionId,
					mode: nextMode,
					source,
				},
			} );
		},
		[ runTransition ]
	);

	const closeDocument = useCallback(
		() => runTransition( { type: 'close' } ),
		[ runTransition ]
	);

	const requestMode = useCallback(
		( mode ) => {
			const current = peekRef.current;
			if ( ! current ) {
				return;
			}
			if ( mode === 'full' ) {
				const uri = rowRoute( {
					id: current.docId,
					slug: current.slug,
				} );
				if ( uri ) {
					runTransition( {
						type: 'full',
						uri,
						documentId: current.docId,
						collectionId: current.collectionId,
					} );
				}
				return;
			}
			if ( mode === current.mode ) {
				return;
			}
			// The editor stays mounted across modes, so there are no edits to
			// flush first. Switch right away so the resize starts on the click.
			applyTransition( { type: 'mode', mode } );
			saveModeLater( () => current.source?.onModeChange?.( mode ) );
		},
		[ applyTransition, runTransition, saveModeLater ]
	);

	const goToAdjacentDocument = useCallback(
		( direction ) => {
			const current = peekRef.current;
			if ( ! current ) {
				return;
			}
			const rows = current.source?.getRowList?.() ?? [];
			const idx = rows.findIndex(
				( candidate ) =>
					String( candidate?.id ) === String( current.docId )
			);
			if ( idx < 0 ) {
				return;
			}
			const nextRow = rows[ idx + direction ];
			if ( ! nextRow?.id ) {
				return;
			}
			runTransition( {
				type: 'peek',
				preservePin: true,
				peek: {
					...current,
					docId: nextRow.id,
					slug: nextRow.slug ?? '',
				},
			} );
		},
		[ runTransition ]
	);

	const retryPendingTransition = useCallback( () => {
		if ( pendingTransition ) {
			runTransition( pendingTransition );
		}
	}, [ pendingTransition, runTransition ] );

	const discardPendingTransition = useCallback( () => {
		if ( pendingTransition ) {
			runTransition( pendingTransition, { discard: true } );
		}
	}, [ pendingTransition, runTransition ] );

	const togglePin = useCallback( () => {
		setIsPinned( ( current ) => ! current );
	}, [] );

	const actions = useMemo(
		() => ( { openDocument, closeDocument, requestMode } ),
		[ openDocument, closeDocument, requestMode ]
	);
	const state = useMemo( () => ( { peek, isPinned } ), [ peek, isPinned ] );
	const surface = useMemo(
		() => ( {
			saveError,
			setDetailApi,
			goToAdjacentDocument,
			retryPendingTransition,
			discardPendingTransition,
			togglePin,
		} ),
		[
			saveError,
			setDetailApi,
			goToAdjacentDocument,
			retryPendingTransition,
			discardPendingTransition,
			togglePin,
		]
	);

	return (
		<PeekActionsContext.Provider value={ actions }>
			<PeekStateContext.Provider value={ state }>
				<PeekOpenIdContext.Provider value={ peek?.docId ?? null }>
					<PeekSurfaceContext.Provider value={ surface }>
						{ children }
					</PeekSurfaceContext.Provider>
				</PeekOpenIdContext.Provider>
			</PeekStateContext.Provider>
		</PeekActionsContext.Provider>
	);
}
