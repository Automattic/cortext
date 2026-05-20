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

## Data fetching: reuse queried records by id

The shell already keeps a few queries warm: active pages and collections from the sidebar, plus the open collection's fields from `CollectionFieldsProvider`. When a component needs a single record that one of those queries already covers, it should read it through the shared query instead of calling `useEntityRecord` by id.

WordPress core-data tracks per-id and queried resolvers separately ([gutenberg#19153](https://github.com/WordPress/gutenberg/issues/19153)), so a per-id read can still hit the network even when the record is already in the queried-data cache. The duplicate request grows with surfaces that render one cell per record, like a wide column header.

Current helpers:

- `usePooledEntityRecord( kind, name, query, id )` in `src/hooks/usePooledEntityRecord.js` returns `{ hasResolved, record }`. It reads the record from the queried-data cache when the id is part of `query`, and only falls back to a targeted `useEntityRecord` once the query has resolved without that id.
- `useMappedField( recordId )` in `src/components/CollectionFieldsContext.js` returns the parsed field record from the active collection's query.
- Use `useEntityRecord` directly for entities no query covers (rows inside a collection, media attachments) and for write paths (`editEntityRecord` / `saveEditedEntityRecord` still go through core-data).

Queries stop at `per_page: 100`, so a record opened from a direct URL or a recent item can fall outside the list. The fallback inside `usePooledEntityRecord` covers that case without firing during the common path.

## Current scope

The shell supports pages, collections, embedded collection views, row details, relations, rollups, and basic public rendering for pages. Several editor edges are still prototype-quality, especially layout fidelity, concurrent editing, and bulk actions.
