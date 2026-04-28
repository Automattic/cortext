import { useEffect, useRef, useState } from '@wordpress/element';
import { addQueryArgs } from '@wordpress/url';
import apiFetch from '@wordpress/api-fetch';

function buildQueryArgs( collectionId, view ) {
	const args = {
		collection: collectionId,
		per_page: view?.perPage ?? 25,
		page: view?.page ?? 1,
	};

	if ( view?.search ) {
		args.search = view.search;
	}

	if ( view?.sort?.field && view?.sort?.direction ) {
		args[ 'sort[field]' ] = view.sort.field;
		args[ 'sort[direction]' ] = view.sort.direction;
	}

	if ( view?.filters?.length ) {
		view.filters.forEach( ( filter, i ) => {
			if ( filter.field && filter.operator ) {
				args[ `filters[${ i }][field]` ] = filter.field;
				args[ `filters[${ i }][operator]` ] = filter.operator;
				if ( Array.isArray( filter.value ) ) {
					filter.value.forEach( ( v, j ) => {
						args[ `filters[${ i }][value][${ j }]` ] = v;
					} );
				} else {
					args[ `filters[${ i }][value]` ] = filter.value;
				}
			}
		} );
	}

	return args;
}

export default function useCollectionRows( collectionId, view ) {
	const [ state, setState ] = useState( {
		data: [],
		paginationInfo: { totalItems: 0, totalPages: 0 },
		isLoading: false,
		error: null,
	} );

	const requestIdRef = useRef( 0 );
	const queryKey = collectionId
		? JSON.stringify( buildQueryArgs( collectionId, view ) )
		: null;

	useEffect( () => {
		if ( ! collectionId ) {
			setState( {
				data: [],
				paginationInfo: { totalItems: 0, totalPages: 0 },
				isLoading: false,
				error: null,
			} );
			return undefined;
		}

		const requestId = ++requestIdRef.current;
		const path = addQueryArgs(
			'/cortext/v1/rows',
			buildQueryArgs( collectionId, view )
		);

		setState( ( prev ) => ( { ...prev, isLoading: true, error: null } ) );

		apiFetch( { path } )
			.then( ( body ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					data: Array.isArray( body.rows ) ? body.rows : [],
					paginationInfo: {
						totalItems: body.total ?? 0,
						totalPages: body.totalPages ?? 1,
					},
					isLoading: false,
					error: null,
				} );
			} )
			.catch( ( error ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					data: [],
					paginationInfo: { totalItems: 0, totalPages: 0 },
					isLoading: false,
					error,
				} );
			} );

		return undefined;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ collectionId, queryKey ] );

	return state;
}
