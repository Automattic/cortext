/**
 * Shared query constants for the page lists in the sidebar. Pages live in the
 * unified `crtxt_document` post type and are distinguished from rows and
 * collections by carrying neither a `crtxt_trait` term (rows) nor a
 * `cortext_fields` meta (collections). `cortext_no_trait` and
 * `cortext_no_collections` are the REST filters that enforce both
 * exclusions. The same query objects feed the active list and the Trash
 * section, and are passed to `invalidateResolution` after lifecycle actions
 * so the entries deep-match the resolved selector args.
 */

export const POST_TYPE = 'crtxt_document';

export const ACTIVE_PAGES_QUERY = {
	per_page: 100,
	status: [ 'draft', 'private', 'publish' ],
	context: 'edit',
	cortext_no_trait: 1,
	cortext_no_collections: 1,
};

export const TRASHED_PAGES_QUERY = {
	per_page: 100,
	status: 'trash',
	context: 'edit',
	cortext_no_trait: 1,
	cortext_no_collections: 1,
};

// Used by the Published documents screen. Same shape as ACTIVE_PAGES_QUERY so
// it deep-matches alongside it for invalidation when a page is published or
// unpublished.
export const PUBLISHED_PAGES_QUERY = {
	per_page: 100,
	status: 'publish',
	context: 'edit',
	cortext_no_trait: 1,
	cortext_no_collections: 1,
};
