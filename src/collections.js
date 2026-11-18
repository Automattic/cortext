export const DOCUMENT_POST_TYPE = 'crtxt_document';

// core-data refetches this list after every document save, so it asks only for
// what its consumers read. Records come back with these fields and nothing
// else, even when the store holds more: add a field here before reading it.
// Keep entries top-level (`meta`, not `meta.some_key`), because core-data
// merges list records into the store one top-level key at a time.
const COLLECTION_FIELDS = [
	'id',
	'parent',
	'slug',
	'title',
	'meta',
	'cortext_defines_trait',
	'crtxt_trait',
];

export const COLLECTION_QUERY = {
	per_page: 100,
	context: 'edit',
	status: [ 'draft', 'private', 'publish' ],
	cortext_collections: 1,
	_fields: COLLECTION_FIELDS.join( ',' ),
};

export const FULL_PAGE_COLLECTION_QUERY = COLLECTION_QUERY;

/**
 * Query for collection pickers. Searches on the server so collections past
 * the first page stay reachable, and asks only for `id` and `title`: `meta`
 * is what makes the shared collections list expensive to refetch. A search
 * matches titles only, because every collection's content holds block markup
 * that would match words like "view" or "data".
 *
 * @param {string} search Search term; empty lists the first page.
 * @return {Object} REST query for `getEntityRecords`.
 */
export function collectionSearchQuery( search ) {
	const query = { ...COLLECTION_QUERY, _fields: 'id,title' };
	if ( search ) {
		query.search = search;
		query.search_columns = [ 'post_title' ];
	}
	return query;
}
