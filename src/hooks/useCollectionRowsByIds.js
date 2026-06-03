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
		trait: collectionId,
		per_page: MAX_IDS_PER_REQUEST,
		context: 'edit',
	};
	ids.forEach( ( id, index ) => {
		args[ `include[${ index }]` ] = id;
	} );
	return args;
}

/**
 * Fetches rows by ID without walking the whole collection. The picker uses
 * this for selected relation labels that are outside the current search page.
 *
 * Splits large selections at the endpoint's 100-row limit and ignores stale
 * responses when the ID list changes quickly.
 *
 * @param {number|null} collectionId Target collection ID.
 * @param {number[]}    ids          Row IDs to resolve.
 * @return {{ rows: object[], isLoading: boolean, error: Error|null }} Resolved rows and request status.
 */
export default function useCollectionRowsByIds( collectionId, ids ) {
	// Sort a copy so the caller's array is left alone. Numeric sort keeps the
	// request URLs readable; default .sort() would put 10 before 2.
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
		// Bump the request id even when there is nothing to fetch, so an older
		// response cannot write rows back after we have cleared the state.
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
