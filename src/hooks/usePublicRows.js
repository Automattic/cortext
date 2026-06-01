import { useEffect, useRef, useState } from '@wordpress/element';
import { addQueryArgs } from '@wordpress/url';
import apiFetch from '@wordpress/api-fetch';

const SERVER_OPERATORS = new Set( [ 'is', 'isNot', 'isAny', 'isNone' ] );
const MANUAL_SORT_ID = 'manual';
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

export function buildQueryArgs( collectionId, view, fields = [] ) {
	const args = {
		trait: collectionId,
		context: 'view',
		per_page: -1,
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
		const path = addQueryArgs(
			'/cortext/v1/rows',
			buildQueryArgs( collectionId, view, state.fields )
		);

		setState( ( prev ) => ( { ...prev, isLoading: true } ) );

		apiFetch( { path } )
			.then( ( body ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					data: Array.isArray( body.rows ) ? body.rows : [],
					fields: Array.isArray( body.fields ) ? body.fields : [],
					paginationInfo: {
						totalItems: body.total ?? 0,
						totalPages: body.totalPages ?? 1,
					},
					isLoading: false,
				} );
			} )
			.catch( () => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					data: [],
					fields: [],
					paginationInfo: { totalItems: 0, totalPages: 0 },
					isLoading: false,
				} );
			} );
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ collectionId, queryKey ] );

	return state;
}
