/**
 * Shared query constants for the sidebar document tree. Pages, collections, and
 * rows all live in the unified `crtxt_document` post type. The workspace tree
 * shows everything that is not a row (pages and collections), so the active
 * query excludes only rows via `cortext_no_trait`. Page vs collection is
 * derived per-record from whether the document defines a trait
 * (`cortext_defines_trait`), so one query feeds the whole tree. The same query
 * objects are passed to `invalidateResolution` after lifecycle actions so the
 * entries deep-match the resolved selector args.
 */

export const POST_TYPE = 'crtxt_document';

export const ACTIVE_PAGES_QUERY = {
	per_page: 100,
	status: [ 'draft', 'private', 'publish' ],
	context: 'edit',
	cortext_no_trait: 1,
};

export const TRASHED_PAGES_QUERY = {
	per_page: 100,
	status: 'trash',
	context: 'edit',
	cortext_no_trait: 1,
	cortext_no_collections: 1,
};

// The Published documents screen needs every published document, including
// collection items, so leave trait and collection filters off.
export const PUBLISHED_DOCUMENTS_QUERY = {
	per_page: 100,
	status: 'publish',
	context: 'edit',
};

// Only the first root document is needed as a home fallback when no explicit
// home is set. Keep this query shared with lifecycle invalidation so removing
// or restoring the first document cannot leave the command palette stale.
export const HOME_FALLBACK_QUERY = {
	parent: 0,
	per_page: 1,
	status: [ 'draft', 'private', 'publish' ],
	context: 'edit',
	cortext_no_trait: 1,
	cortext_tree_order: 1,
	orderby: 'menu_order',
	order: 'asc',
};
