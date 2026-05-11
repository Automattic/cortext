import { parseIdFromUri, parseSplatUri } from './useResolveEntity';

// A null id means the URL was malformed (e.g. /collection/foo).
//
// Two kinds in the splat:
//   - `collection`: explicit `collection/<slug>-<id>` prefix. Collections
//     are schema containers, not documents.
//   - `document`: anything else with an id. Pages and rows both fall here;
//     the resolver discovers the actual post type via the document
//     locator endpoint.
export function parseTarget( splat ) {
	const { prefix, tail } = parseSplatUri( splat );
	if ( prefix === 'collection' ) {
		return { kind: 'collection', id: parseIdFromUri( tail ), tail };
	}
	if ( ! splat ) {
		return { kind: 'empty', tail: '' };
	}
	// No prefix or any other prefix: treat the whole splat as a document
	// uri. parseIdFromUri reads the trailing digits regardless of slug.
	return { kind: 'document', id: parseIdFromUri( splat ), tail: splat };
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
// Mount state is separate so a document Canvas can sit in the DOM behind an
// active collection and reactivate without remounting the iframe.
export function reducer( state, action ) {
	switch ( action.type ) {
		case 'TARGET_CHANGED': {
			const { target } = action;
			let active = state.active;

			if ( target.kind === 'empty' ) {
				active = { kind: 'empty' };
			} else if ( target.kind === 'document' ) {
				if ( target.id === null ) {
					active = { kind: 'document-not-found' };
				} else if (
					state.mountedDocumentId === target.id &&
					state.displayedDocumentId === target.id
				) {
					active = { kind: 'document', id: target.id };
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

		case 'DOCUMENT_RESOLVED': {
			if (
				state.target.kind !== 'document' ||
				state.target.id !== action.id
			) {
				return state;
			}
			const next = {
				...state,
				mountedDocumentId: action.id,
				mountedDocumentType: action.postType,
			};
			if ( state.displayedDocumentId === action.id ) {
				next.active = { kind: 'document', id: action.id };
			}
			return pruneCollections( next );
		}

		case 'DOCUMENT_NOT_FOUND': {
			if ( state.target.kind !== 'document' ) {
				return state;
			}
			return pruneCollections( {
				...state,
				active: { kind: 'document-not-found' },
			} );
		}

		case 'DOCUMENT_DISPLAYED': {
			const next = { ...state, displayedDocumentId: action.id };
			if (
				state.target.kind === 'document' &&
				state.target.id === action.id &&
				state.mountedDocumentId === action.id
			) {
				next.active = { kind: 'document', id: action.id };
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

export function init( target ) {
	let active;
	if ( target.kind === 'empty' ) {
		active = { kind: 'empty' };
	} else if ( target.kind === 'document' && target.id === null ) {
		active = { kind: 'document-not-found' };
	} else if ( target.kind === 'collection' && target.id === null ) {
		active = { kind: 'collection-not-found' };
	} else {
		active = { kind: 'loading' };
	}
	return {
		target,
		active,
		mountedDocumentId: null,
		mountedDocumentType: null,
		displayedDocumentId: null,
		mountedCollectionIds: [],
		readyCollectionIds: new Set(),
	};
}
