import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE as PAGE_POST_TYPE,
	TRASHED_PAGES_QUERY,
} from '../components/page-queries';
import { FULL_PAGE_COLLECTION_QUERY } from '../collections';

/**
 * Named invalidation packs. Each pack is a list of `[selector, args]` tuples
 * for `core-data`'s `invalidateResolution` dispatcher.
 *
 * Descriptors name the pack they need instead of repeating cache keys inline.
 */

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
	[ 'postType', 'crtxt_collection', FULL_PAGE_COLLECTION_QUERY ],
];

// Duplicating a collection registers a fresh row CPT. Refresh `/wp/v2/types`
// so row lookups can resolve the new post type.
const ENTITIES_CONFIG = [ 'getEntitiesConfig', [ 'postType' ] ];

export const afterPageTrash = [
	ACTIVE_PAGES,
	TRASHED_PAGES,
	// Page trash cascades into inline-owned and nested full-page collections,
	// so the full-page list has to refresh too.
	FULL_PAGE_COLLECTIONS,
];

export const afterCollectionTrash = [ FULL_PAGE_COLLECTIONS ];

export const afterCollectionDuplicate = [
	FULL_PAGE_COLLECTIONS,
	ENTITIES_CONFIG,
];

/**
 * Apply an invalidation pack with `invalidateResolution`.
 *
 * @param {Function}     dispatcher `invalidateResolution` from `useDispatch( 'core' )`.
 * @param {Array<Array>} pack       Named pack from this file (e.g. `afterPageTrash`).
 */
export function applyInvalidationPack( dispatcher, pack ) {
	if ( ! dispatcher || ! Array.isArray( pack ) ) {
		return;
	}
	pack.forEach( ( [ selector, args ] ) => {
		dispatcher( selector, args );
	} );
}
