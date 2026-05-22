import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { addQueryArgs } from '@wordpress/url';
import apiFetch from '@wordpress/api-fetch';

const ROWS_PATH = '/cortext/v1/rows';
const MAX_IDS_PER_REQUEST = 100;

function chunk( values, size ) {
	const chunks = [];
	for ( let i = 0; i < values.length; i += size ) {
		chunks.push( values.slice( i, i + size ) );
	}
	return chunks;
}

function buildIncludeArgs( collectionId, ids ) {
	const args = {
		collection: collectionId,
		per_page: MAX_IDS_PER_REQUEST,
		context: 'edit',
	};
	ids.forEach( ( id, index ) => {
		args[ `include[${ index }]` ] = id;
	} );
	return args;
}

/**
 * Resolves a set of rows by ID without paging through their collection. The
 * picker uses this to render the labels of already-selected relations even
 * when those rows do not appear in the current search results.
 *
 * Chunks at the endpoint's 100-row ceiling so larger selections fan out into
 * parallel requests. A `requestIdRef` cancels stale results when the id list
 * changes rapidly.
 *
 * @param {number|null} collectionId Target collection ID.
 * @param {number[]}    ids          Row IDs to resolve.
 * @return {{ rows: object[], isLoading: boolean, error: Error|null }} Resolved rows and request status.
 */
export default function useCollectionRowsByIds( collectionId, ids ) {
	// Copy before sorting so we never mutate the caller's array. Sort
	// numerically so the request URLs come out in natural order; the default
	// .sort() is lexicographic and would shuffle e.g. [1, 2, 10] to [1, 10, 2].
	const idsKey = useMemo(
		() =>
			JSON.stringify(
				Array.isArray( ids ) ? [ ...ids ].sort( ( a, b ) => a - b ) : []
			),
		[ ids ]
	);

	const [ state, setState ] = useState( {
		rows: [],
		isLoading: false,
		error: null,
	} );
	const requestIdRef = useRef( 0 );

	useEffect( () => {
		const parsed = JSON.parse( idsKey );
		// Always bump the request id, even on the no-fetch branch. Otherwise
		// an earlier in-flight request would still see `requestId ===
		// requestIdRef.current` when it resolves and write stale rows back
		// over the empty state we just set.
		const requestId = ++requestIdRef.current;
		if ( ! collectionId || parsed.length === 0 ) {
			setState( { rows: [], isLoading: false, error: null } );
			return undefined;
		}

		setState( ( prev ) => ( { ...prev, isLoading: true, error: null } ) );

		( async () => {
			try {
				const batches = chunk( parsed, MAX_IDS_PER_REQUEST );
				const responses = await Promise.all(
					batches.map( ( batch ) =>
						apiFetch( {
							path: addQueryArgs(
								ROWS_PATH,
								buildIncludeArgs( collectionId, batch )
							),
						} )
					)
				);
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				const rows = responses.flatMap( ( body ) =>
					Array.isArray( body?.rows ) ? body.rows : []
				);
				setState( { rows, isLoading: false, error: null } );
			} catch ( error ) {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( { rows: [], isLoading: false, error } );
			}
		} )();

		return undefined;
	}, [ collectionId, idsKey ] );

	return state;
}
