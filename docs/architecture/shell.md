# Shell architecture

Cortext runs as a React app inside wp-admin. The shell is full-screen, but it still uses WordPress authentication, permissions, REST nonces, editor settings, core-data for loading and saving WordPress records, and block assets.

## Server entry

`Cortext\Admin\Screen` registers the Cortext admin page, prints the React mount point, loads the built assets, and applies a full-screen body class for this screen. It also keeps the core Pages list table reachable as an escape hatch for bulk operations the shell does not cover yet.

The plugin bootstraps editor settings on the server and exposes them to the client. That lets Cortext mount the block editor without recreating the editor environment from scratch.

## Client shell

The client entry is `src/index.js`. Routing is handled in the React app, while the browser stays on the Cortext wp-admin page.

The shell has two main work surfaces:

-   Page routes mount a block editor canvas for `crtxt_page` documents.
-   Collection routes mount DataViews-backed record views for rows.

The sidebar handles page navigation and nesting. Autosave is split between a client debounce and a small server-side revision throttle.

## Data fetching: read entities from the canonical bulks

The shell keeps a small set of canonical bulk queries alive while it runs: active pages and collections (mounted by the sidebar), and the fields of the open collection (mounted by `CollectionFieldsProvider`). Components that need a single entity covered by one of those bulks should read it from the bulk instead of calling `useEntityRecord` by id. WordPress core-data's per-id resolver does not share resolution state with the bulk resolver ([gutenberg#19153](https://github.com/WordPress/gutenberg/issues/19153)), so calling `useEntityRecord` for a record the bulk has already cached still fires a fresh HTTP request. That tax is invisible on a normal Apache server but becomes painful in the Cortext desktop build, where every request pays the PHP-WASM cost.

The shape of the convention:

- `useActivePages()` and `useCollections()` in `src/hooks/useEntityBulks.js` return the array plus a `get(id)` lookup against the canonical query.
- `useMappedField(recordId)` in `src/components/CollectionFieldsContext.js` returns the parsed field record from the active collection.
- Use `useEntityRecord` only for entities that are not covered by any bulk (rows inside a collection, media attachments) and for write paths (`editEntityRecord`/`saveEditedEntityRecord` still go through core-data).

There is no fallback fetch when a bulk does not contain the requested id; the lookup returns null and the caller decides how to render that. Trashed entities and the brief first-paint race produce empty UI in the affected surface, which is acceptable because those routes do not render content either.

## Current scope

The shell supports pages, collections, embedded collection views, row details, relations, rollups, and basic public rendering for pages. Several editor edges are still prototype-quality, especially layout fidelity, concurrent editing, and bulk actions.
