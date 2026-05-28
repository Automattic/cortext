import { PUBLISHED_DOCUMENTS_URI, parseIdFromUri } from './useResolveEntity';

// Possible targets:
//   - `published`: singleton splat for the Published documents screen.
//   - `empty`:     no splat (workspace home).
//   - `document`:  anything else with an id. Collections, pages, and rows all
//                  fall here; the resolver discovers each document's
//                  capabilities via the locator endpoint.
export function parseTarget( splat ) {
	if ( splat === PUBLISHED_DOCUMENTS_URI ) {
		return { kind: 'published', tail: '' };
	}
	if ( ! splat ) {
		return { kind: 'empty', tail: '' };
	}
	return { kind: 'document', id: parseIdFromUri( splat ), tail: splat };
}

function isContentPane( active ) {
	return active.kind === 'document';
}

// `target` follows the URL; `active` is what we're painting. They diverge
// during transitions: the old pane keeps painting until the new one is ready,
// then `active` flips.
export function reducer( state, action ) {
	switch ( action.type ) {
		case 'TARGET_CHANGED': {
			const { target } = action;
			let active = state.active;

			if ( target.kind === 'empty' ) {
				active = { kind: 'empty' };
			} else if ( target.kind === 'published' ) {
				active = { kind: 'published' };
			} else if ( target.kind === 'document' ) {
				if ( target.id === null ) {
					active = { kind: 'document-not-found' };
				} else if (
					state.mountedDocumentId === target.id &&
					state.displayedDocumentId === target.id
				) {
					active = { kind: 'document', id: target.id };
				} else if ( ! isContentPane( state.active ) ) {
					active = { kind: 'loading' };
				}
			}

			return { ...state, target, active };
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
			};
			if ( state.displayedDocumentId === action.id ) {
				next.active = { kind: 'document', id: action.id };
			}
			return next;
		}

		case 'DOCUMENT_NOT_FOUND': {
			if (
				state.target.kind !== 'document' ||
				state.target.id !== action.id
			) {
				return state;
			}
			return {
				...state,
				active: { kind: 'document-not-found' },
			};
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
			return next;
		}

		default:
			return state;
	}
}

export function init( target ) {
	let active;
	if ( target.kind === 'empty' ) {
		active = { kind: 'empty' };
	} else if ( target.kind === 'published' ) {
		active = { kind: 'published' };
	} else if ( target.kind === 'document' && target.id === null ) {
		active = { kind: 'document-not-found' };
	} else {
		active = { kind: 'loading' };
	}
	return {
		target,
		active,
		mountedDocumentId: null,
		displayedDocumentId: null,
	};
}
