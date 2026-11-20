import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEntityRecords } from '@wordpress/core-data';
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
import ExperimentsPane from '../components/ExperimentsPane';
import ImportPane from '../components/ImportPane';
import PublishedDocumentsPane from '../components/PublishedDocumentsPane';
import LifecycleView from '../components/lifecycle/LifecycleView';
import { ARCHIVED, TRASH } from '../components/lifecycle/lifecycleStates';
import { CanvasProgressBar } from '../components/Skeleton';
import useDelayedFlag from '../hooks/useDelayedFlag';
import CortextSnackbars from '../components/CortextSnackbars';
import { useSurfaceFocusIntent } from '../components/SurfaceFocusContext';
import { useActiveEditor } from '../components/ActiveEditorContext';
import { isSurfaceFocusOriginCurrent } from '../components/collectionSurfaceFocus';
import WorkspaceTopBar from '../components/WorkspaceTopBar';
import { ACTIVE_PAGES_QUERY, POST_TYPE } from '../components/page-queries';
import { firstDocumentInTree } from '../components/document-tree';
import { isPublicWebAffordancesEnabled } from '../settings';
import afterNextPaint from '../hooks/afterNextPaint';
import {
	whenViewTransitionsSettled,
	withViewTransition,
} from '../hooks/viewTransition';
import { useRecents } from '../hooks/useRecents';
import { useWorkspaceHome } from '../hooks/useWorkspaceHome';
import useCollectionFields from '../hooks/useCollectionFields';
import { notifySidebarTreeChanged } from '../hooks/sidebarTreeInvalidation';
import EmptyState from './EmptyState';
import { computeDocumentUri, useResolveDocument } from './useResolveEntity';
import { init, parseTarget, reducer } from './entityRouteReducer';
import {
	makeRowDocumentContext,
	rememberRowDocumentContext,
	rowDocumentContextForEditorPost,
} from './rowContextCache';
import {
	activeRowSourceCollectionId,
	rowSourceCollectionHint,
} from './rowSourceCollection';

function LoadingPane( { active } ) {
	const showProgress = useDelayedFlag( active );
	return (
		<div className="cortext-canvas__loading cortext-canvas__loading--document">
			{ showProgress ? <CanvasProgressBar /> : null }
			<CanvasSkeleton />
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

function WorkspacePane( {
	active,
	preservePaint = false,
	paneRef = null,
	children,
} ) {
	return (
		<div
			ref={ paneRef }
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

function useTerminalSurfaceFocus( {
	isActive,
	containerRef,
	request,
	documentId = null,
	complete,
} ) {
	const requestRef = useRef( request );
	requestRef.current = request;

	useEffect( () => {
		if (
			! isActive ||
			! request ||
			( documentId !== null &&
				Number( request.documentId ) !== Number( documentId ) )
		) {
			return undefined;
		}

		const token = request.token;
		let cancelled = false;
		async function focusTerminalAction() {
			await whenViewTransitionsSettled( 0 );
			await afterNextPaint(
				containerRef.current?.ownerDocument?.defaultView
			);
			if ( cancelled || requestRef.current?.token !== token ) {
				return;
			}
			if (
				! isSurfaceFocusOriginCurrent(
					requestRef.current?.originElement
				)
			) {
				complete?.( token );
				return;
			}

			const primaryAction = containerRef.current?.querySelector(
				'.components-button.is-primary:not(:disabled):not([aria-disabled="true"]), [data-cortext-primary-action]:not(:disabled):not([aria-disabled="true"])'
			);
			complete?.( token, () => primaryAction?.focus() );
		}
		focusTerminalAction();
		return () => {
			cancelled = true;
		};
	}, [ complete, containerRef, documentId, isActive, request ] );
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
	const search = useSearch( { strict: false } );
	const navigate = useNavigate();
	const splat = params._splat ?? '';
	const publicWebAffordances = isPublicWebAffordancesEnabled();
	const target = useMemo(
		() => parseTarget( splat, { publicWebAffordances } ),
		[ splat, publicWebAffordances ]
	);
	const { home, isResolving: isResolvingHome } = useWorkspaceHome();
	const { touchRecent } = useRecents();
	const { registerActiveEditor } = useActiveEditor();
	const { records: pages, isResolving: isResolvingPages } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);

	// `pages` spans every non-row document (pages and collections), so an empty
	// list once resolved means a fresh install with nothing created yet. That is
	// the only state where the empty pane offers to seed sample content.
	const isWorkspaceEmpty = ! isResolvingPages && ( pages?.length ?? 0 ) === 0;

	const [ state, rawDispatch ] = useReducer( reducer, target, init );
	const { active, mountedDocumentId, displayedDocumentId } = state;
	const { request: surfaceFocusRequest, consume: consumeSurfaceFocus } =
		useSurfaceFocusIntent();
	const completeSurfaceFocus = useCallback(
		( token, onConsume ) => consumeSurfaceFocus?.( token, onConsume ),
		[ consumeSurfaceFocus ]
	);
	const notFoundPaneRef = useRef( null );
	useTerminalSurfaceFocus( {
		isActive: active.kind === 'document-not-found',
		containerRef: notFoundPaneRef,
		request: surfaceFocusRequest,
		documentId: target.kind === 'document' ? target.id : null,
		complete: completeSurfaceFocus,
	} );

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
	// A target change can wait inside a view transition while the URL moves on,
	// for example when Trash opens and then selects its first item. When the
	// held change finally runs it must apply the newest target, or it would
	// overwrite the one dispatched after it.
	const latestTargetRef = useRef( target );
	const dispatch = useCallback( ( action ) => {
		if ( action.type === 'TARGET_CHANGED' ) {
			latestTargetRef.current = action.target;
		}
		const deferredDispatch = () =>
			rawDispatch(
				action.type === 'TARGET_CHANGED'
					? { ...action, target: latestTargetRef.current }
					: action
			);
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
			withViewTransition( deferredDispatch, {
				mode: 'hold-old-canvas',
			} );
			return;
		}
		// Settings, Trash and Archived panes are lightweight. A plain fade keeps
		// Chrome's default blend from washing out the transition to white.
		if (
			after.active.kind === 'experiments' ||
			after.active.kind === 'import' ||
			after.active.kind === 'published' ||
			after.active.kind === 'trash' ||
			after.active.kind === 'archived'
		) {
			withViewTransition( deferredDispatch, {
				mode: 'pane-crossfade',
			} );
			return;
		}
		withViewTransition( deferredDispatch );
	}, [] );

	const documentResolution = useResolveDocument(
		target.kind === 'document' ? target.tail : ''
	);

	// For document targets that turn out to be rows, we still need a collection
	// field schema for the property panel. Prefer the collection the row was
	// opened from. It is persisted in the URL
	// so peek -> full navigation and reloads keep the same field/layout context,
	// but only while the locator still reports it as an active membership.
	const rowParentCollectionId = activeRowSourceCollectionId(
		documentResolution.traitIds,
		rowSourceCollectionHint( search, target.id )
	);
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
	const targetRowContext = useMemo(
		() =>
			makeRowDocumentContext( {
				documentId: documentResolution.entity?.id,
				collectionId: rowParentCollectionId,
				fields: rowFields,
				allFields: rowAllFields,
				detailLayoutEntries: rowFieldsState.detailLayoutEntries,
				row: documentResolution.entity,
				isResolving: rowFieldsState.isResolving,
			} ),
		[
			documentResolution.entity,
			rowFieldsState.isResolving,
			rowAllFields,
			rowFields,
			rowFieldsState.detailLayoutEntries,
			rowParentCollectionId,
		]
	);
	const rowContextCacheRef = useRef( new Map() );

	useEffect( () => {
		rememberRowDocumentContext(
			rowContextCacheRef.current,
			targetRowContext
		);
	}, [ targetRowContext ] );

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
		if ( target.kind !== 'redirect' ) {
			return;
		}

		navigate( {
			to: '/$',
			params: { _splat: target.to },
			replace: true,
		} );
	}, [ target, navigate ] );

	// The reducer drops a resolution for a document it isn't targeting yet. That
	// happens when TARGET_CHANGED waits inside a view transition while the fetch
	// finishes first, so hold off until the reducer has the same target.
	const committedDocumentId =
		state.target.kind === 'document' ? state.target.id : null;

	useEffect( () => {
		if (
			target.kind !== 'document' ||
			target.id === null ||
			committedDocumentId !== target.id
		) {
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
			// Browsing Trash or Archived opens documents that don't belong in
			// Recents.
			if (
				! target.fromLifecycle &&
				( documentResolution.traitIds?.length ?? 0 ) === 0
			) {
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
	}, [
		target,
		committedDocumentId,
		documentResolution,
		dispatch,
		touchRecent,
	] );

	useEffect( () => {
		if (
			target.kind !== 'document' ||
			target.id === null ||
			target.fromLifecycle ||
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
		target.fromLifecycle,
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
	const isEditorSurfaceDisplayed = Boolean(
		isDocumentActive &&
			editorPostId !== null &&
			displayedDocumentId === editorPostId &&
			active.id === editorPostId
	);
	const editorSurfaceFocusRequest =
		isEditorSurfaceDisplayed &&
		surfaceFocusRequest &&
		Number( surfaceFocusRequest.documentId ) === Number( editorPostId )
			? surfaceFocusRequest
			: null;
	const editorRowContext = rowDocumentContextForEditorPost(
		rowContextCacheRef.current,
		editorPostId,
		targetRowContext
	);
	const isRow = Boolean( editorRowContext );

	// The lifecycle actions synchronize entity records and invalidate every
	// affected list. The route adds reveal context for the restored document.
	const onRestoreDocument = useCallback( ( postId, _postType, response ) => {
		notifySidebarTreeChanged( {
			parentId: Number( response?.post?.parent ?? 0 ),
			revealId: Number( postId ),
		} );
	}, [] );

	const editorRecentTarget =
		isRow && editorPostId !== null && editorRowContext?.collectionId
			? {
					id: editorPostId,
					collectionId: editorRowContext.collectionId,
			  }
			: null;
	const editorCanvas =
		editorPostId !== null ? (
			<Suspense fallback={ <CanvasSkeleton /> }>
				<Canvas
					postId={ editorPostId }
					postType={ POST_TYPE }
					collectionId={ editorRowContext?.collectionId }
					fields={ editorRowContext?.fields }
					allFields={ editorRowContext?.allFields }
					detailLayoutEntries={
						editorRowContext?.detailLayoutEntries
					}
					row={ editorRowContext?.row }
					propertiesResolving={
						editorRowContext?.isResolving ?? false
					}
					onDisplayedPost={ handleDocumentDisplayed }
					isActive={ isDocumentActive }
					isEditorSurfaceDisplayed={ isEditorSurfaceDisplayed }
					surfaceFocusRequest={ editorSurfaceFocusRequest }
					completeSurfaceFocus={ completeSurfaceFocus }
					onApi={ registerActiveEditor }
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
						<RowMutationContext.Provider
							value={ ROW_MUTATION_DEFAULT }
						>
							{ editorCanvas }
						</RowMutationContext.Provider>
					</WorkspacePane>
				) }
				{ publicWebAffordances ? (
					<WorkspacePane active={ active.kind === 'published' }>
						<PublishedDocumentsPane
							isActive={ active.kind === 'published' }
						/>
					</WorkspacePane>
				) : null }
				<WorkspacePane active={ active.kind === 'experiments' }>
					<ExperimentsPane />
				</WorkspacePane>
				<WorkspacePane active={ active.kind === 'import' }>
					<ImportPane />
				</WorkspacePane>
				{ [ TRASH, ARCHIVED ].map( ( lifecycle ) => (
					<WorkspacePane
						key={ lifecycle.name }
						active={ active.kind === lifecycle.name }
					>
						<LifecycleView
							state={ lifecycle }
							isActive={
								active.kind === lifecycle.name &&
								target.kind === lifecycle.name
							}
						/>
					</WorkspacePane>
				) ) }
				<WorkspacePane active={ active.kind === 'empty' }>
					<EmptyState isWorkspaceEmpty={ isWorkspaceEmpty } />
				</WorkspacePane>
				<WorkspacePane
					active={ active.kind === 'document-not-found' }
					paneRef={ notFoundPaneRef }
				>
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
