import { useMemo } from '@wordpress/element';
import { useEntityRecords } from '@wordpress/core-data';

import computeCascadeRoots from '../computeCascadeRoots';
import { ACTIVE_PAGES_QUERY, POST_TYPE } from '../page-queries';
import { originalPath, useLifecycleByName } from './lifecycleItems';

/**
 * What a lifecycle view knows about one of its documents: its listing record,
 * how many nested documents come back with it, the documents it hung from,
 * and who sent it there.
 *
 * @param {Object} state  Lifecycle state from `lifecycleStates`.
 * @param {number} postId Document id.
 * @return {?{record: Object, nestedCount: number, path: string[], byName: string}}
 *         Null until the list has loaded, or when the document is not in it.
 */
export default function useLifecycleDetails( state, postId ) {
	const { documents } = state.useDocuments();
	const { records: activePages } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const byName = useLifecycleByName( state.byKey );
	const { markerKeys } = state;

	const details = useMemo( () => {
		const listed = Array.isArray( documents ) ? documents : [];
		const record = listed.find( ( document ) => document.id === postId );
		if ( ! record ) {
			return null;
		}
		const ancestorById = new Map();
		( activePages ?? [] ).forEach( ( page ) =>
			ancestorById.set( page.id, page )
		);
		listed.forEach( ( document ) => {
			if ( ! ancestorById.has( document.id ) ) {
				ancestorById.set( document.id, document );
			}
		} );
		return {
			record,
			nestedCount:
				computeCascadeRoots(
					listed,
					markerKeys
				).descendantCountById.get( postId )?.total ?? 0,
			path: originalPath( record, ancestorById ),
		};
	}, [ activePages, documents, markerKeys, postId ] );

	return details ? { ...details, byName: byName( details.record ) } : null;
}
