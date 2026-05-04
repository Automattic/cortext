import { useParams } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useState,
} from '@wordpress/element';

import Canvas from '../components/Canvas';
import CollectionDataViews from '../components/CollectionDataViews';
import EmptyState from './EmptyState';
import { useResolveEntity, useResolveCollection } from './useResolveEntity';
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

export default function EntityRoute() {
	const params = useParams( { strict: false } );
	const splat = params._splat ?? '';
	const target = useMemo( () => parseTarget( splat ), [ splat ] );

	const [ state, dispatch ] = useReducer( reducer, target, init );
	const { active, mountedPageId, mountedCollectionIds } = state;

	const pageResolution = useResolveEntity(
		target.kind === 'page' ? target.tail : ''
	);
	const collectionResolution = useResolveCollection(
		target.kind === 'collection' ? target.id : null
	);

	useEffect( () => {
		dispatch( { type: 'TARGET_CHANGED', target } );
	}, [ target ] );

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
	}, [ target, pageResolution ] );

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
	}, [ target, collectionResolution ] );

	const handlePageDisplayed = useCallback( ( id ) => {
		dispatch( { type: 'PAGE_DISPLAYED', id } );
	}, [] );

	const handleCollectionReady = useCallback( ( id ) => {
		dispatch( { type: 'COLLECTION_READY', id } );
	}, [] );

	return (
		<div className="cortext-workspace">
			{ mountedPageId !== null && (
				<WorkspacePane active={ active.kind === 'page' } preservePaint>
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
					active={ active.kind === 'collection' && active.id === id }
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
			<WorkspacePane active={ active.kind === 'collection-not-found' }>
				<NotFoundPane type="collection" />
			</WorkspacePane>
			<WorkspacePane active={ active.kind === 'loading' }>
				<LoadingPane />
			</WorkspacePane>
		</div>
	);
}
