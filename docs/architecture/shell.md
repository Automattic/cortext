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

## Data fetching: prefer existing bulk reads

The shell already keeps a few bulk queries warm: active pages and collections from the sidebar, plus the open collection's fields from `CollectionFieldsProvider`. When a component needs one of those records, read it from the bulk instead of calling `useEntityRecord` by id.

WordPress core-data tracks bulk and per-id resolvers separately ([gutenberg#19153](https://github.com/WordPress/gutenberg/issues/19153)), so a per-id read can make another HTTP request even when the record is already in the bulk cache. The duplicate request grows with surfaces that render one cell per record, like a wide column header.

Current helpers:

- `useActivePages()` and `useCollections()` in `src/hooks/useEntityBulks.js` return the array plus a `get(id)` lookup against the shared query.
- `useMappedField(recordId)` in `src/components/CollectionFieldsContext.js` returns the parsed field record from the active collection.
- Use `useEntityRecord` only for entities that are not covered by any bulk (rows inside a collection, media attachments) and for write paths (`editEntityRecord`/`saveEditedEntityRecord` still go through core-data).

The helpers do not fetch missing records. They return `null`, plus `hasResolved`, and the caller decides what to show. Because the bulk queries stop at `per_page: 100`, a record opened from a direct URL or a recent item may not be in the list. If the UI still needs to render that record, wait for `hasResolved`, then fall back to a targeted `useEntityRecord`; `useBreadcrumbSegments` uses that pattern.

## Current scope

The shell supports pages, collections, embedded collection views, row details, relations, rollups, and basic public rendering for pages. Several editor edges are still prototype-quality, especially layout fidelity, concurrent editing, and bulk actions.
