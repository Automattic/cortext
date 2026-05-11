import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { addQueryArgs } from '@wordpress/url';
import apiFetch from '@wordpress/api-fetch';

// tech-debt.md#2: rows live outside core-data, so this hook manages
// its own fetch state and exposes a manual refresh() handle.

const CLIENT_PER_PAGE = 100;
const CLIENT_PAGE_FETCH_CONCURRENCY = 4;
const SERVER_OPERATORS = new Set( [ 'is', 'isNot', 'isAny', 'isNone' ] );
const SERVER_SORT_FIELDS = new Set( [ 'title', 'created_at', 'modified_at' ] );
const SERVER_FILTER_FIELD_TYPES = new Set( [
	'text',
	'number',
	'email',
	'url',
	'select',
	'multiselect',
	'date',
	'datetime',
	'checkbox',
] );

function fieldTypeMap( fields = [] ) {
	return new Map( fields.map( ( f ) => [ f.id, f.cortextType ] ) );
}

function hasSearch( view ) {
	return Boolean( String( view?.search ?? '' ).trim() );
}

function hasCalculations( view ) {
	return Object.values( view?.calculations ?? {} ).some( Boolean );
}

function isCollectionFieldKey( field ) {
	return /^field-\d+$/.test( field );
}

function pageNumber( value, fallback = 1 ) {
	const number = Number( value );
	return Number.isFinite( number ) && number >= 1
		? Math.floor( number )
		: fallback;
}

function perPageNumber( value, fallback = 25 ) {
	const number = Number( value );
	if ( ! Number.isFinite( number ) || number < 1 ) {
		return fallback;
	}
	return Math.min( 100, Math.floor( number ) );
}

function isServerSupportedSort( sort ) {
	if ( ! sort?.field ) {
		return true;
	}
	return SERVER_SORT_FIELDS.has( sort.field );
}

function isServerSupportedFilter( filter, fieldTypes ) {
	if (
		! filter ||
		typeof filter !== 'object' ||
		! filter.field ||
		! filter.operator ||
		! SERVER_OPERATORS.has( filter.operator )
	) {
		return false;
	}
	if (
		( filter.operator === 'isAny' || filter.operator === 'isNone' ) &&
		( ! Array.isArray( filter.value ) || filter.value.length === 0 )
	) {
		return false;
	}
	if (
		( filter.operator === 'is' || filter.operator === 'isNot' ) &&
		( filter.value === undefined || Array.isArray( filter.value ) )
	) {
		return false;
	}
	return (
		isCollectionFieldKey( filter.field ) &&
		SERVER_FILTER_FIELD_TYPES.has( fieldTypes.get( filter.field ) )
	);
}

function addFiltersToArgs( args, filters ) {
	filters.forEach( ( filter, i ) => {
		args[ `filters[${ i }][field]` ] = filter.field;
		args[ `filters[${ i }][operator]` ] = filter.operator;
		if ( Array.isArray( filter.value ) ) {
			filter.value.forEach( ( v, j ) => {
				args[ `filters[${ i }][value][${ j }]` ] = v;
			} );
		} else {
			args[ `filters[${ i }][value]` ] = filter.value;
		}
	} );
}

function buildClientQueryArgs( collectionId ) {
	return {
		collection: collectionId,
		page: 1,
		per_page: CLIENT_PER_PAGE,
	};
}

function buildServerQueryArgs( collectionId, view ) {
	const args = {
		collection: collectionId,
		page: pageNumber( view?.page ),
		per_page: perPageNumber( view?.perPage ),
	};

	if ( view?.sort?.field ) {
		args[ 'sort[field]' ] = view.sort.field;
		args[ 'sort[direction]' ] =
			view.sort.direction === 'asc' ? 'asc' : 'desc';
	}

	addFiltersToArgs( args, view?.filters ?? [] );

	return args;
}

function buildQueryPlan( collectionId, view, fields = [], options = {} ) {
	const fieldTypes = fieldTypeMap( fields );
	const filters = Array.isArray( view?.filters ) ? view.filters : [];
	const canUseServer =
		! options.forceClient &&
		! hasSearch( view ) &&
		! hasCalculations( view ) &&
		isServerSupportedSort( view?.sort ) &&
		filters.every( ( filter ) =>
			isServerSupportedFilter( filter, fieldTypes )
		);

	if ( ! canUseServer ) {
		return {
			mode: 'client',
			args: buildClientQueryArgs( collectionId ),
		};
	}

	return {
		mode: 'server',
		args: buildServerQueryArgs( collectionId, view ),
	};
}

function schemaSignature( fields = [] ) {
	return fields
		.map(
			( field ) =>
				`${ field.id }:${ field.recordId ?? '' }:${
					field.cortextType ?? ''
				}`
		)
		.join( '|' );
}

function totalPagesNumber( value ) {
	const number = Number( value );
	return Number.isFinite( number ) && number >= 1 ? Math.floor( number ) : 1;
}

async function fetchRowsPage( args ) {
	return apiFetch( {
		path: addQueryArgs( '/cortext/v1/rows', args ),
	} );
}

export default function useCollectionRows(
	collectionId,
	view,
	fields = [],
	options = {}
) {
	const [ state, setState ] = useState( {
		data: [],
		collection: null,
		paginationInfo: { totalItems: 0, totalPages: 0 },
		isLoading: false,
		hasResolved: false,
		error: null,
	} );
	const [ refreshKey, setRefreshKey ] = useState( 0 );

	const requestIdRef = useRef( 0 );
	const queryPlan = collectionId
		? buildQueryPlan( collectionId, view, fields, options )
		: null;
	const queryKey = collectionId
		? JSON.stringify( {
				args: queryPlan.args,
				schema: schemaSignature( fields ),
				mode: queryPlan.mode,
		  } )
		: null;

	// tech-debt.md#2: callers POST via apiFetch and bump refresh() to
	// re-read. With rows in core-data this whole counter goes away.
	const refresh = useCallback( () => {
		setRefreshKey( ( key ) => key + 1 );
	}, [] );

	useEffect( () => {
		if ( ! collectionId ) {
			setState( {
				data: [],
				collection: null,
				paginationInfo: { totalItems: 0, totalPages: 0 },
				isLoading: false,
				hasResolved: false,
				error: null,
			} );
			return undefined;
		}

		const requestId = ++requestIdRef.current;
		const activeQueryPlan = queryPlan;

		setState( ( prev ) => ( {
			...prev,
			isLoading: true,
			hasResolved: false,
			error: null,
		} ) );

		async function loadRows() {
			try {
				const firstPage = await fetchRowsPage( activeQueryPlan.args );
				if ( requestId !== requestIdRef.current ) {
					return;
				}

				let body = firstPage;
				if ( activeQueryPlan.mode === 'client' ) {
					const totalPages = totalPagesNumber( firstPage.totalPages );
					const rows = Array.isArray( firstPage.rows )
						? [ ...firstPage.rows ]
						: [];
					const remainingPages = Array.from(
						{ length: totalPages - 1 },
						( _, index ) => index + 2
					);
					const remainingPageBodies = [];
					let nextPageIndex = 0;

					async function fetchNextPages() {
						while (
							nextPageIndex < remainingPages.length &&
							requestId === requestIdRef.current
						) {
							const index = nextPageIndex++;
							const page = remainingPages[ index ];
							const nextPage = await fetchRowsPage( {
								...activeQueryPlan.args,
								page,
							} );
							if ( requestId !== requestIdRef.current ) {
								return;
							}
							remainingPageBodies[ index ] = nextPage;
						}
					}

					const workerCount = Math.min(
						CLIENT_PAGE_FETCH_CONCURRENCY,
						remainingPages.length
					);
					await Promise.all(
						Array.from( { length: workerCount }, fetchNextPages )
					);
					if ( requestId !== requestIdRef.current ) {
						return;
					}

					remainingPageBodies.forEach( ( nextPage ) => {
						if ( Array.isArray( nextPage?.rows ) ) {
							rows.push( ...nextPage.rows );
						}
					} );

					body = { ...firstPage, rows };
				}

				setState( {
					data: Array.isArray( body.rows ) ? body.rows : [],
					collection: body.collection ?? null,
					paginationInfo: {
						totalItems: body.total ?? 0,
						totalPages: body.totalPages ?? 1,
					},
					isLoading: false,
					hasResolved: true,
					error: null,
				} );
			} catch ( error ) {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					data: [],
					collection: null,
					paginationInfo: { totalItems: 0, totalPages: 0 },
					isLoading: false,
					hasResolved: true,
					error,
				} );
			}
		}

		loadRows();

		return undefined;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ collectionId, queryKey, refreshKey ] );

	return { ...state, refresh, queryMode: queryPlan?.mode ?? 'client' };
}
