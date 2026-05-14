import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

import { useCollectionRowsInvalidation } from './rowInvalidation';

export default function useTrashedRows() {
	const [ state, setState ] = useState( {
		rows: [],
		total: 0,
		isLoading: false,
		hasResolved: false,
		error: null,
	} );
	const [ refreshKey, setRefreshKey ] = useState( 0 );
	const requestIdRef = useRef( 0 );

	const refresh = useCallback( () => {
		setRefreshKey( ( key ) => key + 1 );
	}, [] );

	useCollectionRowsInvalidation( null, refresh );

	useEffect( () => {
		const requestId = ++requestIdRef.current;

		setState( ( current ) => ( {
			...current,
			isLoading: true,
			hasResolved: false,
			error: null,
		} ) );

		apiFetch( { path: '/cortext/v1/rows/trash' } )
			.then( ( body ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				const rows = Array.isArray( body?.rows ) ? body.rows : [];
				setState( {
					rows,
					total: Number.isFinite( Number( body?.total ) )
						? Number( body.total )
						: rows.length,
					isLoading: false,
					hasResolved: true,
					error: null,
				} );
			} )
			.catch( ( error ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( ( current ) => ( {
					...current,
					isLoading: false,
					hasResolved: true,
					error,
				} ) );
			} );
	}, [ refreshKey ] );

	return { ...state, refresh };
}
