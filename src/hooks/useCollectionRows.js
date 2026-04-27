import { useEffect, useRef, useState } from '@wordpress/element';
import { addQueryArgs } from '@wordpress/url';
import apiFetch from '@wordpress/api-fetch';

function buildQueryArgs( view ) {
	const args = {
		context: 'edit',
		per_page: view?.perPage ?? 25,
		page: view?.page ?? 1,
		status: 'draft,private,publish',
	};

	if ( view?.search ) {
		args.search = view.search;
	}

	// TODO: Add server-side support for DataViews field sorting/filtering
	// before forwarding `view.sort` or `view.filters`. WP's posts REST
	// controller does not understand collection field ids like `field-123`.

	return args;
}

export default function useCollectionRows( collectionSlug, view ) {
	const [ state, setState ] = useState( {
		data: [],
		paginationInfo: { totalItems: 0, totalPages: 0 },
		isLoading: false,
	} );

	const requestIdRef = useRef( 0 );
	const queryKey = collectionSlug
		? JSON.stringify( buildQueryArgs( view ) )
		: null;

	useEffect( () => {
		if ( ! collectionSlug ) {
			setState( {
				data: [],
				paginationInfo: { totalItems: 0, totalPages: 0 },
				isLoading: false,
			} );
			return undefined;
		}

		const requestId = ++requestIdRef.current;
		// `crtxt_<slug>` is the dynamic per-collection row CPT registered by
		// `Cortext\PostType\CollectionEntries`. Slugs over 14 chars get
		// rejected at registration; assume valid slugs here.
		const path = addQueryArgs(
			`/wp/v2/crtxt_${ collectionSlug }`,
			buildQueryArgs( view )
		);

		setState( ( prev ) => ( { ...prev, isLoading: true } ) );

		apiFetch( { path, parse: false } )
			.then( async ( response ) => {
				const rows = await response.json();
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				const totalItems = Number(
					response.headers.get( 'X-WP-Total' ) ?? rows.length
				);
				const totalPages = Number(
					response.headers.get( 'X-WP-TotalPages' ) ?? 1
				);
				setState( {
					data: Array.isArray( rows ) ? rows : [],
					paginationInfo: { totalItems, totalPages },
					isLoading: false,
				} );
			} )
			.catch( () => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					data: [],
					paginationInfo: { totalItems: 0, totalPages: 0 },
					isLoading: false,
				} );
			} );

		return undefined;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ collectionSlug, queryKey ] );

	return state;
}
