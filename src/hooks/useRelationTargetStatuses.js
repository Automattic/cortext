import apiFetch from '@wordpress/api-fetch';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';

import { relationTargetStatuses } from '../components/relations/relationUtils';
import { useDocumentArchiveInvalidation } from './documentArchiveInvalidation';

const EMPTY = {};

/**
 * Tracks the current status of a row's relation targets while the row stays
 * open. After any document is archived, restored, or trashed, it refetches the
 * row's relation values and keeps only `{ targetId: status }`, so callers can
 * update chip status without replacing the values they already show. Returns
 * an empty object until the first change.
 *
 * @param {number|null|undefined} rowId Row document ID.
 * @return {Object<number,string>} Target statuses keyed by target ID.
 */
export default function useRelationTargetStatuses( rowId ) {
	const [ state, setState ] = useState( { rowId, statuses: EMPTY } );
	const requestIdRef = useRef( 0 );

	const refresh = useCallback( async () => {
		if ( ! rowId ) {
			return;
		}
		const requestId = ++requestIdRef.current;
		try {
			const record = await apiFetch( {
				path: `/wp/v2/crtxt_documents/${ rowId }?context=edit&_fields=cortext_hydrated_meta`,
			} );
			if ( requestId === requestIdRef.current ) {
				setState( {
					rowId,
					statuses: relationTargetStatuses(
						record?.cortext_hydrated_meta
					),
				} );
			}
		} catch {
			// Keep the last known statuses; the next change retries.
		}
	}, [ rowId ] );

	useEffect( () => {
		requestIdRef.current++;
	}, [ rowId ] );

	useDocumentArchiveInvalidation( refresh );

	return state.rowId === rowId ? state.statuses : EMPTY;
}
