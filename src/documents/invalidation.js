import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE as PAGE_POST_TYPE,
	TRASHED_PAGES_QUERY,
} from '../components/page-queries';
import { DOCUMENT_POST_TYPE, FULL_PAGE_COLLECTION_QUERY } from '../collections';

const ACTIVE_PAGES = [
	'getEntityRecords',
	[ 'postType', PAGE_POST_TYPE, ACTIVE_PAGES_QUERY ],
];

const TRASHED_PAGES = [
	'getEntityRecords',
	[ 'postType', PAGE_POST_TYPE, TRASHED_PAGES_QUERY ],
];

const FULL_PAGE_COLLECTIONS = [
	'getEntityRecords',
	[ 'postType', DOCUMENT_POST_TYPE, FULL_PAGE_COLLECTION_QUERY ],
];

/**
 * A direct document update can change labels and icons already shown in the
 * sidebar tree and Favorites lookup without moving anything in or out of Trash.
 */
export const afterDocumentIdentityChange = [
	ACTIVE_PAGES,
	FULL_PAGE_COLLECTIONS,
];

/**
 * A lifecycle change on any document can affect the sidebar document tree (the
 * non-row query that holds pages and collections), the trashed-pages list, and
 * the collections lookup that Favorites resolves titles from. Refresh all three
 * after trash, restore, permanent delete, and duplicate.
 */
export const afterDocumentTrash = [
	ACTIVE_PAGES,
	TRASHED_PAGES,
	FULL_PAGE_COLLECTIONS,
];

/**
 * Apply an invalidation pack with `invalidateResolution`.
 *
 * @param {Function}     dispatcher `invalidateResolution` from `useDispatch( 'core' )`.
 * @param {Array<Array>} pack       Named pack from this file.
 */
export function applyInvalidationPack( dispatcher, pack ) {
	if ( ! dispatcher || ! Array.isArray( pack ) ) {
		return;
	}
	pack.forEach( ( [ selector, args ] ) => {
		dispatcher( selector, args );
	} );
}
