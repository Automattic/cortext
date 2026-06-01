import { useEffect, useRef, useState } from '@wordpress/element';
import { addQueryArgs } from '@wordpress/url';
import apiFetch from '@wordpress/api-fetch';

const SERVER_OPERATORS = new Set( [ 'is', 'isNot', 'isAny', 'isNone' ] );
const MANUAL_SORT_ID = 'manual';
const PUBLIC_PER_PAGE = 100;
const SYSTEM_SORT_FIELDS = new Set( [ 'title', 'created_at', 'modified_at' ] );
const SORTABLE_FIELD_TYPES = new Set( [
	'text',
	'email',
	'url',
	'number',
	'date',
	'datetime',
	'checkbox',
	'select',
] );

export function isPublicSortSupported( sort, fields = [] ) {
	if ( ! sort?.field ) {
		return true;
	}
	if ( sort.field === MANUAL_SORT_ID ) {
		return true;
	}
	if ( SYSTEM_SORT_FIELDS.has( sort.field ) ) {
		return true;
	}

	const match = /^field-(\d+)$/.exec( sort.field );
	if ( ! match ) {
		return false;
	}

	const fieldId = Number( match[ 1 ] );
	const field = fields.find( ( candidate ) => candidate?.id === fieldId );
	return SORTABLE_FIELD_TYPES.has( field?.type );
}

function sortForServer( sort, fields = [] ) {
	if (
		! sort?.field ||
		sort.field === MANUAL_SORT_ID ||
		! isPublicSortSupported( sort, fields )
	) {
		return null;
	}

	return {
		field: sort.field,
		direction: sort.direction === 'desc' ? 'desc' : 'asc',
	};
}

export function buildQueryArgs( collectionId, view, fields = [], page = 1 ) {
	const args = {
		trait: collectionId,
		context: 'view',
		page,
		per_page: PUBLIC_PER_PAGE,
	};

	const sort = sortForServer( view?.sort, fields );
	if ( sort ) {
		args[ 'sort[field]' ] = sort.field;
		args[ 'sort[direction]' ] = sort.direction;
	}

	const serverFilters = ( view?.filters ?? [] ).filter(
		( f ) => f.field && f.operator && SERVER_OPERATORS.has( f.operator )
	);
	serverFilters.forEach( ( filter, i ) => {
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

	return args;
}

function totalPagesNumber( value ) {
	const number = Number( value );
	return Number.isFinite( number ) && number >= 1 ? Math.floor( number ) : 1;
}

function fetchRowsPage( args ) {
	return apiFetch( {
		path: addQueryArgs( '/cortext/v1/rows', args ),
	} );
}

export default function usePublicRows( collectionId, view ) {
	const [ state, setState ] = useState( {
		data: [],
		fields: [],
		paginationInfo: { totalItems: 0, totalPages: 0 },
		isLoading: true,
	} );

	const requestIdRef = useRef( 0 );
	const queryKey = collectionId
		? JSON.stringify( buildQueryArgs( collectionId, view, state.fields ) )
		: null;

	useEffect( () => {
		if ( ! collectionId ) {
			setState( {
				data: [],
				fields: [],
				paginationInfo: { totalItems: 0, totalPages: 0 },
				isLoading: false,
			} );
			return;
		}

		const requestId = ++requestIdRef.current;
		const baseArgs = buildQueryArgs( collectionId, view, state.fields );

		setState( ( prev ) => ( { ...prev, isLoading: true } ) );

		async function loadRows() {
			try {
				const firstPage = await fetchRowsPage( baseArgs );
				if ( requestId !== requestIdRef.current ) {
					return;
				}

				const rows = Array.isArray( firstPage.rows )
					? [ ...firstPage.rows ]
					: [];
				const totalPages = totalPagesNumber( firstPage.totalPages );
				const remainingPages = Array.from(
					{ length: totalPages - 1 },
					( _, index ) => index + 2
				);
				const remainingPageBodies = await Promise.all(
					remainingPages.map( ( page ) =>
						fetchRowsPage( { ...baseArgs, page } )
					)
				);
				if ( requestId !== requestIdRef.current ) {
					return;
				}

				remainingPageBodies.forEach( ( body ) => {
					if ( Array.isArray( body?.rows ) ) {
						rows.push( ...body.rows );
					}
				} );

				setState( {
					data: rows,
					fields: Array.isArray( firstPage.fields )
						? firstPage.fields
						: [],
					paginationInfo: {
						totalItems: firstPage.total ?? rows.length,
						totalPages,
					},
					isLoading: false,
				} );
			} catch {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					data: [],
					fields: [],
					paginationInfo: { totalItems: 0, totalPages: 0 },
					isLoading: false,
				} );
			}
		}

		loadRows();

		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ collectionId, queryKey ] );

	return state;
}
