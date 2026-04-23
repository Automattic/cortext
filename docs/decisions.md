# Design decisions

Running log of significant design decisions. Newest first. Each entry captures *why* so future readers can evaluate whether the constraints still hold.

## 2026-04-23 — `cortext_page` uses core post capabilities

**Decision.** `cortext_page` is registered with `capability_type => 'post'` and `map_meta_cap => true`. Caps map to `edit_posts` / `edit_others_posts` / `publish_posts` / etc.

**Why.** The Cortext admin shell is gated on `edit_posts` in `Cortext\Admin\Screen::register_menu` (`includes/Admin/Screen.php`). Aligning the CPT with the same capability set means the shell and the REST endpoints share a single authorization surface, with zero activation-time plumbing. Capability mappings are derived at runtime — not stored in `wp_posts` — so the decision is reversible without a data migration.

**Trade-off.** A future workspace-member role model (e.g. `edit_cortext_pages`, workspace-scoped sharing) will require:

- An activation hook to grant the new caps to administrator and editor roles.
- A `map_meta_cap` filter to derive meta caps from primitive caps.
- Updating the admin menu cap in `Screen::register_menu`.

None of this requires touching existing post rows.

**Revisit when.** Cortext needs role-based sharing of workspace pages that diverges from WordPress's post-editor permission model — e.g. a "workspace viewer" role that can read but not edit, or per-page ACLs that don't fit the post-author model.
