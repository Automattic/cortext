import { useParams } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	useCallback,
	useEffect,
	useReducer,
	useState,
} from '@wordpress/element';

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

// A null id means the URL was malformed (e.g. /collection/foo).
function parseTarget( splat ) {
	const { prefix, tail } = parseSplatUri( splat );
	if ( prefix === 'collection' ) {
		return { kind: 'collection', id: parseIdFromUri( tail ), tail };
	}
	if ( ! tail ) {
		return { kind: 'empty', tail: '' };
	}
	return { kind: 'page', id: parseIdFromUri( tail ), tail };
}

// Keep what the URL points at and what's currently visible (so paint survives
// the swap); drop the rest. Runs inline after each transition.
function pruneCollections( state ) {
	const keep = new Set();
	if ( state.target.kind === 'collection' && state.target.id !== null ) {
		keep.add( state.target.id );
	}
	if ( state.active.kind === 'collection' ) {
		keep.add( state.active.id );
	}

	const mountedCollectionIds = state.mountedCollectionIds.filter( ( id ) =>
		keep.has( id )
	);
	let readyCollectionIds = state.readyCollectionIds;
	if ( state.readyCollectionIds.size > 0 ) {
		const next = new Set();
		state.readyCollectionIds.forEach( ( id ) => {
			if ( keep.has( id ) ) {
				next.add( id );
			}
		} );
		if ( next.size !== state.readyCollectionIds.size ) {
			readyCollectionIds = next;
		}
	}

	if (
		mountedCollectionIds.length === state.mountedCollectionIds.length &&
		readyCollectionIds === state.readyCollectionIds
	) {
		return state;
	}
	return { ...state, mountedCollectionIds, readyCollectionIds };
}

// `target` follows the URL; `active` is what we're painting. They diverge
// during transitions: the old pane keeps painting until the new one is ready,
// then `active` flips.
//
// Mount state is separate so a page Canvas can sit in the DOM behind an
// active collection and reactivate without remounting the iframe.
function reducer( state, action ) {
	switch ( action.type ) {
		case 'TARGET_CHANGED': {
			const { target } = action;
			let active = state.active;

			if ( target.kind === 'empty' ) {
				active = { kind: 'empty' };
			} else if ( target.kind === 'page' ) {
				if ( target.id === null ) {
					active = { kind: 'page-not-found' };
				} else if (
					state.mountedPageId === target.id &&
					state.displayedPageId === target.id
				) {
					active = { kind: 'page' };
				}
			} else if ( target.kind === 'collection' ) {
				if ( target.id === null ) {
					active = { kind: 'collection-not-found' };
				} else if (
					state.mountedCollectionIds.includes( target.id ) &&
					state.readyCollectionIds.has( target.id )
				) {
					active = { kind: 'collection', id: target.id };
				}
			}

			return pruneCollections( { ...state, target, active } );
		}

		case 'PAGE_RESOLVED': {
			if (
				state.target.kind !== 'page' ||
				state.target.id !== action.id
			) {
				return state;
			}
			const next = { ...state, mountedPageId: action.id };
			if ( state.displayedPageId === action.id ) {
				next.active = { kind: 'page' };
			}
			return pruneCollections( next );
		}

		case 'PAGE_NOT_FOUND': {
			if ( state.target.kind !== 'page' ) {
				return state;
			}
			return pruneCollections( {
				...state,
				active: { kind: 'page-not-found' },
			} );
		}

		case 'PAGE_DISPLAYED': {
			const next = { ...state, displayedPageId: action.id };
			if (
				state.target.kind === 'page' &&
				state.target.id === action.id &&
				state.mountedPageId === action.id
			) {
				next.active = { kind: 'page' };
			}
			return pruneCollections( next );
		}

		case 'COLLECTION_RESOLVED': {
			if (
				state.target.kind !== 'collection' ||
				state.target.id !== action.id
			) {
				return state;
			}
			const mountedCollectionIds = state.mountedCollectionIds.includes(
				action.id
			)
				? state.mountedCollectionIds
				: [ ...state.mountedCollectionIds, action.id ];
			const next = { ...state, mountedCollectionIds };
			if ( state.readyCollectionIds.has( action.id ) ) {
				next.active = { kind: 'collection', id: action.id };
			}
			return pruneCollections( next );
		}

		case 'COLLECTION_NOT_FOUND': {
			if ( state.target.kind !== 'collection' ) {
				return state;
			}
			return pruneCollections( {
				...state,
				active: { kind: 'collection-not-found' },
			} );
		}

		case 'COLLECTION_READY': {
			const readyCollectionIds = new Set( state.readyCollectionIds );
			readyCollectionIds.add( action.id );
			const next = { ...state, readyCollectionIds };
			if (
				state.target.kind === 'collection' &&
				state.target.id === action.id &&
				state.mountedCollectionIds.includes( action.id )
			) {
				next.active = { kind: 'collection', id: action.id };
			}
			return pruneCollections( next );
		}

		default:
			return state;
	}
}

function init( target ) {
	let active;
	if ( target.kind === 'empty' ) {
		active = { kind: 'empty' };
	} else if ( target.kind === 'page' && target.id === null ) {
		active = { kind: 'page-not-found' };
	} else if ( target.kind === 'collection' && target.id === null ) {
		active = { kind: 'collection-not-found' };
	} else {
		active = { kind: 'loading' };
	}
	return {
		target,
		active,
		mountedPageId: null,
		displayedPageId: null,
		mountedCollectionIds: [],
		readyCollectionIds: new Set(),
	};
}

export default function EntityRoute() {
	const params = useParams( { strict: false } );
	const target = parseTarget( params._splat ?? '' );

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
		// `target` is a fresh object each render; its fields are the identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ target.kind, target.id, target.tail ] );

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
	}, [ target.kind, target.id, pageResolution ] );

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
	}, [ target.kind, target.id, collectionResolution ] );

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
						onReady={ () => handleCollectionReady( id ) }
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
