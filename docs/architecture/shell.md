# Shell architecture

Cortext runs as a React app inside wp-admin. The shell is full-screen, but it still uses WordPress authentication, permissions, REST nonces, editor settings, core-data for loading and saving WordPress records, and block assets.

## Server entry

`Cortext\Admin\Screen` registers the Cortext admin page, prints the React mount point, loads the built assets, and adds the full-screen body class. Document editing stays in that shell; Cortext does not expose core's Documents list table or `post.php` editor for `crtxt_document`.

The plugin bootstraps editor settings on the server and exposes them to the client. That lets Cortext mount the block editor without recreating the editor environment from scratch.

## Client shell

The client entry is `src/index.js`. Routing is handled in the React app, while the browser stays on the Cortext wp-admin page.

The shell has one work surface: every routed entity is a `crtxt_document`, rendered through a block editor canvas. Pages are documents without a schema, collections are documents whose body is the locked `cortext/data-view` block, and rows open as documents too (full page) or as a side peek (inside their parent collection's view).

The sidebar handles page navigation and nesting. Autosave is split between a client debounce and a small server-side revision throttle.

## Data fetching: reuse queried records by id

Several surfaces already keep running queries: the sidebar fetches active pages and collections, and `CollectionFieldsProvider` fetches the open collection's fields. When another component needs one of those records by id, it should reuse the query rather than call `useEntityRecord` on its own.

WordPress core-data tracks per-id and queried resolvers as different things ([gutenberg#19153](https://github.com/WordPress/gutenberg/issues/19153)). A per-id read can still hit the network even when the record sits in the queried-data cache, and that duplicate scales with the number of cells the UI renders.

Three helpers cover it:

- `usePooledEntityRecord( kind, name, query, id )` in `src/hooks/usePooledEntityRecord.js` returns `{ hasResolved, record }`. It reads from the queried-data cache and only falls back to `useEntityRecord` once the query has resolved without that id.
- `useMappedField( recordId )` in `src/components/CollectionFieldsContext.js` returns the parsed field record from the active collection's query.
- `useEntityRecord` is still the right call for entities outside any active query (rows inside a collection, media attachments) and for writes.

Queries cap at `per_page: 100`. A record opened by direct URL or recent-item link can sit outside that window; the fallback inside `usePooledEntityRecord` covers it without firing on the common path.

## Current scope

The shell supports pages, collections, embedded collection views, row details, relations, rollups, and basic public rendering for pages. Several editor edges are still prototype-quality, especially layout fidelity, concurrent editing, and bulk actions.
