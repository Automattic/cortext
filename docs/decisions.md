# Design decisions

Running log of significant design decisions. Newest first. Each entry captures *why* so future readers can evaluate whether the constraints still hold.

## 2026-04-23 — Page URLs are id-based, slug is cosmetic

**Decision.** Page URLs encode the post id as the authoritative identifier: `?page=cortext&p=/<slug>-<id>` (e.g. `?p=/about-us-42`), falling back to `?p=/<id>` when the slug is empty. `src/router/useResolveEntity.js` extracts the trailing digits via `parseIdFromUri` and fetches `GET /wp/v2/crtxt_pages/<id>?context=edit`. The slug prefix is cosmetic. When autosave assigns a real slug, `Sidebar` rewrites the URL via `history.replace` so the visible URL reflects the latest title.

**Why.** The previous URL shape was a hierarchical slug path (`?p=/about-us/team`) resolved by walking one segment at a time through the REST collection endpoint. That works for titled pages but fails in two ways the shell hit in practice:

- Fresh drafts have an empty `post_name`, so the segment walker cannot address them. Creating a new page could not open it.
- Core never regenerates `post_name` from `post_title` after the first committed slug, so renames leave the URL stuck on the original slug (see next entry).

Id-based URLs sidestep both issues. The id is stable from creation, renames cannot break URLs, and cold-path resolution is one round-trip instead of N.

**Trade-off.** URLs lose the "glance and know the page" property of slug paths. For a `public: false` admin workspace this is cosmetic: URLs are not shared externally, and the sidebar carries the hierarchy view. If Cortext ever exposes pages at public URLs, a slug-path resolver can be layered on top; the id remains in the URL as a fallback identifier.

**Revisit when.** Cortext publishes pages at public URLs and wants SEO-friendly paths, or the URL shape becomes user-visible in a context (export, share link, breadcrumb display) where readability matters more than stability.

## 2026-04-23 — New pages use `draft` status; slug is generated on first rename

**Decision.** The "New page" action creates a post with `status: 'draft'` and no title. The first rename (or the first autosaved title change) promotes status to `private` via `Sidebar::renamePage` or `useAutosave::maybePromoteStatus`. Core runs `wp_unique_post_slug(sanitize_title(title))` on that transition and stores the result as `post_name`.

**Why.** Core regenerates `post_name` from `post_title` only on the transition out of `draft`, `pending`, or `auto-draft`, and only when `post_name` is empty. The previous code created pages as `private` with a placeholder title (`Untitled`), which committed `post_name: 'untitled'` at creation. Since core never regenerates after that point, every page's URL was stuck on `untitled` forever. Deferring slug assignment until there is a real title gets slug generation, uniqueness, and localization for free from core.

`draft` rather than `auto-draft` because `auto-draft` is registered as an internal status and excluded from the REST schema's `status` enum; `POST /wp/v2/crtxt_pages` with `status: 'auto-draft'` returns 400. `draft` has identical slug-regeneration behavior and is REST-valid. `draft` is also not subject to `wp_scheduled_auto_draft_delete`'s 7-day GC, so abandoned blank pages stay until explicitly deleted.

**Trade-off.** Pages already in the database with `post_name: 'untitled'` from before this change keep that slug. Renaming them does not regenerate it because at rename time they are `private`, not `draft`, so the status-gated promotion does not fire. No migration is planned; id-based URLs (previous entry) mean the stale slug no longer breaks navigation.

**Revisit when.** Legacy `untitled`-slugged pages surface in a user-visible context where their slug matters (export, share link, breadcrumb), or product decides to hide abandoned blank drafts from the sidebar.

## 2026-04-23 — Core admin is an escape hatch, not the primary UI

**Decision.** `crtxt_page` registers with `show_ui => true` and `show_in_menu => false`. `Admin\Screen` adds a "Manage Pages" submenu under the Cortext top-level that links to `edit.php?post_type=crtxt_page`. The React shell remains the primary editing surface.

**Why.** The shell is what users should reach for, but bulk operations (trash many, change status, reassign parent) are features core gives us for free and the shell doesn't have yet. Keeping core's list table + `post.php` editor reachable avoids dropping to `wp-cli` when the shell doesn't cover a chore. `show_in_menu => false` keeps the CPT from cluttering the top-level admin menu; `Admin\Screen` owns visibility.

**Trade-off.** There are now two editing UIs for the same rows. Core's `post.php` editor loads without `window.cortextEditorSettings` and without the shell's autosave wiring, so editing behavior diverges between the two. Users who drop to core admin get the default WordPress experience, not Cortext's. Bulk actions that bypass the shell's hooks can still violate shell-side invariants if any are added later.

**Revisit when.** The shell grows bulk-action affordances that cover the admin use cases, or the divergence between shell and core edits becomes a support problem. At that point flip `show_ui => false` and drop the submenu.

## 2026-04-23 — `crtxt_page` uses core post capabilities

**Decision.** `crtxt_page` is registered with `capability_type => 'post'` and `map_meta_cap => true`. Caps map to `edit_posts` / `edit_others_posts` / `publish_posts` / etc.

**Why.** The Cortext admin shell is gated on `edit_posts` in `Cortext\Admin\Screen::register_menu` (`includes/Admin/Screen.php`). Aligning the CPT with the same capability set means the shell and the REST endpoints share a single authorization surface, with zero activation-time plumbing. Capability mappings are derived at runtime — not stored in `wp_posts` — so the decision is reversible without a data migration.

**Trade-off.** A future workspace-member role model (e.g. `edit_crtxt_pages`, workspace-scoped sharing) will require:

- An activation hook to grant the new caps to administrator and editor roles.
- A `map_meta_cap` filter to derive meta caps from primitive caps.
- Updating the admin menu cap in `Screen::register_menu`.

None of this requires touching existing post rows.

**Revisit when.** Cortext needs role-based sharing of workspace pages that diverges from WordPress's post-editor permission model — e.g. a "workspace viewer" role that can read but not edit, or per-page ACLs that don't fit the post-author model.
