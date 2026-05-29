import { useNavigate, useParams } from '@tanstack/react-router';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
} from '@wordpress/element';

// Lazy-loading Canvas keeps its Cortext subtree (publish toggle, page
// inspector, autosave hook, snackbars, etc.) and the editor + interface
// stylesheets off the initial JS/CSS bundles. The parallel split in
// RowDetailView does the same for the row peek surface.
//
// This split does not change which WP core editor handles WP enqueues:
// wp-editor, wp-block-editor, wp-block-library, and wp-blocks still ship
// on every admin route because @wordpress/dependency-extraction-webpack-plugin
// only emits one asset manifest per entry and folds in externals reached
// through lazy chunks too. Those scripts are cached by WP and most sessions
// open an editor at some point, so we accept the cost.
const Canvas = lazy( () =>
	import( /* webpackChunkName: "editor" */ '../components/Canvas' )
);
import CanvasSkeleton from '../components/CanvasSkeleton';
import { RowMutationContext } from '../components/EditableCell';
import ImportPane from '../components/ImportPane';
import PublishedDocumentsPane from '../components/PublishedDocumentsPane';
import { CanvasProgressBar } from '../components/Skeleton';
import useDelayedFlag from '../hooks/useDelayedFlag';
import CortextSnackbars from '../components/CortextSnackbars';
import WorkspaceTopBar from '../components/WorkspaceTopBar';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from '../components/page-queries';
import { firstDocumentInTree } from '../components/document-tree';
import { withViewTransition } from '../hooks/viewTransition';
import { useRecents } from '../hooks/useRecents';
import { useWorkspaceHome } from '../hooks/useWorkspaceHome';
import useCollectionFields from '../hooks/useCollectionFields';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';
import EmptyState from './EmptyState';
import { computeDocumentUri, useResolveDocument } from './useResolveEntity';
import { init, parseTarget, reducer } from './entityRouteReducer';

function LoadingPane( { active } ) {
	const showProgress = useDelayedFlag( active );
	return (
		<div className="cortext-canvas__loading cortext-canvas__loading--document">
			{ showProgress ? <CanvasProgressBar /> : null }
		</div>
	);
}

function NotFoundPane() {
	return (
		<div className="cortext-canvas__empty">
			<p>{ __( "That document doesn't exist.", 'cortext' ) }</p>
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
	formatOverrides: {},
	updateFieldFormat: () => {},
	refreshRows: () => {},
};

function isContentPane( active ) {
	return active.kind === 'document';
}

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
	const { active, mountedDocumentId, displayedDocumentId } = state;

	// Keep the old pane up until the next Canvas has painted.
	const isWorkspaceNavigating =
		target.kind === 'document' &&
		target.id !== null &&
		target.id !== displayedDocumentId;
	const showWorkspaceProgress = useDelayedFlag( isWorkspaceNavigating );

	// Peek at the reducer result before dispatching. We only need a transition
	// when `active` changes; wrapping every resolve action would pin the canvas
	// even when the visible pane stayed put.
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
		// Canvas owns document-to-document swaps because it can hold the old
		// editor snapshot until the new EditorProvider is ready. Letting
		// EntityRoute start another transition on DOCUMENT_DISPLAYED makes
		// Chrome skip one and exposes the canvas frame near the end of the
		// loader.
		if (
			action.type === 'DOCUMENT_DISPLAYED' &&
			before.active.kind === 'document' &&
			after.active.kind === 'document'
		) {
			rawDispatch( action );
			return;
		}
		if ( isContentPane( before.active ) && isContentPane( after.active ) ) {
			withViewTransition( () => rawDispatch( action ), {
				mode: 'hold-old-canvas',
			} );
			return;
		}
		withViewTransition( () => rawDispatch( action ) );
	}, [] );

	const documentResolution = useResolveDocument(
		target.kind === 'document' ? target.tail : ''
	);

	// For document targets that turn out to be rows, we still need the
	// row's collection field schema (rendered as the property panel). The
	// resolver hands us the trait ids the document belongs to. Today only
	// the first trait drives the row peek's parent collection; multi-trait
	// UX can use the rest later.
	const rowParentCollectionId = documentResolution.traitIds?.[ 0 ] ?? null;
	const rowFieldsState = useCollectionFields( rowParentCollectionId );
	const rowFields = useMemo( () => {
		if ( ! rowParentCollectionId || ! rowFieldsState?.detailFields ) {
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
			...rowFieldsState.detailFields,
		];
	}, [ rowParentCollectionId, rowFieldsState?.detailFields ] );
	const rowAllFields = useMemo( () => {
		if ( ! rowParentCollectionId || ! rowFieldsState?.allDetailFields ) {
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
			...rowFieldsState.allDetailFields,
		];
	}, [ rowParentCollectionId, rowFieldsState?.allDetailFields ] );

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

		const fallback = firstDocumentInTree( pages ?? [] );
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
			} );
			// Rows touch recents in the row-specific effect below, which has
			// the parent collection id ready as breadcrumb context. Everything
			// else (pages, collections) just records the open document by id.
			if ( ( documentResolution.traitIds?.length ?? 0 ) === 0 ) {
				touchRecent( { id: entity.id } );
			}
			return;
		}
		if ( ! isResolving && notFound ) {
			dispatch( {
				type: 'DOCUMENT_NOT_FOUND',
				id: target.id,
			} );
		}
	}, [ target, documentResolution, dispatch, touchRecent ] );

	useEffect( () => {
		if (
			target.kind !== 'document' ||
			target.id === null ||
			mountedDocumentId !== target.id ||
			! rowParentCollectionId
		) {
			return;
		}
		touchRecent( {
			id: target.id,
			collectionId: rowParentCollectionId,
		} );
	}, [
		target.kind,
		target.id,
		mountedDocumentId,
		rowParentCollectionId,
		touchRecent,
	] );

	const handleDocumentDisplayed = useCallback(
		( id ) => {
			dispatch( { type: 'DOCUMENT_DISPLAYED', id } );
		},
		[ dispatch ]
	);

	// Fill uses, so both sides of the top bar update together. Null when no
	// document is mounted (loading, empty, not found, published).
	const paintedDocumentId =
		active.kind === 'document' && displayedDocumentId !== null
			? displayedDocumentId
			: null;

	const isDocumentActive = active.kind === 'document';
	// Mount Canvas whenever a document is mounted, not only when it's the
	// active pane. The pane visibility is driven by `isDocumentActive` via
	// `WorkspacePane` and the `isActive` prop. Gating the mount on
	// `isDocumentActive` would deadlock the load: Canvas can't fire
	// `DOCUMENT_DISPLAYED` until it renders, and `active` can't flip to
	// `document` until that dispatch arrives.
	const editorPostId = mountedDocumentId;
	const isRow = Boolean( editorPostId ) && Boolean( rowParentCollectionId );

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
			// Every document shares one post type, so a restore always re-enters
			// the workspace tree and leaves the Trash list.
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
			// A restored row lives inside a collection's data view rather than
			// the tree, and can change rollups and relations elsewhere, so
			// refresh any open collection views too.
			if ( isRow ) {
				notifyCollectionRowsChanged();
			}
		},
		[ invalidateResolution, receiveEntityRecords, isRow ]
	);

	const editorRecentTarget =
		isRow && editorPostId !== null && rowParentCollectionId
			? {
					id: editorPostId,
					collectionId: rowParentCollectionId,
			  }
			: null;
	const editorCanvas =
		editorPostId !== null ? (
			<Suspense fallback={ <CanvasSkeleton /> }>
				<Canvas
					postId={ editorPostId }
					postType={ POST_TYPE }
					collectionId={ isRow ? rowParentCollectionId : undefined }
					fields={ isRow ? rowFields : undefined }
					allFields={ isRow ? rowAllFields : undefined }
					detailLayoutEntries={
						isRow ? rowFieldsState.detailLayoutEntries : undefined
					}
					row={ isRow ? documentResolution.entity : undefined }
					onDisplayedPost={ handleDocumentDisplayed }
					isActive={ isDocumentActive }
					onRestored={ onRestoreDocument }
					recentTarget={ editorRecentTarget }
				/>
			</Suspense>
		) : null;

	return (
		<>
			<WorkspaceTopBar
				history={ history }
				paintedDocumentId={ paintedDocumentId }
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
				<WorkspacePane active={ active.kind === 'published' }>
					<PublishedDocumentsPane />
				</WorkspacePane>
				<WorkspacePane active={ active.kind === 'import' }>
					<ImportPane />
				</WorkspacePane>
				<WorkspacePane active={ active.kind === 'empty' }>
					<EmptyState />
				</WorkspacePane>
				<WorkspacePane active={ active.kind === 'document-not-found' }>
					<NotFoundPane />
				</WorkspacePane>
				<WorkspacePane active={ active.kind === 'loading' }>
					<LoadingPane active={ active.kind === 'loading' } />
				</WorkspacePane>
			</div>
			<CortextSnackbars />
		</>
	);
}
