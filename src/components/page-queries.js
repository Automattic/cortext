/**
 * Shared query constants for the `crtxt_page` lists in the sidebar. Both the
 * active list and the Trash section use these objects, and the same identity
 * is passed to `invalidateResolution` after lifecycle actions so the entries
 * deep-match the resolved selector args.
 */

export const POST_TYPE = 'crtxt_page';

export const ACTIVE_PAGES_QUERY = {
	per_page: 100,
	status: [ 'draft', 'private', 'publish' ],
	context: 'edit',
};

export const TRASHED_PAGES_QUERY = {
	per_page: 100,
	status: 'trash',
	context: 'edit',
};

// Used by the Published documents screen. Same shape as ACTIVE_PAGES_QUERY so
// it deep-matches alongside it for invalidation when a page is published or
// unpublished.
export const PUBLISHED_PAGES_QUERY = {
	per_page: 100,
	status: 'publish',
	context: 'edit',
};
