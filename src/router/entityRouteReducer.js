import {
	IMPORT_URI,
	PUBLISHED_DOCUMENTS_URI,
	SETTINGS_EXPERIMENTS_URI,
	SETTINGS_IMPORT_URI,
	SETTINGS_PUBLISHED_URI,
	SETTINGS_URI,
	isArchivedUri,
	isTrashUri,
	parseIdFromUri,
	parseSplatUri,
} from './useResolveEntity';

export function parseTarget( splat, options = {} ) {
	const { publicWebAffordances = true } = options;
	if ( splat === PUBLISHED_DOCUMENTS_URI ) {
		return { kind: 'redirect', to: SETTINGS_PUBLISHED_URI, tail: '' };
	}
	if ( splat === IMPORT_URI ) {
		return { kind: 'redirect', to: SETTINGS_IMPORT_URI, tail: '' };
	}
	if ( splat === SETTINGS_URI ) {
		return { kind: 'redirect', to: SETTINGS_IMPORT_URI, tail: '' };
	}
	if ( splat === SETTINGS_IMPORT_URI ) {
		return { kind: 'import', tail: '' };
	}
	if ( splat === SETTINGS_EXPERIMENTS_URI ) {
		return { kind: 'experiments', tail: '' };
	}
	if ( splat === SETTINGS_PUBLISHED_URI ) {
		if ( ! publicWebAffordances ) {
			return { kind: 'redirect', to: SETTINGS_IMPORT_URI, tail: '' };
		}
		return { kind: 'published', tail: '' };
	}
	// `trash/<id>` and `archived/<id>` open that document in the canvas while
	// the sidebar lists its view. `trash` and `archived` alone are the panes
	// shown when nothing is selected.
	const lifecycle = lifecycleOfUri( splat );
	if ( lifecycle ) {
		const id = Number( parseSplatUri( splat ).tail ) || null;
		if ( id ) {
			return {
				kind: 'document',
				id,
				tail: `${ id }`,
				fromLifecycle: lifecycle,
			};
		}
		return { kind: lifecycle, tail: '' };
	}
	if ( ! splat ) {
		return { kind: 'empty', tail: '' };
	}
	return { kind: 'document', id: parseIdFromUri( splat ), tail: splat };
}

function lifecycleOfUri( splat ) {
	if ( isTrashUri( splat ) ) {
		return 'trash';
	}
	if ( isArchivedUri( splat ) ) {
		return 'archived';
	}
	return null;
}

function isLifecyclePane( target ) {
	return target.kind === 'trash' || target.kind === 'archived';
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
			} else if ( target.kind === 'experiments' ) {
				active = { kind: 'experiments' };
			} else if ( target.kind === 'import' ) {
				active = { kind: 'import' };
			} else if ( isLifecyclePane( target ) ) {
				active = { kind: target.kind };
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
	} else if ( target.kind === 'experiments' ) {
		active = { kind: 'experiments' };
	} else if ( target.kind === 'import' ) {
		active = { kind: 'import' };
	} else if ( isLifecyclePane( target ) ) {
		active = { kind: target.kind };
	} else if ( target.kind === 'redirect' ) {
		active = { kind: 'loading' };
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
