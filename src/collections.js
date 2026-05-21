// General collection query for internal lookups: row parents, breadcrumbs,
// and relation targets. It includes inline collections because rows and
// relations may still point at them.
export const COLLECTION_QUERY = {
	per_page: 100,
	context: 'edit',
	status: [ 'draft', 'private', 'publish' ],
};

// Workspace-facing collection query. The sidebar and DataView picker use this
// to show only full-page collections. Collections created before mode existed
// count as `full_page` on the server.
export const FULL_PAGE_COLLECTION_QUERY = {
	...COLLECTION_QUERY,
	workspace_mode: 'full_page',
};

// Used by the Published documents screen. Includes inline collections because
// publishing an inline collection still exposes its rows via REST.
export const PUBLISHED_COLLECTIONS_QUERY = {
	...COLLECTION_QUERY,
	status: 'publish',
};
