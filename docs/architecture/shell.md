# Shell architecture

The Cortext shell is a React SPA hosted on a full-screen wp-admin page. Running under `is_admin()` means REST nonces, user capabilities, and block asset defaults (`wp_should_load_separate_core_block_assets()` is false) are already in place, so the editor can be mounted without bespoke plumbing.

## Mount point (PHP)

`Cortext\Admin\Screen` in `includes/Admin/Screen.php` does four things:

1. Registers a top-level admin menu at `admin.php?page=cortext` with capability `edit_posts` and hook suffix `toplevel_page_cortext`.
2. Renders `<div id="cortext-root" class="cortext-root"></div>`.
3. Enqueues `build/index.js` using the asset manifest emitted by `@wordpress/scripts`, plus `wp-edit-blocks` and `wp-block-editor` styles for the canvas and the toolbar popover.
4. Adds the `cortext-fullscreen` body class on this screen only, which hides wp-admin chrome via CSS.

Editor settings are built server-side from `WP_Block_Editor_Context('core/edit-post')` via `get_block_editor_settings()`, then handed to the client as `window.cortextEditorSettings`. A smaller `window.cortextSettings` carries admin URL and menu slug.

`Cortext\Plugin::boot()` also registers `Cortext\Editor\RevisionThrottle`, which keeps autosave from flooding the revisions table under rapid edits.

## Client entry (React)

Entry is `src/index.js`; routing lives in `src/router/` using TanStack Router. Page URLs use the shape `?page=cortext&p=/<slug>-<id>`, falling back to `?p=/<id>` for slug-less drafts; only the trailing id is authoritative, and `useResolveEntity` fetches the record by id. The slug prefix is cosmetic and `Sidebar` rewrites it via `history.replace` when autosave lands a new slug, so renames never break existing URLs. The outer wp-admin URL is confined to `parseLocation` and `createHref` in `src/router.js`, so switching to a rewrite-rule URL later is plumbing rather than an architectural change. See [design decisions](../decisions.md) for why id-based URLs and why new pages start as `draft`.

`src/components/Canvas.js` renders a single page through `EditorProvider` with `useSubRegistry={ false }`. Keeping `core/editor` on the parent registry means stock editor components (`EditorAutosaveMonitor`, `PostLockedModal`, `EditorSnackbars`, `UnsavedChangesWarning`) can be dropped in directly if the shell wants them.

Inside `EditorProvider`, `@wordpress/interface`'s `InterfaceSkeleton` hosts:

- **Header**: a small save-status indicator and an inspector toggle.
- **Content**: `BlockCanvas` with `PostTitle` and a `BlockList` whose layout is currently hardcoded to `is-layout-constrained`. The `VisualCanvas` TODO spells out the known gap: template-derived layout (mirroring `editedPostTemplate` and `useLayoutClasses` against `core/post-content` attributes) is not wired up. Pages whose content uses flex or grid render centered in the editor while the front-end renders correctly. This matters before non-constrained layouts land.
- **Sidebar slot**: the block inspector lives in a `ComplementaryArea` scoped to `cortext`.

The pages tree in `src/components/Sidebar.js` uses `@dnd-kit` for drag-and-drop nesting.

## Autosave

`src/hooks/useAutosave.js` (client) and `includes/Editor/RevisionThrottle.php` (server) work as a pair. The client debounces dirty-state saves; the server throttles revision creation. `Canvas` reflects state via a `SaveStatus` component that renders one of `idle | saving | saved | error`.

`PostLockedModal` is not mounted yet. It is plug-and-play with the `useSubRegistry={ false }` setup if concurrent-edit handling is needed.

## Current scope

The canvas is wired to core `page` posts as a stand-in for `cortext_page` while the target data model lands. Collection CPTs and the supertag taxonomy are not registered yet. See [architecture.md](../architecture.md) for the intended storage sketch and [data-model.md](./data-model.md) for the REST contract.
