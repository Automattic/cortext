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

import RowDetailView from './RowDetailView';
import { RowDetailSidebar } from './RowDetailSidebarSlot';
import { CurrentViewModeProvider } from './CurrentViewModeContext';
import {
	DEFAULT_ROW_DETAIL_MODE,
	adjacentRowId,
	normalizeRowDetailMode,
} from './rowDetailUtils';
import useCollectionFields from '../hooks/useCollectionFields';
import { rowRoute } from './relations/relationUtils';

// Two contexts so consumers can subscribe narrowly: callers that only fire
// actions (chips, "open row" buttons) re-render on every state change otherwise.
const PeekActionsContext = createContext( null );
const PeekStateContext = createContext( { peek: null } );

export function useDocumentPeekActions() {
	const value = useContext( PeekActionsContext );
	if ( ! value ) {
		throw new Error(
			'useDocumentPeekActions must be used inside DocumentPeekProvider'
		);
	}
	return value;
}

export function useDocumentPeekState() {
	return useContext( PeekStateContext );
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

// EntityRoute prepends the same title field for full-page rows. Keeping the
// shape identical so RowProperties/RowDetailView behave the same in both
// surfaces.
function withTitleField( fields ) {
	return [
		{
			id: 'title',
			label: __( 'Title', 'cortext' ),
			cortextType: 'title',
			editable: true,
			getValue: ( { item } ) =>
				item?.title?.raw ?? item?.title?.rendered ?? '',
		},
		...fields,
	];
}

// Owns peek state at app scope so a peek opened from one collection survives
// a route change to another. State lives here; the surface (side panel via
// SlotFill, or center modal) is rendered alongside `children`.
export function DocumentPeekProvider( { children } ) {
	const navigate = useNavigate();

	// peek: null | { docId, slug, postType, collectionId, mode, source }
	// source is the caller's optional context: { collectionId, getRowList, refresh, onModeChange }
	const [ peek, setPeek ] = useState( null );
	const peekRef = useRef( peek );
	peekRef.current = peek;

	// Pending-save coordination. RowDetailView reports an API via onApi; we
	// flush before swapping panes so partial edits don't get dropped on the
	// floor when the user clicks another row or closes.
	const detailApiRef = useRef( null );
	const [ pendingTransition, setPendingTransition ] = useState( null );
	const [ saveError, setSaveError ] = useState( null );

	// Side↔modal animation: while transitioning we keep painting the old
	// surface for a few frames so it can slide out instead of popping.
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
			} else if ( transition.type === 'peek' ) {
				clearModeSurfaceTransition();
				setPeek( transition.peek );
			} else if ( transition.type === 'mode' ) {
				setPeek( ( current ) =>
					current ? { ...current, mode: transition.mode } : current
				);
			} else if ( transition.type === 'full' ) {
				clearModeSurfaceTransition();
				setPeek( null );
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

			if ( options.discard ) {
				api?.discard?.();
				applyTransition( transition );
				return true;
			}

			if ( api?.flushNow ) {
				const didSave = await api.flushNow();
				if ( ! didSave ) {
					setPendingTransition( transition );
					setSaveError(
						__(
							'Row changes could not be saved. Retry or discard the pending edits to continue.',
							'cortext'
						)
					);
					return false;
				}
			}

			applyTransition( transition );
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
			// Stickiness: a peek already open in side or modal keeps its mode
			// even if the caller asks for a different one. The user's
			// "preferred mode" only applies when nothing is open.
			const isSticky = currentMode === 'side' || currentMode === 'modal';
			const nextMode = isSticky
				? currentMode
				: normalizeRowDetailMode( preferredMode );

			if ( nextMode === 'full' ) {
				const uri = rowRoute( { id, slug } );
				if ( uri ) {
					runTransition( { type: 'full', uri } );
				}
				return;
			}

			runTransition( {
				type: 'peek',
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

	const goToAdjacent = useCallback(
		( direction ) => {
			const current = peekRef.current;
			if ( ! current ) {
				return;
			}
			const rows = current.source?.getRowList?.() ?? [];
			const nextId = adjacentRowId( rows, current.docId, direction );
			if ( ! nextId ) {
				return;
			}
			const nextRow = rows.find(
				( candidate ) => String( candidate?.id ) === String( nextId )
			);
			runTransition( {
				type: 'peek',
				peek: {
					...current,
					docId: nextId,
					slug: nextRow?.slug ?? '',
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

	const actions = useMemo(
		() => ( { openDocument, closeDocument, requestMode } ),
		[ openDocument, closeDocument, requestMode ]
	);
	const state = useMemo( () => ( { peek } ), [ peek ] );

	return (
		<PeekActionsContext.Provider value={ actions }>
			<PeekStateContext.Provider value={ state }>
				{ children }
				<DocumentPeekSurface
					peek={ peek }
					modeSurfaceTransition={ modeSurfaceTransition }
					setDetailApi={ setDetailApi }
					closeDocument={ closeDocument }
					requestMode={ requestMode }
					goToAdjacent={ goToAdjacent }
					retryPendingTransition={ retryPendingTransition }
					discardPendingTransition={ discardPendingTransition }
					saveError={ saveError }
				/>
			</PeekStateContext.Provider>
		</PeekActionsContext.Provider>
	);
}

// Rendered as a sibling of `children` so it can portal independently. Loads
// the open peek's collection fields (when there is one) and hands off to
// RowDetailView, which is the same component CDV used to mount inline.
function DocumentPeekSurface( {
	peek,
	modeSurfaceTransition,
	setDetailApi,
	closeDocument,
	requestMode,
	goToAdjacent,
	retryPendingTransition,
	discardPendingTransition,
	saveError,
} ) {
	const { fields: collectionFields } = useCollectionFields(
		peek?.collectionId ?? null
	);
	const peekFields = useMemo( () => {
		if ( ! peek || ! collectionFields ) {
			return undefined;
		}
		return withTitleField( collectionFields );
	}, [ peek, collectionFields ] );

	const renderedMode = modeSurfaceTransition
		? modeSurfaceTransition.surfaceMode
		: peek?.mode;

	if ( ! peek || ! peekFields || ! renderedMode ) {
		return null;
	}

	const rowList = peek.source?.getRowList?.() ?? [];
	const canGoNext = Boolean(
		peek.source && adjacentRowId( rowList, peek.docId, 1 )
	);
	const canGoPrevious = Boolean(
		peek.source && adjacentRowId( rowList, peek.docId, -1 )
	);
	const handleSaved = () => peek.source?.refresh?.();
	const handleRestored = () => peek.source?.refresh?.();

	const detailView = (
		<CurrentViewModeProvider value={ peek.mode }>
			<RowDetailView
				canGoNext={ canGoNext }
				canGoPrevious={ canGoPrevious }
				collectionId={ peek.collectionId }
				fields={ peekFields }
				mode={ renderedMode }
				onApi={ setDetailApi }
				onClose={ closeDocument }
				onDiscardPending={ discardPendingTransition }
				onModeChange={ requestMode }
				onNext={ () => goToAdjacent( 1 ) }
				onPrevious={ () => goToAdjacent( -1 ) }
				onRestored={ handleRestored }
				onRetryPending={ retryPendingTransition }
				onSaved={ handleSaved }
				postType={ peek.postType }
				row={ undefined }
				rowId={ peek.docId }
				saveError={ saveError }
			/>
		</CurrentViewModeProvider>
	);

	return renderedMode === 'side' ? (
		<RowDetailSidebar.Fill>{ detailView }</RowDetailSidebar.Fill>
	) : (
		detailView
	);
}
