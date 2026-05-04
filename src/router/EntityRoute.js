import { useParams } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from '@wordpress/element';

import Canvas from '../components/Canvas';
import CollectionDataViews from '../components/CollectionDataViews';
import EmptyState from './EmptyState';
import {
	parseIdFromUri,
	parseSplatUri,
	useResolveEntity,
	useResolveCollection,
} from './useResolveEntity';

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

function getActiveCollectionId( activePane ) {
	const match =
		typeof activePane === 'string'
			? activePane.match( /^collection:(\d+)$/ )
			: null;
	return match ? Number( match[ 1 ] ) : null;
}

export default function EntityRoute() {
	const params = useParams( { strict: false } );
	const { prefix, tail } = parseSplatUri( params._splat ?? '' );
	const isCollectionRoute = prefix === 'collection';
	const isEmptyRoute = ! isCollectionRoute && ! tail;
	const pageId = isCollectionRoute ? null : parseIdFromUri( tail );
	const collectionId = isCollectionRoute ? parseIdFromUri( tail ) : null;
	let routeKey = 'empty';
	if ( isCollectionRoute ) {
		routeKey = `collection:${ collectionId ?? 'invalid' }`;
	} else if ( ! isEmptyRoute ) {
		routeKey = `page:${ pageId ?? 'invalid' }`;
	}
	const [ committedRouteKey, setCommittedRouteKey ] = useState( routeKey );
	const hasCurrentRouteRendered = committedRouteKey === routeKey;

	const pageResolution = useResolveEntity( isCollectionRoute ? '' : tail );
	const collectionResolution = useResolveCollection( collectionId );

	const [ requestedPageId, setRequestedPageId ] = useState( null );
	const [ displayedPageId, setDisplayedPageId ] = useState( null );
	const [ collectionIds, setCollectionIds ] = useState( [] );
	const [ readyCollectionIds, setReadyCollectionIds ] = useState(
		() => new Set()
	);
	const [ activePane, setActivePane ] = useState( null );

	useEffect( () => {
		setCommittedRouteKey( routeKey );
	}, [ routeKey ] );

	useEffect( () => {
		if ( isEmptyRoute && hasCurrentRouteRendered ) {
			setActivePane( 'empty' );
		}
	}, [ isEmptyRoute, hasCurrentRouteRendered ] );

	useEffect( () => {
		if ( isEmptyRoute || isCollectionRoute || ! hasCurrentRouteRendered ) {
			return;
		}
		const { entity, isResolving, notFound } = pageResolution;
		if ( entity?.id === pageId ) {
			setRequestedPageId( entity.id );
			return;
		}
		if ( ! isResolving && notFound ) {
			setActivePane( 'page:not-found' );
		}
	}, [
		isEmptyRoute,
		isCollectionRoute,
		hasCurrentRouteRendered,
		pageId,
		pageResolution,
	] );

	useEffect( () => {
		if (
			! isCollectionRoute &&
			hasCurrentRouteRendered &&
			requestedPageId === pageId &&
			requestedPageId &&
			displayedPageId === requestedPageId
		) {
			setActivePane( 'page' );
		}
	}, [
		isCollectionRoute,
		hasCurrentRouteRendered,
		pageId,
		requestedPageId,
		displayedPageId,
	] );

	useEffect( () => {
		if ( ! isCollectionRoute || ! hasCurrentRouteRendered ) {
			return;
		}
		const { entity, isResolving, notFound } = collectionResolution;
		if ( entity?.id === collectionId ) {
			setCollectionIds( ( current ) =>
				current.includes( entity.id )
					? current
					: [ ...current, entity.id ]
			);
			if ( readyCollectionIds.has( entity.id ) ) {
				setActivePane( `collection:${ entity.id }` );
			}
			return;
		}
		if ( ! isResolving && notFound ) {
			setActivePane( 'collection:not-found' );
		}
	}, [
		isCollectionRoute,
		hasCurrentRouteRendered,
		collectionId,
		collectionResolution,
		readyCollectionIds,
	] );

	const handleDisplayedPost = useCallback( ( postId ) => {
		setDisplayedPageId( postId );
	}, [] );

	const handleCollectionReady = useCallback(
		( id ) => {
			setReadyCollectionIds( ( current ) => {
				if ( current.has( id ) ) {
					return current;
				}
				const next = new Set( current );
				next.add( id );
				return next;
			} );

			if ( isCollectionRoute && collectionId === id ) {
				setActivePane( `collection:${ id }` );
			}
		},
		[ isCollectionRoute, collectionId ]
	);

	useEffect( () => {
		const keepIds = new Set();
		const activeCollectionId = getActiveCollectionId( activePane );
		if ( activeCollectionId ) {
			keepIds.add( activeCollectionId );
		}
		if ( isCollectionRoute && collectionId ) {
			keepIds.add( collectionId );
		}

		setCollectionIds( ( current ) => {
			const next = current.filter( ( id ) => keepIds.has( id ) );
			return next.length === current.length ? current : next;
		} );
		setReadyCollectionIds( ( current ) => {
			let changed = false;
			const next = new Set();
			current.forEach( ( id ) => {
				if ( keepIds.has( id ) ) {
					next.add( id );
				} else {
					changed = true;
				}
			} );
			return changed ? next : current;
		} );
	}, [ activePane, isCollectionRoute, collectionId ] );

	const isInitialPageLoad =
		! activePane &&
		! isCollectionRoute &&
		! pageResolution.notFound &&
		( pageResolution.isResolving ||
			Boolean( pageId ) ||
			( requestedPageId && displayedPageId !== requestedPageId ) );
	const isInitialCollectionLoad =
		! activePane &&
		isCollectionRoute &&
		! collectionResolution.notFound &&
		( collectionResolution.isResolving ||
			( collectionId && ! readyCollectionIds.has( collectionId ) ) );
	const showLoading = Boolean( isInitialPageLoad || isInitialCollectionLoad );
	const showEmpty =
		activePane === 'empty' || ( ! activePane && ! showLoading );

	return (
		<div className="cortext-workspace">
			{ requestedPageId && (
				<WorkspacePane active={ activePane === 'page' } preservePaint>
					<Canvas
						postId={ requestedPageId }
						onDisplayedPost={ handleDisplayedPost }
					/>
				</WorkspacePane>
			) }

			{ collectionIds.map( ( id ) => (
				<WorkspacePane
					key={ id }
					active={ activePane === `collection:${ id }` }
				>
					<CollectionPane
						collectionId={ id }
						onReady={ () => handleCollectionReady( id ) }
					/>
				</WorkspacePane>
			) ) }

			<WorkspacePane active={ showEmpty }>
				<EmptyState />
			</WorkspacePane>
			<WorkspacePane active={ activePane === 'page:not-found' }>
				<NotFoundPane type="page" />
			</WorkspacePane>
			<WorkspacePane active={ activePane === 'collection:not-found' }>
				<NotFoundPane type="collection" />
			</WorkspacePane>
			<WorkspacePane active={ showLoading }>
				<LoadingPane />
			</WorkspacePane>
		</div>
	);
}
