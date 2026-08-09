import {
	ACTIVE_PAGES_QUERY,
	HOME_FALLBACK_QUERY,
	POST_TYPE as PAGE_POST_TYPE,
	PUBLISHED_DOCUMENTS_QUERY,
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

const PUBLISHED_DOCUMENTS = [
	'getEntityRecords',
	[ 'postType', DOCUMENT_POST_TYPE, PUBLISHED_DOCUMENTS_QUERY ],
];

const HOME_FALLBACK = [
	'getEntityRecords',
	[ 'postType', PAGE_POST_TYPE, HOME_FALLBACK_QUERY ],
];

/**
 * A lifecycle change on any document can affect the sidebar document tree (the
 * non-row query that holds pages and collections), the trashed-pages list, and
 * the collections lookup that Favorites resolves titles from, the published
 * view, and the command palette's fallback home. Refresh them after trash,
 * restore, permanent delete, and duplicate.
 */
export const afterDocumentTrash = [
	ACTIVE_PAGES,
	TRASHED_PAGES,
	FULL_PAGE_COLLECTIONS,
	PUBLISHED_DOCUMENTS,
	HOME_FALLBACK,
];

// Rows cannot enter the workspace tree or collection picker. Of the core-data
// lists, only the Published view includes them; the Trash and collection views
// use their own refresh events.
export const afterRowLifecycle = [ PUBLISHED_DOCUMENTS ];

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
