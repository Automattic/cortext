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

export function splitPropertyPatch( patch, currentMeta = {} ) {
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

	if ( Object.keys( metaPatch ).length > 0 ) {
		next.meta = { ...( currentMeta ?? {} ), ...metaPatch };
	}

	return next;
}
