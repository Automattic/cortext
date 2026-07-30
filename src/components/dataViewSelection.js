export function normalizeRowId( id ) {
	if ( id === null || id === undefined ) {
		return '';
	}
	return String( id );
}

export function rowIds( rows = [] ) {
	return rows.map( ( row ) => normalizeRowId( row?.id ) ).filter( Boolean );
}

export function rowsInDataViewRenderOrder( rows = [], view = {}, fields = [] ) {
	const groupFieldId = view?.groupBy?.field;
	if ( ! groupFieldId ) {
		return rows;
	}

	const groupField = fields.find( ( field ) => field.id === groupFieldId );
	if ( ! groupField?.getValue ) {
		return rows;
	}

	const groups = new Map();
	rows.forEach( ( row ) => {
		const groupName = groupField.getValue( { item: row } );
		if ( ! groups.has( groupName ) ) {
			groups.set( groupName, [] );
		}
		groups.get( groupName ).push( row );
	} );

	return Array.from( groups.values() ).flat();
}

function uniqueIds( ids = [] ) {
	const seen = new Set();
	const next = [];
	for ( const id of ids.map( normalizeRowId ).filter( Boolean ) ) {
		if ( seen.has( id ) ) {
			continue;
		}
		seen.add( id );
		next.push( id );
	}
	return next;
}

export function mergeVisibleSelection(
	previousSelection,
	nextVisibleSelection,
	visibleIds
) {
	const visible = new Set( visibleIds.map( normalizeRowId ) );
	return uniqueIds( [
		...previousSelection.filter( ( id ) => ! visible.has( id ) ),
		...nextVisibleSelection,
	] );
}

export function removeVisibleSelection( previousSelection, visibleIds ) {
	const visible = new Set( visibleIds.map( normalizeRowId ) );
	return previousSelection.filter( ( id ) => ! visible.has( id ) );
}

export function rangeSelection( visibleIds, anchorId, targetId ) {
	const ids = visibleIds.map( normalizeRowId );
	const target = normalizeRowId( targetId );
	const targetIndex = ids.indexOf( target );
	if ( targetIndex < 0 ) {
		return [];
	}

	const anchor = normalizeRowId( anchorId );
	const anchorIndex = ids.indexOf( anchor );
	if ( anchorIndex < 0 ) {
		return [ target ];
	}

	const start = Math.min( anchorIndex, targetIndex );
	const end = Math.max( anchorIndex, targetIndex );
	return ids.slice( start, end + 1 );
}

export function applyVisibleSelectionChange(
	previousSelection,
	nextVisibleSelection,
	visibleIds,
	interaction = {}
) {
	if ( interaction.type !== 'merge' ) {
		return previousSelection;
	}

	const targetId = normalizeRowId( interaction.targetId );
	const nextIds = uniqueIds( nextVisibleSelection );
	if (
		interaction.source === 'checkbox' &&
		targetId &&
		nextIds.length === 1 &&
		nextIds[ 0 ] === targetId
	) {
		const visible = new Set( visibleIds.map( normalizeRowId ) );
		const selected = new Set( previousSelection.map( normalizeRowId ) );
		const hasOtherVisibleSelection = previousSelection.some( ( id ) => {
			const normalizedId = normalizeRowId( id );
			return visible.has( normalizedId ) && normalizedId !== targetId;
		} );

		if ( hasOtherVisibleSelection && ! selected.has( targetId ) ) {
			return uniqueIds( [ ...previousSelection, targetId ] );
		}
	}

	return mergeVisibleSelection(
		previousSelection,
		nextVisibleSelection,
		visibleIds
	);
}

export function toggleVisibleSelection( previousSelection, visibleIds ) {
	const ids = visibleIds.map( normalizeRowId ).filter( Boolean );
	if ( ids.length === 0 ) {
		return previousSelection;
	}

	const selected = new Set( previousSelection );
	const allVisibleSelected = ids.every( ( id ) => selected.has( id ) );
	if ( allVisibleSelected ) {
		return removeVisibleSelection( previousSelection, ids );
	}

	return mergeVisibleSelection( previousSelection, ids, ids );
}

export function removeDeletedSelection( previousSelection, deletedIds ) {
	const deleted = new Set( deletedIds.map( normalizeRowId ) );
	return previousSelection
		.map( normalizeRowId )
		.filter( Boolean )
		.filter( ( id ) => ! deleted.has( id ) );
}
