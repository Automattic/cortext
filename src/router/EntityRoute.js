import { useNavigate, useParams } from '@tanstack/react-router';
import { Notice, Spinner } from '@wordpress/components';
import { useEntityRecords } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { useSearch } from '@wordpress/route';
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from '@wordpress/element';

import Canvas from '../components/Canvas';
import CollectionDataViews from '../components/CollectionDataViews';
import { CollectionFieldsProvider } from '../components/CollectionFieldsContext';
import { RowFullEditorContext } from '../components/RowFullEditorContext';
import { RowDetailSidebarSlot } from '../components/RowDetailSidebarSlot';
import WorkspaceTopBar from '../components/WorkspaceTopBar';
import { ACTIVE_PAGES_QUERY, POST_TYPE } from '../components/page-queries';
import { firstPageInTree } from '../components/pages-tree';
import { withViewTransition } from '../hooks/viewTransition';
import { useWorkspaceHome } from '../hooks/useWorkspaceHome';
import EmptyState from './EmptyState';
import {
	computeUri,
	useResolveEntity,
	useResolveCollection,
} from './useResolveEntity';
import { init, parseTarget, reducer } from './entityRouteReducer';

const DEFAULT_VIEW = {
	type: 'table',
	fields: [],
	sort: null,
	filters: [],
	calculations: {},
	perPage: 25,
	page: 1,
	search: '',
	layout: {},
	rowDetailMode: 'side',
};
const ROW_SEARCH_KEY = 'row';

function parseSearchId( value ) {
	if ( Array.isArray( value ) ) {
		return parseSearchId( value[ 0 ] );
	}
	const id = Number.parseInt( String( value ).replaceAll( '"', '' ), 10 );
	return Number.isFinite( id ) && id > 0 ? id : null;
}

function CollectionView( { collectionId, onReady } ) {
	const [ view, setView ] = useState( DEFAULT_VIEW );

	return (
		<CollectionDataViews
			collectionId={ collectionId }
			view={ view }
			onChangeView={ setView }
			onReady={ onReady }
			loading={
				<div className="cortext-canvas__loading">
					<Spinner />
				</div>
			}
			empty={
				<span className="cortext-canvas__empty-text">
					{ __( 'No entries yet.', 'cortext' ) }
				</span>
			}
		/>
	);
}

function CollectionPane( { collectionId, onReady } ) {
	return (
		<CollectionFieldsProvider collectionId={ collectionId }>
			<div className="cortext-collection-pane">
				<div className="cortext-canvas__table">
					<CollectionView
						collectionId={ collectionId }
						onReady={ onReady }
					/>
				</div>
				<RowDetailSidebarSlot />
			</div>
		</CollectionFieldsProvider>
	);
}

function LoadingPane() {
	return (
		<div className="cortext-canvas__loading">
			<Spinner />
		</div>
	);
}

function NotFoundPane( { type } ) {
	return (
		<div className="cortext-canvas__empty">
			<p>
				{ type === 'collection'
					? __( "That collection doesn't exist.", 'cortext' )
					: __( "That page doesn't exist.", 'cortext' ) }
			</p>
		</div>
	);
}

function WorkspacePane( { active, preservePaint = false, children } ) {
	return (
		<div
			className="cortext-workspace__pane"
			data-active={ active ? 'true' : 'false' }
			data-preserve-paint={ preservePaint ? 'true' : 'false' }
			aria-hidden={ ! active }
			{ ...( active ? {} : { inert: '' } ) }
		>
			{ children }
		</div>
	);
}

function RowFullSaveNotice( { message, onDiscard, onRetry } ) {
	if ( ! message ) {
		return null;
	}

	return (
		<Notice
			className="cortext-canvas__notice"
			status="error"
			isDismissible={ false }
			actions={ [
				{
					label: __( 'Retry', 'cortext' ),
					onClick: onRetry,
					variant: 'primary',
				},
				{
					label: __( 'Discard', 'cortext' ),
					onClick: onDiscard,
					variant: 'tertiary',
				},
			] }
		>
			{ message }
		</Notice>
	);
}

export default function EntityRoute( { history } ) {
	const params = useParams( { strict: false } );
	const navigate = useNavigate();
	const search = useSearch( { strict: false } );
	const routeRowId = parseSearchId( search?.[ ROW_SEARCH_KEY ] );
	const splat = params._splat ?? '';
	const target = useMemo( () => parseTarget( splat ), [ splat ] );
	const { home, isResolving: isResolvingHome } = useWorkspaceHome();
	const { records: pages, isResolving: isResolvingPages } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);

	const [ state, rawDispatch ] = useReducer( reducer, target, init );
	const { active, mountedPageId, displayedPageId, mountedCollectionIds } =
		state;

	// Run the reducer ahead of time so we only wrap the dispatch when
	// `active` actually flips. Otherwise every PAGE_RESOLVED or
	// COLLECTION_RESOLVED would pin the canvas for the cross-fade
	// duration even though nothing visible changed.
	const stateRef = useRef( state );
	stateRef.current = state;
	const dispatch = useCallback( ( action ) => {
		const before = stateRef.current;
		const after = reducer( before, action );
		const visualChanged =
			before.active.kind !== after.active.kind ||
			( before.active.id ?? null ) !== ( after.active.id ?? null );
		if ( ! visualChanged ) {
			rawDispatch( action );
			return;
		}
		withViewTransition( () => rawDispatch( action ) );
	}, [] );

	const pageResolution = useResolveEntity(
		target.kind === 'page' ? target.tail : ''
	);
	const collectionResolution = useResolveCollection(
		target.kind === 'collection' ? target.id : null
	);

	useEffect( () => {
		dispatch( { type: 'TARGET_CHANGED', target } );
	}, [ target, dispatch ] );

	useEffect( () => {
		if ( target.kind !== 'empty' ) {
			return;
		}
		if ( isResolvingHome || isResolvingPages ) {
			return;
		}

		const fallback = firstPageInTree( pages ?? [] );
		const path = home?.path ?? ( fallback ? computeUri( fallback ) : null );
		if ( ! path ) {
			return;
		}

		navigate( {
			to: '/$',
			params: { _splat: path },
			replace: true,
		} );
	}, [
		target.kind,
		home,
		isResolvingHome,
		pages,
		isResolvingPages,
		navigate,
	] );

	useEffect( () => {
		if ( target.kind !== 'page' || target.id === null ) {
			return;
		}
		const {
			entity,
			isResolving,
			notFound,
			id: resolvedFor,
		} = pageResolution;
		// Drop a stale snapshot from the previous target; the resolver
		// resets to the new id on its next effect run.
		if ( resolvedFor !== target.id ) {
			return;
		}
		if ( entity?.id === target.id ) {
			dispatch( { type: 'PAGE_RESOLVED', id: entity.id } );
			return;
		}
		if ( ! isResolving && notFound ) {
			dispatch( { type: 'PAGE_NOT_FOUND' } );
		}
	}, [ target, pageResolution, dispatch ] );

	useEffect( () => {
		if ( target.kind !== 'collection' || target.id === null ) {
			return;
		}
		const {
			entity,
			isResolving,
			notFound,
			id: resolvedFor,
		} = collectionResolution;
		if ( resolvedFor !== target.id ) {
			return;
		}
		if ( entity?.id === target.id ) {
			dispatch( { type: 'COLLECTION_RESOLVED', id: entity.id } );
			return;
		}
		if ( ! isResolving && notFound ) {
			dispatch( { type: 'COLLECTION_NOT_FOUND' } );
		}
	}, [ target, collectionResolution, dispatch ] );

	const handlePageDisplayed = useCallback(
		( id ) => {
			dispatch( { type: 'PAGE_DISPLAYED', id } );
		},
		[ dispatch ]
	);

	const handleCollectionReady = useCallback(
		( id ) => {
			dispatch( { type: 'COLLECTION_READY', id } );
		},
		[ dispatch ]
	);

	const rowFullApiRef = useRef( null );
	const [ rowFullTarget, setRowFullTarget ] = useState( null );
	const rowFullTargetRef = useRef( rowFullTarget );
	rowFullTargetRef.current = rowFullTarget;
	const [ rowFullSaveError, setRowFullSaveError ] = useState( null );
	const [ pendingRowFullTransition, setPendingRowFullTransition ] =
		useState( null );
	const [ suppressedRouteRow, setSuppressedRouteRow ] = useState( null );

	const openRowFull = useCallback( ( rowTarget ) => {
		setSuppressedRouteRow( null );
		setRowFullSaveError( null );
		setPendingRowFullTransition( null );
		withViewTransition( () => setRowFullTarget( rowTarget ) );
	}, [] );

	const clearSuppressedRouteRow = useCallback( () => {
		setSuppressedRouteRow( null );
	}, [] );

	const rowFullContext = useMemo(
		() => ( {
			clearSuppressedRouteRow,
			openRowFull,
			suppressedRouteRow,
		} ),
		[ clearSuppressedRouteRow, openRowFull, suppressedRouteRow ]
	);

	const setRowFullApi = useCallback( ( api ) => {
		rowFullApiRef.current = api;
	}, [] );

	const applyRowFullTransition = useCallback( ( transition ) => {
		const currentRowTarget = rowFullTargetRef.current;
		if ( ! currentRowTarget ) {
			return;
		}

		setRowFullSaveError( null );
		setPendingRowFullTransition( null );

		if ( transition.type === 'close' ) {
			setSuppressedRouteRow( {
				collectionId: currentRowTarget.collectionId,
				rowId: currentRowTarget.rowId,
			} );
			currentRowTarget.onClose?.();
			withViewTransition( () => setRowFullTarget( null ) );
		} else if ( transition.type === 'mode' ) {
			currentRowTarget.onModeChange?.(
				transition.mode,
				currentRowTarget.rowId
			);
			withViewTransition( () => setRowFullTarget( null ) );
		}
	}, [] );

	const runRowFullTransition = useCallback(
		async ( transition, options = {} ) => {
			const api = rowFullApiRef.current;
			setRowFullSaveError( null );

			if ( options.discard ) {
				api?.discard?.();
				applyRowFullTransition( transition );
				return true;
			}

			if ( api?.flushNow ) {
				const didSave = await api.flushNow();
				if ( ! didSave ) {
					setPendingRowFullTransition( transition );
					setRowFullSaveError(
						__(
							'Row changes could not be saved. Retry or discard the pending edits to continue.',
							'cortext'
						)
					);
					return false;
				}
			}

			applyRowFullTransition( transition );
			return true;
		},
		[ applyRowFullTransition ]
	);

	const retryPendingRowFullTransition = useCallback( () => {
		if ( pendingRowFullTransition ) {
			runRowFullTransition( pendingRowFullTransition );
		}
	}, [ pendingRowFullTransition, runRowFullTransition ] );

	const discardPendingRowFullTransition = useCallback( () => {
		if ( pendingRowFullTransition ) {
			runRowFullTransition( pendingRowFullTransition, {
				discard: true,
			} );
		}
	}, [ pendingRowFullTransition, runRowFullTransition ] );

	useEffect( () => {
		if ( ! rowFullTarget ) {
			return;
		}
		if ( String( routeRowId ) === String( rowFullTarget.rowId ) ) {
			return;
		}
		runRowFullTransition( { type: 'close' } );
	}, [ routeRowId, rowFullTarget, runRowFullTransition ] );

	const rowFullNotice = (
		<RowFullSaveNotice
			message={ rowFullSaveError }
			onDiscard={ discardPendingRowFullTransition }
			onRetry={ retryPendingRowFullTransition }
		/>
	);
	const navigateRowFullToCollection = useCallback( () => {
		runRowFullTransition( { type: 'close' } );
	}, [ runRowFullTransition ] );

	// Drives the breadcrumb from the same paint state the document-actions
	// Fill uses, so both sides of the top bar update together. Use
	// `displayedPageId` rather than `mountedPageId` for the page case: when
	// navigating page A → B, mountedPageId flips to B as soon as B resolves,
	// but Canvas keeps painting A until autosave flushes and `setDisplayedPost`
	// catches up. Reading the mounted id would let the breadcrumb jump to B
	// while A is still on screen.
	let paintedRoute = { kind: 'unresolved' };
	if ( rowFullTarget ) {
		paintedRoute = {
			kind: 'row',
			collectionId: rowFullTarget.collectionId,
			id: rowFullTarget.rowId,
			onNavigateCollection: navigateRowFullToCollection,
			postType: rowFullTarget.postType,
		};
	} else if ( active.kind === 'page' && displayedPageId !== null ) {
		paintedRoute = { kind: 'page', id: displayedPageId };
	} else if ( active.kind === 'collection' ) {
		paintedRoute = { kind: 'collection', id: active.id };
	} else if (
		active.kind === 'empty' ||
		active.kind === 'page-not-found' ||
		active.kind === 'collection-not-found'
	) {
		paintedRoute = { kind: active.kind };
	}

	const editorPostId = rowFullTarget?.rowId ?? mountedPageId;
	const editorPostType = rowFullTarget?.postType;
	const isEditorActive = Boolean( rowFullTarget ) || active.kind === 'page';

	return (
		<RowFullEditorContext.Provider value={ rowFullContext }>
			<WorkspaceTopBar
				history={ history }
				paintedRoute={ paintedRoute }
			/>
			<div className="cortext-workspace">
				{ editorPostId !== null && (
					<WorkspacePane active={ isEditorActive } preservePaint>
						<Canvas
							postId={ editorPostId }
							postType={ editorPostType }
							onDisplayedPost={
								rowFullTarget ? undefined : handlePageDisplayed
							}
							isActive={ isEditorActive }
							notice={ rowFullNotice }
							onApi={ rowFullTarget ? setRowFullApi : undefined }
							onSaved={ rowFullTarget?.onSaved }
						/>
					</WorkspacePane>
				) }

				{ mountedCollectionIds.map( ( id ) => (
					<WorkspacePane
						key={ id }
						active={
							! rowFullTarget &&
							active.kind === 'collection' &&
							active.id === id
						}
					>
						<CollectionPane
							collectionId={ id }
							onReady={ handleCollectionReady }
						/>
					</WorkspacePane>
				) ) }

				<WorkspacePane
					active={ ! rowFullTarget && active.kind === 'empty' }
				>
					<EmptyState />
				</WorkspacePane>
				<WorkspacePane
					active={
						! rowFullTarget && active.kind === 'page-not-found'
					}
				>
					<NotFoundPane type="page" />
				</WorkspacePane>
				<WorkspacePane
					active={
						! rowFullTarget &&
						active.kind === 'collection-not-found'
					}
				>
					<NotFoundPane type="collection" />
				</WorkspacePane>
				<WorkspacePane
					active={ ! rowFullTarget && active.kind === 'loading' }
				>
					<LoadingPane />
				</WorkspacePane>
			</div>
		</RowFullEditorContext.Provider>
	);
}
