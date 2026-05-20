import { useNavigate, useParams } from '@tanstack/react-router';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from '@wordpress/element';

import Canvas from '../components/Canvas';
import CollectionDataViews from '../components/CollectionDataViews';
import { CollectionFieldsProvider } from '../components/CollectionFieldsContext';
import { RowMutationContext } from '../components/EditableCell';
import { RowDetailSidebarSlot } from '../components/RowDetailSidebarSlot';
import { CanvasProgressBar } from '../components/Skeleton';
import useDelayedFlag from '../hooks/useDelayedFlag';
import WorkspaceTopBar from '../components/WorkspaceTopBar';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from '../components/page-queries';
import { firstPageInTree } from '../components/pages-tree';
import { COLLECTION_QUERY } from '../collections';
import { withViewTransition } from '../hooks/viewTransition';
import { useRecents } from '../hooks/useRecents';
import { useWorkspaceHome } from '../hooks/useWorkspaceHome';
import useCollectionFields from '../hooks/useCollectionFields';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';
import EmptyState from './EmptyState';
import {
	computeDocumentUri,
	useResolveCollection,
	useResolveDocument,
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

function CollectionView( { collectionId, onReady } ) {
	const [ view, setView ] = useState( DEFAULT_VIEW );

	return (
		<CollectionDataViews
			collectionId={ collectionId }
			view={ view }
			onChangeView={ setView }
			onReady={ onReady }
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

function LoadingPane( { active } ) {
	const showProgress = useDelayedFlag( active );
	return (
		<div className="cortext-canvas__loading cortext-canvas__loading--document">
			{ showProgress ? <CanvasProgressBar /> : null }
		</div>
	);
}

function NotFoundPane( { type } ) {
	const copy =
		type === 'collection'
			? __( "That collection doesn't exist.", 'cortext' )
			: __( "That document doesn't exist.", 'cortext' );
	return (
		<div className="cortext-canvas__empty">
			<p>{ copy }</p>
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

// Default mutation context for documents reached by deep link or direct
// navigation rather than from a live CollectionDataViews mount. Inline
// option edits land in editor state regardless; refreshing the table on
// save isn't possible because no table is mounted, but the data layer
// stays sound.
const ROW_MUTATION_DEFAULT = {
	optionOverrides: {},
	updateFieldOptions: () => {},
	refreshRows: () => {},
};

export default function EntityRoute( { history } ) {
	const params = useParams( { strict: false } );
	const navigate = useNavigate();
	const splat = params._splat ?? '';
	const target = useMemo( () => parseTarget( splat ), [ splat ] );
	const { home, isResolving: isResolvingHome } = useWorkspaceHome();
	const { touchRecent } = useRecents();
	const { records: pages, isResolving: isResolvingPages } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);

	const [ state, rawDispatch ] = useReducer( reducer, target, init );
	const {
		active,
		mountedDocumentId,
		mountedDocumentType,
		displayedDocumentId,
		mountedCollectionIds,
		readyCollectionIds,
	} = state;

	// Document navigations keep the previous pane visible until the next one
	// can paint. Collections can activate before rows are ready, so compare the
	// URL target with the displayed/ready snapshot here.
	const isWorkspaceNavigating =
		( target.kind === 'document' &&
			target.id !== null &&
			target.id !== displayedDocumentId ) ||
		( target.kind === 'collection' &&
			target.id !== null &&
			! readyCollectionIds.has( target.id ) );
	const showWorkspaceProgress = useDelayedFlag( isWorkspaceNavigating );

	// Run the reducer ahead of time so we only wrap the dispatch when
	// `active` actually flips. Otherwise every DOCUMENT_RESOLVED or
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
		const touchesCollection =
			action.target?.kind === 'collection' ||
			before.active.kind === 'collection' ||
			after.active.kind === 'collection' ||
			action.type.startsWith( 'COLLECTION_' );
		if ( touchesCollection ) {
			rawDispatch( action );
			return;
		}
		withViewTransition( () => rawDispatch( action ) );
	}, [] );

	const documentResolution = useResolveDocument(
		target.kind === 'document' ? target.tail : ''
	);
	const collectionResolution = useResolveCollection(
		target.kind === 'collection' ? target.id : null
	);

	// For document targets that turn out to be rows, we still need the
	// row's collection field schema (rendered as the property panel). The
	// resolver hands us the post type; the parent collection comes from
	// matching its `meta.slug` against the post type's `crtxt_<slug>`
	// suffix.
	//
	// Note: the row CPT slug is `meta.slug`, not the collection's
	// `post_name`. They diverge because `meta.slug` is truncated to the
	// CPT-prefix budget (see CollectionEntries::MAX_CPT_LEN). REST's
	// `?slug=` filter is `post_name__in`, which is the wrong field, and
	// the default status filter is `publish` while collections are
	// created `private`. So we reuse the workspace-wide `COLLECTION_QUERY`
	// (already covers draft/private/publish) and match `meta.slug`
	// client-side, which mirrors `CollectionEntries::collection_id_for_entry_post_type`
	// on the PHP side.
	const rowCollectionSlug = useMemo( () => {
		if ( ! mountedDocumentType ) {
			return null;
		}
		if ( mountedDocumentType === POST_TYPE ) {
			return null;
		}
		return mountedDocumentType.startsWith( 'crtxt_' )
			? mountedDocumentType.slice( 'crtxt_'.length )
			: null;
	}, [ mountedDocumentType ] );
	const { records: workspaceCollections } = useEntityRecords(
		'postType',
		'crtxt_collection',
		COLLECTION_QUERY,
		{ enabled: Boolean( rowCollectionSlug ) }
	);
	const rowParentCollectionId = useMemo( () => {
		if ( ! rowCollectionSlug || ! workspaceCollections ) {
			return null;
		}
		const match = workspaceCollections.find(
			( collection ) => collection?.meta?.slug === rowCollectionSlug
		);
		return match?.id ?? null;
	}, [ rowCollectionSlug, workspaceCollections ] );
	const rowFieldsState = useCollectionFields( rowParentCollectionId );
	const rowFields = useMemo( () => {
		if ( ! rowCollectionSlug || ! rowFieldsState?.fields ) {
			return undefined;
		}
		return [
			{
				id: 'title',
				label: __( 'Title', 'cortext' ),
				cortextType: 'title',
				editable: true,
				getValue: ( { item } ) =>
					item?.title?.raw ?? item?.title?.rendered ?? '',
			},
			...rowFieldsState.fields,
		];
	}, [ rowCollectionSlug, rowFieldsState?.fields ] );

	useLayoutEffect( () => {
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
		const path =
			home?.path ?? ( fallback ? computeDocumentUri( fallback ) : null );
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
		if ( target.kind !== 'document' || target.id === null ) {
			return;
		}
		const {
			entity,
			isResolving,
			notFound,
			id: resolvedFor,
		} = documentResolution;
		if ( resolvedFor !== target.id ) {
			return;
		}
		if ( entity?.id === target.id ) {
			dispatch( {
				type: 'DOCUMENT_RESOLVED',
				id: entity.id,
				postType: entity.type,
			} );
			if ( entity.type === POST_TYPE ) {
				touchRecent( { kind: 'page', id: entity.id } );
			}
			return;
		}
		if ( ! isResolving && notFound ) {
			dispatch( { type: 'DOCUMENT_NOT_FOUND' } );
		}
	}, [ target, documentResolution, dispatch, touchRecent ] );

	useEffect( () => {
		if (
			target.kind !== 'document' ||
			target.id === null ||
			mountedDocumentId !== target.id ||
			mountedDocumentType === POST_TYPE ||
			! rowParentCollectionId
		) {
			return;
		}
		touchRecent( {
			kind: 'row',
			id: target.id,
			collectionId: rowParentCollectionId,
		} );
	}, [
		target.kind,
		target.id,
		mountedDocumentId,
		mountedDocumentType,
		rowParentCollectionId,
		touchRecent,
	] );

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
			// Inline collections do not have a workspace route. A pasted stale
			// URL should land on Not Found instead of opening CollectionPane.
			if ( entity?.meta?.workspace_mode === 'inline' ) {
				dispatch( { type: 'COLLECTION_NOT_FOUND' } );
				return;
			}
			dispatch( { type: 'COLLECTION_RESOLVED', id: entity.id } );
			touchRecent( { kind: 'collection', id: entity.id } );
			return;
		}
		if ( ! isResolving && notFound ) {
			dispatch( { type: 'COLLECTION_NOT_FOUND' } );
		}
	}, [ target, collectionResolution, dispatch, touchRecent ] );

	const handleDocumentDisplayed = useCallback(
		( id ) => {
			dispatch( { type: 'DOCUMENT_DISPLAYED', id } );
		},
		[ dispatch ]
	);

	const handleCollectionReady = useCallback(
		( id ) => {
			dispatch( { type: 'COLLECTION_READY', id } );
		},
		[ dispatch ]
	);

	// Drives the breadcrumb from the same paint state the document-actions
	// Fill uses, so both sides of the top bar update together.
	let paintedRoute = { kind: 'unresolved' };
	if ( active.kind === 'document' && displayedDocumentId !== null ) {
		paintedRoute = {
			kind: 'document',
			id: displayedDocumentId,
			postType: mountedDocumentType,
			collectionId: rowParentCollectionId,
		};
	} else if ( active.kind === 'collection' ) {
		paintedRoute = { kind: 'collection', id: active.id };
	} else if (
		active.kind === 'empty' ||
		active.kind === 'document-not-found' ||
		active.kind === 'collection-not-found'
	) {
		paintedRoute = { kind: active.kind };
	}

	const isDocumentActive = active.kind === 'document';
	// Mount Canvas whenever a document is mounted, not only when it's the
	// active pane. The pane visibility is driven by `isDocumentActive` via
	// `WorkspacePane` and the `isActive` prop. Gating the mount on
	// `isDocumentActive` would deadlock the load: Canvas can't fire
	// `DOCUMENT_DISPLAYED` until it renders, and `active` can't flip to
	// `document` until that dispatch arrives.
	const editorPostId = mountedDocumentId;
	const editorPostType = mountedDocumentType;
	const isRow = Boolean( editorPostId ) && Boolean( rowCollectionSlug );

	const { invalidateResolution, receiveEntityRecords } =
		useDispatch( 'core' );

	// Restore still has two cache paths: pages use core-data for the tree, rows
	// use collection-scoped queries. Both refresh the Trash list; rows also
	// notify open collections because relations and rollups can change elsewhere.
	const onRestoreDocument = useCallback(
		( postId, postType, response ) => {
			if ( response?.post && postType ) {
				receiveEntityRecords( 'postType', postType, [ response.post ] );
			}
			if ( postType === POST_TYPE ) {
				invalidateResolution( 'getEntityRecords', [
					'postType',
					POST_TYPE,
					ACTIVE_PAGES_QUERY,
				] );
				invalidateResolution( 'getEntityRecords', [
					'postType',
					POST_TYPE,
					TRASHED_PAGES_QUERY,
				] );
				notifyDocumentTrashChanged();
			} else if ( postType ) {
				invalidateResolution( 'getEntityRecords', [
					'postType',
					postType,
				] );
				notifyDocumentTrashChanged();
				notifyCollectionRowsChanged();
			}
		},
		[ invalidateResolution, receiveEntityRecords ]
	);

	const editorRecentTarget =
		isRow && editorPostId !== null && rowParentCollectionId
			? {
					kind: 'row',
					id: editorPostId,
					collectionId: rowParentCollectionId,
			  }
			: null;
	const editorCanvas =
		editorPostId !== null && editorPostType ? (
			<Canvas
				postId={ editorPostId }
				postType={ editorPostType }
				fields={ isRow ? rowFields : undefined }
				row={
					isRow ? documentResolution.entity ?? undefined : undefined
				}
				onDisplayedPost={ handleDocumentDisplayed }
				isActive={ isDocumentActive }
				onRestored={ onRestoreDocument }
				recentTarget={ editorRecentTarget }
			/>
		) : null;

	return (
		<>
			<WorkspaceTopBar
				history={ history }
				paintedRoute={ paintedRoute }
			/>
			<div className="cortext-workspace" data-target-kind={ target.kind }>
				{ showWorkspaceProgress && (
					<div className="cortext-workspace__progress">
						<CanvasProgressBar />
					</div>
				) }
				{ editorCanvas !== null && (
					<WorkspacePane active={ isDocumentActive } preservePaint>
						{ isRow ? (
							<RowMutationContext.Provider
								value={ ROW_MUTATION_DEFAULT }
							>
								{ editorCanvas }
							</RowMutationContext.Provider>
						) : (
							editorCanvas
						) }
					</WorkspacePane>
				) }

				{ mountedCollectionIds.map( ( id ) => (
					<WorkspacePane
						key={ id }
						active={
							active.kind === 'collection' && active.id === id
						}
					>
						<CollectionPane
							collectionId={ id }
							onReady={ handleCollectionReady }
						/>
					</WorkspacePane>
				) ) }

				<WorkspacePane active={ active.kind === 'empty' }>
					<EmptyState />
				</WorkspacePane>
				<WorkspacePane active={ active.kind === 'document-not-found' }>
					<NotFoundPane type="document" />
				</WorkspacePane>
				<WorkspacePane
					active={ active.kind === 'collection-not-found' }
				>
					<NotFoundPane type="collection" />
				</WorkspacePane>
				<WorkspacePane active={ active.kind === 'loading' }>
					<LoadingPane active={ active.kind === 'loading' } />
				</WorkspacePane>
			</div>
		</>
	);
}
