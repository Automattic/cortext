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
} from './rowDetailUtils';
import { rowRoute } from './relations/relationUtils';

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
const PeekSurfaceContext = createContext( null );

export function useDocumentPeekActions() {
	return useContext( PeekActionsContext );
}

export function useDocumentPeekState() {
	return useContext( PeekStateContext );
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

const ROW_DETAIL_SIDE_SURFACE_EXIT_MS = 300;
const ROW_DETAIL_MODAL_ENTER_MS = 200;
const ROW_DETAIL_SIDE_TO_MODAL_HANDOFF_MS =
	ROW_DETAIL_SIDE_SURFACE_EXIT_MS - ROW_DETAIL_MODAL_ENTER_MS;

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
}

// Keep peek state at app scope. A row opened from one collection can stay open
// while the route changes. DocumentPeekHost renders the heavy RowDetailView
// stack separately, so action-only callers do not import it.
export function DocumentPeekProvider( { children } ) {
	const navigate = useNavigate();

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

	// Side-to-modal animation: keep the old panel mounted briefly so it can
	// slide out instead of disappearing.
	const [ modeSurfaceTransition, setModeSurfaceTransition ] =
		useState( null );
	const modeSurfaceTransitionTimeoutRef = useRef( null );

	const clearModeSurfaceTransition = useCallback( () => {
		if ( modeSurfaceTransitionTimeoutRef.current ) {
			clearTimeout( modeSurfaceTransitionTimeoutRef.current );
			modeSurfaceTransitionTimeoutRef.current = null;
		}
		setModeSurfaceTransition( null );
	}, [] );

	useEffect(
		() => () => {
			if ( modeSurfaceTransitionTimeoutRef.current ) {
				clearTimeout( modeSurfaceTransitionTimeoutRef.current );
			}
		},
		[]
	);

	const setDetailApi = useCallback( ( api ) => {
		detailApiRef.current = api;
	}, [] );

	const applyTransition = useCallback(
		( transition ) => {
			setSaveError( null );
			setPendingTransition( null );

			if ( transition.type === 'close' ) {
				clearModeSurfaceTransition();
				setPeek( null );
				setIsPinned( false );
			} else if ( transition.type === 'peek' ) {
				clearModeSurfaceTransition();
				setPeek( transition.peek );
				setIsPinned( ( current ) =>
					transition.preservePin ? current : false
				);
			} else if ( transition.type === 'mode' ) {
				setPeek( ( current ) =>
					current ? { ...current, mode: transition.mode } : current
				);
			} else if ( transition.type === 'full' ) {
				clearModeSurfaceTransition();
				setPeek( null );
				setIsPinned( false );
				navigate( {
					to: '/$',
					params: { _splat: transition.uri },
				} );
			}
		},
		[ clearModeSurfaceTransition, navigate ]
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
							'Cortext could not save row changes. Retry or discard your edits to continue.',
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
					runTransition( { type: 'full', uri } );
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
		async ( mode ) => {
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
					runTransition( { type: 'full', uri } );
				}
				return;
			}
			if ( mode === current.mode ) {
				return;
			}
			current.source?.onModeChange?.( mode );

			if (
				current.mode === 'side' &&
				mode === 'modal' &&
				! prefersReducedMotion()
			) {
				setModeSurfaceTransition( { surfaceMode: 'side' } );
				const didSwitch = await runTransition( {
					type: 'mode',
					mode,
				} );
				if ( ! didSwitch ) {
					clearModeSurfaceTransition();
					return;
				}
				setModeSurfaceTransition( { surfaceMode: null } );
				modeSurfaceTransitionTimeoutRef.current = setTimeout( () => {
					modeSurfaceTransitionTimeoutRef.current = null;
					setModeSurfaceTransition( null );
				}, ROW_DETAIL_SIDE_TO_MODAL_HANDOFF_MS );
				return;
			}

			clearModeSurfaceTransition();
			runTransition( { type: 'mode', mode } );
		},
		[ clearModeSurfaceTransition, runTransition ]
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
			modeSurfaceTransition,
			saveError,
			setDetailApi,
			goToAdjacentDocument,
			retryPendingTransition,
			discardPendingTransition,
			togglePin,
		} ),
		[
			modeSurfaceTransition,
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
				<PeekSurfaceContext.Provider value={ surface }>
					{ children }
				</PeekSurfaceContext.Provider>
			</PeekStateContext.Provider>
		</PeekActionsContext.Provider>
	);
}
