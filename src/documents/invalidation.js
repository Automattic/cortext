import {
	ACTIVE_PAGES_QUERY,
	HOME_FALLBACK_QUERY,
	POST_TYPE as PAGE_POST_TYPE,
	PUBLISHED_DOCUMENTS_QUERY,
	TRASHED_PAGES_QUERY,
} from '../components/page-queries';
import {
	DOCUMENT_POST_TYPE,
	FULL_PAGE_COLLECTION_QUERY,
	collectionSearchQuery,
} from '../collections';

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

const COLLECTION_PICKER = [
	'getEntityRecords',
	[ 'postType', DOCUMENT_POST_TYPE, collectionSearchQuery( '' ) ],
];

const HOME_FALLBACK = [
	'getEntityRecords',
	[ 'postType', PAGE_POST_TYPE, HOME_FALLBACK_QUERY ],
];

const PUBLISHED_DOCUMENTS = [
	'getEntityRecords',
	[ 'postType', PAGE_POST_TYPE, PUBLISHED_DOCUMENTS_QUERY ],
];

/**
 * A lifecycle change on any document can affect the sidebar document tree (the
 * non-row query that holds pages and collections), the trashed-pages list, the
 * collections lookup that Favorites resolves titles from, the collection
 * pickers' unfiltered list, the Published pane's status-filtered membership,
 * and the first root document used as the home fallback. Refresh all six after
 * archive, trash, restore, permanent delete, and duplicate.
 */
export const afterDocumentTrash = [
	ACTIVE_PAGES,
	TRASHED_PAGES,
	FULL_PAGE_COLLECTIONS,
	COLLECTION_PICKER,
	PUBLISHED_DOCUMENTS,
	HOME_FALLBACK,
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
