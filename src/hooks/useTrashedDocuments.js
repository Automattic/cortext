import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

import { useDocumentTrashInvalidation } from './documentTrashInvalidation';

export default function useTrashedDocuments() {
	const [ state, setState ] = useState( {
		documents: [],
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

	useDocumentTrashInvalidation( refresh );

	useEffect( () => {
		const requestId = ++requestIdRef.current;

		setState( ( current ) => ( {
			...current,
			isLoading: true,
			hasResolved: false,
			error: null,
		} ) );

		apiFetch( { path: '/cortext/v1/documents/trash' } )
			.then( ( body ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				const documents = Array.isArray( body?.documents )
					? body.documents
					: [];
				setState( {
					documents,
					total: Number.isFinite( Number( body?.total ) )
						? Number( body.total )
						: documents.length,
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
