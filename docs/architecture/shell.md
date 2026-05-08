# Shell architecture

Cortext runs as a React app inside wp-admin. The shell is full-screen, but it
still uses WordPress authentication, permissions, REST nonces, editor settings,
and block assets.

## Server entry

`Cortext\Admin\Screen` registers the Cortext admin page, prints the React mount
point, loads the built assets, and applies a full-screen body class for this
screen. It also keeps the core Pages list table reachable as an escape hatch for
bulk operations the shell does not cover yet.

The plugin bootstraps editor settings on the server and exposes them to the
client. That lets Cortext mount Gutenberg without recreating the editor
environment from scratch.

## Client shell

The client entry is `src/index.js`. Routing is handled in the React app, while
the browser stays on the Cortext wp-admin page.

The shell has two main work surfaces:

-   Page routes mount a Gutenberg editor canvas for `crtxt_page` documents.
-   Collection routes mount DataViews-backed record views for rows.

The sidebar handles page navigation and nesting. Autosave is split between a
client debounce and a small server-side revision throttle.

## Current scope

The shell supports pages, collections, embedded collection views, row details,
relations, rollups, and basic public rendering for pages. Several editor edges
are still prototype-quality, especially layout fidelity, concurrent editing, and
bulk actions.
