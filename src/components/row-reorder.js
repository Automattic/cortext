export const ROW_DROP_BEFORE = 'before';
export const ROW_DROP_AFTER = 'after';

function sameId( a, b ) {
	return String( a ) === String( b );
}

function rowId( row ) {
	return row?.id;
}

function numericId( id ) {
	const number = Number( id );
	return Number.isFinite( number ) ? number : id;
}

export function computeReorderRequest( rows, draggedId, overId, zone ) {
	if (
		! Array.isArray( rows ) ||
		! draggedId ||
		! overId ||
		sameId( draggedId, overId ) ||
		( zone !== ROW_DROP_BEFORE && zone !== ROW_DROP_AFTER )
	) {
		return null;
	}

	const draggedIndex = rows.findIndex( ( row ) =>
		sameId( rowId( row ), draggedId )
	);
	if ( draggedIndex < 0 ) {
		return null;
	}

	const withoutDragged = rows.filter(
		( row ) => ! sameId( rowId( row ), draggedId )
	);
	const overIndex = withoutDragged.findIndex( ( row ) =>
		sameId( rowId( row ), overId )
	);
	if ( overIndex < 0 ) {
		return null;
	}

	const insertIndex = zone === ROW_DROP_BEFORE ? overIndex : overIndex + 1;
	if ( insertIndex === draggedIndex ) {
		return null;
	}

	const after = withoutDragged[ insertIndex - 1 ];
	const before = withoutDragged[ insertIndex ];
	if ( ! after && ! before ) {
		return null;
	}

	return {
		before_id: before ? numericId( rowId( before ) ) : null,
		after_id: after ? numericId( rowId( after ) ) : null,
	};
}
