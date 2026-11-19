import { useMemo } from '@wordpress/element';
import { useEntityRecords } from '@wordpress/core-data';

import { ACTIVE_PAGES_QUERY, POST_TYPE } from '../page-queries';
import { originalPath, useTrashedByName } from './trashItems';
import { computeTrashRoots } from './trashRoots';
import useTrashedDocuments from '../../hooks/useTrashedDocuments';

/**
 * What Trash knows about one trashed document: its listing record, how many
 * nested documents come back with it, the documents it hung from, and who
 * sent it there.
 *
 * @param {number} postId Trashed document id.
 * @return {?{record: Object, nestedCount: number, path: string[], byName: string}}
 *         Null until the Trash list has loaded, or when the document is not in it.
 */
export default function useTrashDetails( postId ) {
	const { documents } = useTrashedDocuments();
	const { records: activePages } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const trashedByName = useTrashedByName();

	const details = useMemo( () => {
		const trashed = Array.isArray( documents ) ? documents : [];
		const record = trashed.find( ( document ) => document.id === postId );
		if ( ! record ) {
			return null;
		}
		const ancestorById = new Map();
		( activePages ?? [] ).forEach( ( page ) =>
			ancestorById.set( page.id, page )
		);
		trashed.forEach( ( document ) => {
			if ( ! ancestorById.has( document.id ) ) {
				ancestorById.set( document.id, document );
			}
		} );
		return {
			record,
			nestedCount:
				computeTrashRoots( trashed ).descendantCountById.get( postId )
					?.total ?? 0,
			path: originalPath( record, ancestorById ),
		};
	}, [ activePages, documents, postId ] );

	return details
		? { ...details, byName: trashedByName( details.record ) }
		: null;
}
