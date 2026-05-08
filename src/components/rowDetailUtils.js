export const ROW_DETAIL_MODES = [ 'side', 'modal', 'full' ];
export const DEFAULT_ROW_DETAIL_MODE = 'side';

export function normalizeRowDetailMode( mode ) {
	return ROW_DETAIL_MODES.includes( mode ) ? mode : DEFAULT_ROW_DETAIL_MODE;
}

export function getRowDetailMode( view ) {
	return normalizeRowDetailMode( view?.rowDetailMode );
}

export function withRowDetailMode( view, mode ) {
	const nextMode = normalizeRowDetailMode( mode );
	if ( view?.rowDetailMode === nextMode ) {
		return view;
	}
	return { ...( view ?? {} ), rowDetailMode: nextMode };
}

export function adjacentRowId( rows, currentRowId, direction ) {
	if ( ! Array.isArray( rows ) || ! rows.length ) {
		return null;
	}
	const current = String( currentRowId );
	const index = rows.findIndex( ( row ) => String( row?.id ) === current );
	if ( index < 0 ) {
		return null;
	}
	const next = rows[ index + direction ];
	return next?.id ?? null;
}

export function splitPropertyPatch( patch ) {
	const next = {
		title: undefined,
		meta: null,
	};
	const metaPatch = {};

	for ( const [ key, value ] of Object.entries( patch ?? {} ) ) {
		if ( key === 'title' ) {
			next.title = value ?? '';
		} else {
			metaPatch[ key ] = value;
		}
	}

	// Only the changed keys go through editPost. Merging the full
	// current meta would mark every key edited and round-trip values
	// (including hydrated relations / rollups) back into REST on save,
	// where they'd be rejected against their `string`-typed registration.
	if ( Object.keys( metaPatch ).length > 0 ) {
		next.meta = metaPatch;
	}

	return next;
}

const NUMBER_DRAFT_PATTERN = /^[+-]?\d*(?:\.\d*)?$/;
const NUMBER_COMPLETE_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function isValidNumberDraft( value ) {
	return NUMBER_DRAFT_PATTERN.test( String( value ?? '' ) );
}

export function parseNumberPropertyValue( value ) {
	const text = String( value ?? '' );
	if ( text === '' ) {
		return { valid: true, complete: true, value: null };
	}
	if ( ! isValidNumberDraft( text ) ) {
		return { valid: false, complete: false, value: null };
	}
	if ( ! NUMBER_COMPLETE_PATTERN.test( text ) ) {
		return { valid: true, complete: false, value: null };
	}
	const number = Number( text );
	return Number.isFinite( number )
		? { valid: true, complete: true, value: number }
		: { valid: false, complete: false, value: null };
}
