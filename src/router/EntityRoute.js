import { useNavigate, useParams } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { useEntityRecords } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
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
	perPage: 25,
	page: 1,
	search: '',
	layout: {},
};

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
		<div className="cortext-collection-pane">
			<div className="cortext-canvas__table">
				<CollectionView
					collectionId={ collectionId }
					onReady={ onReady }
				/>
			</div>
		</div>
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

export default function EntityRoute( { history } ) {
	const params = useParams( { strict: false } );
	const navigate = useNavigate();
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

	// Drives the breadcrumb from the same paint state the document-actions
	// Fill uses, so both sides of the top bar update together. Use
	// `displayedPageId` rather than `mountedPageId` for the page case: when
	// navigating page A → B, mountedPageId flips to B as soon as B resolves,
	// but Canvas keeps painting A until autosave flushes and `setDisplayedPost`
	// catches up. Reading the mounted id would let the breadcrumb jump to B
	// while A is still on screen.
	let paintedRoute = { kind: 'unresolved' };
	if ( active.kind === 'page' && displayedPageId !== null ) {
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

	return (
		<>
			<WorkspaceTopBar
				history={ history }
				paintedRoute={ paintedRoute }
			/>
			<div className="cortext-workspace">
				{ mountedPageId !== null && (
					<WorkspacePane
						active={ active.kind === 'page' }
						preservePaint
					>
						<Canvas
							postId={ mountedPageId }
							onDisplayedPost={ handlePageDisplayed }
							isActive={ active.kind === 'page' }
						/>
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
				<WorkspacePane active={ active.kind === 'page-not-found' }>
					<NotFoundPane type="page" />
				</WorkspacePane>
				<WorkspacePane
					active={ active.kind === 'collection-not-found' }
				>
					<NotFoundPane type="collection" />
				</WorkspacePane>
				<WorkspacePane active={ active.kind === 'loading' }>
					<LoadingPane />
				</WorkspacePane>
			</div>
		</>
	);
}
