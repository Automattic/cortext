import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
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
	//
	// Until then: when the user hasn't picked a sort, default to
	// oldest-first so newly created rows land at the bottom of the table
	// (Notion-style). If `view.sort` is set we leave ordering to the REST
	// default and let the sort-forwarding work pick it up later — better
	// than silently overriding the user's choice.
	if ( ! view?.sort?.field ) {
		args.orderby = 'date';
		args.order = 'asc';
	}

	return args;
}

export default function useCollectionRows( collectionSlug, view ) {
	const [ state, setState ] = useState( {
		data: [],
		paginationInfo: { totalItems: 0, totalPages: 0 },
		isLoading: false,
		error: null,
	} );
	const [ refreshKey, setRefreshKey ] = useState( 0 );

	const requestIdRef = useRef( 0 );
	const queryKey = collectionSlug
		? JSON.stringify( buildQueryArgs( view ) )
		: null;

	const refresh = useCallback( () => {
		setRefreshKey( ( key ) => key + 1 );
	}, [] );

	useEffect( () => {
		if ( ! collectionSlug ) {
			setState( {
				data: [],
				paginationInfo: { totalItems: 0, totalPages: 0 },
				isLoading: false,
				error: null,
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

		setState( ( prev ) => ( { ...prev, isLoading: true, error: null } ) );

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
	}, [ collectionSlug, queryKey, refreshKey ] );

	return { ...state, refresh };
}
