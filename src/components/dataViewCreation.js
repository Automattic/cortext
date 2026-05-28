function positiveInteger( value, fallback ) {
	const number = Number( value );
	return Number.isFinite( number ) && number >= 1
		? Math.floor( number )
		: fallback;
}

function hasQueryConstraints( view = {} ) {
	const search =
		typeof view.search === 'string' ? view.search.trim() : view.search;
	return (
		Boolean( search ) ||
		( Array.isArray( view.filters ) && view.filters.length > 0 )
	);
}

export function nextViewAfterRowCreated( view = {}, paginationInfo = {} ) {
	if ( view?.sort?.field || hasQueryConstraints( view ) ) {
		return view;
	}

	const page = positiveInteger( view?.page, 1 );
	const perPage = positiveInteger( view?.perPage, 25 );
	const totalItems = Math.max(
		0,
		positiveInteger( paginationInfo?.totalItems, 0 )
	);
	const lastPage = Math.max( 1, Math.ceil( ( totalItems + 1 ) / perPage ) );

	if ( page === lastPage ) {
		return view;
	}

	return {
		...view,
		page: lastPage,
	};
}
