# Universal document model

Cortext moves from dynamic CPTs per collection (Option A in
`decision-content-model`) to a single `crtxt_document` CPT for all editable
content, classified by `crtxt_trait` posts via a custom taxonomy. Users see
"collections"; internally these are traits: schema records that documents
can be assigned to.

This document supersedes the previous decision recorded in
`decision-content-model`. That rejection of Option B rested on assumptions
that did not match the as-built code or Cortext's vision.

## Context

Cortext is in alpha. Data is reseed-able. There is no migration cost. UX can
change. This document recommends adopting the cleanest model from day one
rather than evolving the current architecture.

Three things triggered the revisit:

1. Boot cost of dynamically registering N CPTs per request scales linearly
   with the number of collections. Original analysis underestimated it.
2. The performance work on `cortext_field_values` is independent of the
   storage choice and carries the performance argument either way.
3. WordPress core's content-types experiment (Gutenberg issue 77600) is
   wrestling with the same problems Cortext already has. The long-term
   direction acknowledged by core maintainers is dedicated tables for
   definitions, not the current `wp_posts` plus dynamic CPT approach.

## Hard requirement: document bodies stay in `wp_posts`

Cortext documents are not field bags. They are editable Gutenberg documents
with `post_content`. Moving document bodies out of `wp_posts` would lose:

- Block editor integration.
- Revisions and autosaves.
- REST conventions consumed by the shell.
- Search, sitemap, Heartbeat, locks.
- Block bindings and the entity-records cache.

This is the single non-negotiable constraint. The universal model keeps
document bodies in `wp_posts`. HPOS-style dedicated tables for document
bodies are out of scope.

## Storage is layered, not monolithic

A document is not a single object in one place. It is four layers with
distinct backends, and the "custom tables vs core tables" question applies
per layer:

| Layer | Backend | Constraint |
|---|---|---|
| Body | `wp_posts.post_content` and title, status, dates | Locked by editor requirement |
| Identity | `wp_posts.post_type = crtxt_document` | Single type for all documents |
| Trait membership | Taxonomy `crtxt_trait_member` | Each trait has a mirror term |
| Properties | `wp_postmeta` (`field-X`) + `cortext_field_values` sidecar | Already split storage |

Cortext already runs the "core tables for what the ecosystem requires, custom
tables for what needs performance" pattern. The sidecar is a dedicated table
for the properties slice. The universal-document model keeps that split,
collapses many post types into one, and uses native taxonomy for membership.

## The model

### Three CPTs

```
crtxt_document    Single CPT for all editable content
                  (pages, rows, collections-as-documents)
                  Has post_content for Gutenberg editing
                  Has post_parent for hierarchy when applicable

crtxt_trait       CPT for trait definitions (UX label: "collection")
                  Stores schema (cortext_fields meta), icon, color, settings
                  Lifecycle: create, rename, delete

crtxt_field       CPT for field definitions
                  Stores type, settings, validation
                  Reusable across traits
```

### Vocabulary: trait vs collection

These two words refer to **different concepts** even though the UX collapses
them. Keep the distinction in mind when reading or modifying code:

- **Trait**: the characteristic. A first-class entity that defines a schema
  (a name, a list of fields, an icon, a color, settings). Stored as a
  `crtxt_trait` post; identified by the post id. Each trait has a stable
  mirror term in the `crtxt_trait_member` taxonomy (slug `c-{trait_id}`) so
  the membership check is a native `tax_query` instead of a postmeta scan.
- **Collection**: the emergent grouping. The set of documents that carry a
  given trait term. Not a stored entity; it is the result of querying
  `crtxt_document` filtered by trait membership. When the product UI says
  "create a collection People", what is created is a trait definition; the
  "collection" is what the user sees when they look at all the documents
  with that trait.

Concretely:

| User sees | Backend operation |
|---|---|
| "Create a collection People" | `wp_insert_post({post_type: 'crtxt_trait', post_title: 'People', ...})` plus mirror term insert |
| "Add a row to People" | `wp_insert_post({post_type: 'crtxt_document', ...})` plus `wp_set_object_terms($id, [$people_term_id], 'crtxt_trait_member')` |
| "Create a page" | `wp_insert_post({post_type: 'crtxt_document', ...})` without trait assignment |
| "Tag this with another collection" (future) | Add an additional `crtxt_trait_member` term |

Because the trait is the definition and the collection is the derived view,
"a row belongs to 2 collections" really means "this `crtxt_document` carries
2 `crtxt_trait_member` terms". The data model already supports multi-trait
membership without schema changes; no `cortext_supertag` post type is needed.

Practical naming consequences:

- PHP class: `Cortext\PostType\TraitPostType` (the word `trait` is a PHP
  reserved keyword, so the class cannot be `Trait`). All other code uses
  `crtxt_trait` directly.
- Taxonomy: `crtxt_trait_member`. The `_member` suffix is a slug
  disambiguator vs the post type, not part of the semantic. Each term in
  this taxonomy represents one trait being applied to a document.
- Why not "schema"? Schema is technically accurate but reads as
  database/JSON terminology and obscures the user-facing "characteristic"
  metaphor. "Trait" keeps the link to "this row has the Person trait"
  (multi-classification reads naturally) without sounding programmery.

### What is a "kind" then

The `DocumentKind` interface in `includes/Documents/` becomes a viewModel
derived from document state, not a category stored on the document:

- A document with `crtxt_trait_member` assignment renders in DataView for
  that trait (what was `RowKind`).
- A document without trait membership, with `post_parent` or with children,
  renders in sidebar tree (what was `PageKind`).
- A `crtxt_trait` post renders as collection configuration (what was
  `CollectionKind`).

Roles are derived from structure. There is no `_cortext_kind` meta.

### Trait term sync

When a `crtxt_trait` post is created, a mirror term is inserted in
`crtxt_trait_member`. With deterministic slug `c-{$trait_id}` and name
derived from the trait title or simply `Trait {$id}`, the sync is minimal:

- Create trait → insert term.
- Delete trait → delete term.
- Rename trait → optional update to term name (slug is stable, derived from
  ID, never changes).

Estimated total sync code: about 30 to 50 lines plus tests.

## Analysis dimensions

### Performance

Costs per request, with N as the number of traits.

| Dimension | Old (dynamic CPTs) | New (universal + trait) |
|---|---|---|
| Boot / init | O(N) | O(1) |
| Memory in `$wp_post_types` | O(N) | O(1) |
| REST route registration per REST request | O(N) | O(1) |
| List "documents in trait X" | `WHERE post_type = X` ~1-2 ms | tax_query ~2-4 ms |
| Filter with sidecar | Same ~1 ms | Same ~1 ms |
| Filter without sidecar | post_type + postmeta join ~5-15 ms | tax + postmeta join ~7-18 ms |
| Multi-membership query | Impossible | Native via `tax_query` AND |
| Cross-trait queries | `post_type__in` | `tax_query` IN |
| Insert document | 1 post + N meta | 1 post + 1 term rel + N meta (+0.5 ms) |
| Rename collection | Risk of CPT slug collision | term name update |
| Create collection | `register_post_type` on next init | term insert + trait post insert |

The new model adds about 1-3 ms per individual simple query through the
taxonomy join. It removes 15-50 ms of boot overhead per request at scale
(50-200 collections). Boot runs on every request; queries do not. Aggregate
is favorable for any workspace with more than ~10 collections.

Sidecar `cortext_field_values` has `collection_id` as a primary column on
its secondary indexes. The PRIMARY KEY is `(row_id, field_id, value_seq)`.
No schema changes are required.

### Why taxonomy and not post_meta for trait membership

Considered both. Taxonomy chosen because:

| Query | tax_query | post_meta | Delta |
|---|---|---|---|
| Documents in trait X | ~2-4 ms | ~10-30 ms | 3-10x |
| Documents in trait A AND B | ~5-10 ms | ~30-80 ms | 5-10x |

`wp_term_relationships` has an indexed `term_taxonomy_id` column. Lookups
are direct. `wp_postmeta` has no compound index on `(meta_key, meta_value)`;
MySQL filters by `meta_key` then scans `meta_value` for matches.

With sidecar in the path, both approaches converge because the sidecar's
own `collection_id` index serves the read. Without sidecar, taxonomy wins
clearly.

Multi-trait queries are dramatically better with `tax_query` than with
`meta_query`. Even though multi-trait UX is deferred, the infrastructure
choice locks in for the future.

### WordPress naturalness

Both the current and proposed models step outside the strictest WP grain.
Honest naming:

- Current model breaks "post_types declared in code". Dynamic CPTs are
  registered from user data on every init.
- New model breaks "one CPT per kind". One CPT for many logical document
  shapes.

Precedents that argue the new shape is more idiomatic:

- WooCommerce: one `product` CPT plus `product_type` taxonomy. No CPT per product type.
- bbPress: fixed kinds (forum, topic, reply). No CPT per forum.
- BuddyPress, EDD, FormidableForms: "one entity plus classification" pattern.

The "feels anti-WP" intuition about a universal CPT is aesthetic. WordPress
was not designed for CPTs derived from runtime data; classifying with
taxonomies is the canonical pattern.

### Permissions

Cortext has no per-collection permissions today. Every gate is `edit_posts`
or `edit_post` (verified across `RowsController`, `Documents.php`,
`FieldsController`, `WorkspaceHomeController`, `RecentsController`,
`FavoritesController`, `DocumentsController`).

When granular caps are needed, the canonical approach is:

1. Caps keyed by stable `term_id` of the trait.
2. Lifecycle hooks: `created_crtxt_trait_member` adds caps; `delete_crtxt_trait_member` removes them.
3. `map_meta_cap` filter to translate `edit_post`, `read_post`, `delete_post`
   on a document to the corresponding trait cap.

The same code that exists in the WordPress ecosystem for taxonomy-based
permissions (WooCommerce, BuddyPress, bbPress) applies here.

### Compatibility with WordPress core (Gutenberg 77600)

State of core work:

- Phase 1 (current): basic management of CPTs and taxonomies from admin.
  Definitions stored as posts in a private `wp_user_post_type` CPT with
  JSON config blob.
- Long-term direction: dedicated table for definitions (acknowledged by
  maintainers in the issue thread).

Cortext's `crtxt_trait` is structured (post_meta `cortext_fields`) and
closer to where core is heading than core's current implementation.

The discussion of "dedicated table" in the issue refers to storage of
content type definitions, not their items. Items live in `wp_posts` in
core regardless. Cortext's universal model is consistent with that: one
type, classified by taxonomy.

### Why not HPOS-style dedicated tables for document bodies

Hard requirement above. Documents are Gutenberg-edited and must stay in
`wp_posts`.

Also: HPOS took WooCommerce years of dedicated work. Disproportionate to
Cortext's scope. And WooCommerce orders are not Gutenberg-edited, so HPOS
could move the body out of `wp_posts`. Cortext cannot.

### Why not mimic dynamic CPTs as a compatibility layer

Considered as a backwards-compat layer for plugins expecting dynamic CPTs.
Rejected:

- WP filter coverage is incomplete; direct SQL bypasses any virtual CPT layer.
- Recreates the boot cost the migration was meant to eliminate.
- No identified consumer requires dynamic CPTs visible from outside Cortext.
  Collection slugs are user data and unknowable to external plugins at
  code time.

### What about custom tables for membership and schemas

Considered. Rejected for now:

- Membership: taxonomy `crtxt_trait_member` performs at par with custom
  table for the queries Cortext needs, with WP's native cache, REST, and
  CLI integration. Custom table would add a structural DDL requirement.
- Schemas: `cortext_fields` array meta on each trait post is sufficient
  and aligns with `crtxt_collection`'s current approach.

If future workloads justify it, a custom table can be added as an
optional sidecar (the same pattern as `cortext_field_values`). Not required
at design time.

## Implementation plan

Since Cortext is in alpha and data is reseed-able, this is not a migration
of existing data. Phases focus on rewiring code, not preserving data.

### Phase 0: design freeze

Lock decisions on:

- Final names: `crtxt_document`, `crtxt_trait`, `crtxt_trait_member`,
  `crtxt_field`.
- UX vocabulary: "collection" for trait, "document" for document.
- Single-trait per document in v1 (multi-trait UX deferred).
- Mirror term shape: slug `c-{$trait_id}`, name `Trait {$id}` or derived.
- Sidebar tree semantics: documents without trait membership and with
  `post_parent` or children render as pages.

### Phase 1: register new CPTs and taxonomy

- Register `crtxt_document` (single CPT, hierarchical via `post_parent`).
- Register `crtxt_trait` (collection definitions).
- Register `crtxt_trait_member` taxonomy (non-hierarchical, internal).
- Implement mirror term sync hooks (~30-50 lines).
- Tests for sync.

### Phase 2: implement writes via new model

- All new document creation goes through `crtxt_document`.
- All new trait creation goes through `crtxt_trait` with mirror term sync.
- Field values storage remains postmeta + sidecar (unchanged).
- Document creation in a trait assigns the mirror term.

### Phase 3: rewire reads

- `RowsController`, `RowsFilterQuery`, `RowsMetaQuery`, `RowsQueryScope`
  filter by `tax_query` on `crtxt_trait_member` instead of `post_type`
  filter on dynamic CPTs.
- Sidebar tree queries `crtxt_document` without trait membership and with
  `post_parent` for hierarchy.
- DataView queries `crtxt_document` filtered by the current trait's term.
- REST identity: `/cortext/v1/traits/{slug}/documents` or `/cortext/v1/documents?trait={slug}`.
- Search continues via `RowsFilterQuery::compile_search`, updated to use
  `tax_query` for collection scope.

### Phase 4: rewire DocumentKind

- `PageKind`, `RowKind`, `CollectionKind` become viewModels derived from
  document state.
- `KindRegistry::by_post_type` becomes `KindRegistry::for_document` and
  inspects state (trait membership, post_parent presence, post_type).

### Phase 5: remove legacy code

- Delete `includes/PostType/CollectionEntries.php`.
- Delete `includes/PostType/Page.php` (subsumed by document).
- Rename `includes/PostType/Collection.php` to `Trait_.php` (or `TraitPostType.php`).
- Remove `Relations::entry_post_type_for_collection` and similar glue.
- Remove `$collection_id_by_post_type` cache from the sidecar.
- Remove the 20-character CPT slug limit handling code.

### Phase 6: reseed and validate

- Drop existing alpha data.
- Reseed with the new model via updated `wp cortext seed-dummy-collections`.
- Run `wp cortext perf-bench` to validate.

Scope estimate: 4-6 weeks of focused effort. No data migration accelerates
this versus the originally drafted 6-phase migration plan.

## Risks

- **Hierarchy and trait membership coexistence.** A document can have both
  `post_parent` and trait membership. Sidebar semantics for those need
  Phase 0 decision.
- **Multi-trait UX timing.** Exposing multi-trait too early confuses users.
  Keep v1 strictly single-trait.
- **Field collisions on multi-trait.** Deferred but not eliminated. When
  multi-trait UX is exposed, two traits with a field named "Email" need
  resolution by name prefixing or convention.
- **Sync hook drift.** Minimal with deterministic slug, but possible if
  someone inserts a `crtxt_trait` via SQL directly. Audit CLI catches it.
- **Search degradation without sidecar.** Custom search via `RowsFilterQuery`
  works the same in both models, with one extra join. Verified manageable.
- **Renaming concepts in code.** Cortext currently has `Collection`, `CollectionKind`,
  etc. Renaming to `Trait` touches several files. In alpha, this is one-time
  refactor work.

## Critical files

### To create

- `includes/PostType/Document.php` (registration of `crtxt_document`)
- `includes/PostType/Trait_.php` or `TraitPostType.php` (registration of `crtxt_trait`)
- `includes/Taxonomy/TraitMember.php` (registration plus sync hooks)

### To modify substantially

- `includes/FieldValues/FieldValueIndex.php` (remove post_type derivations,
  use term-based collection resolution; schema unchanged)
- `includes/Relations.php` (replace `entry_post_type_for_collection` with
  trait term lookup; meta_key and value normalization unchanged)
- `includes/Rest/RowsController.php` and `Rows*Query.php` (filter by tax_query)
- `includes/Documents/RowKind.php`, `PageKind.php`, `CollectionKind.php`
  (viewModel from state, not post_type ownership)
- `includes/Documents/KindRegistry.php` (state-based dispatch)
- `includes/PostType/Cascade/CollectionToRowTrashCascade.php` (cascade by trait)

### To remove

- `includes/PostType/CollectionEntries.php`
- `includes/PostType/Page.php`
- `includes/PostType/Collection.php` (becomes Trait_.php)
- `Relations::entry_post_type_for_collection` and related helpers
- `FieldValueIndex::$collection_id_by_post_type` cache

## Open questions

1. **Sidebar tree semantics** for documents with both `post_parent` and trait
   membership. Do they appear in the tree, in DataView, or both?
2. **REST identity**: `/cortext/v1/traits/{slug}/documents` versus
   `/cortext/v1/documents?trait={slug}`. The former is more readable; the
   latter is more flexible.
3. **`cortext_supertag` concept**: explicitly merged into `crtxt_trait` with
   role distinction, or kept separate for cross-cutting tags? Decision in
   Phase 0.
4. **Default mirror term name**: `Trait {$id}` for stability, or synced
   `crtxt_trait.post_title` for legibility in wp_terms (with rename hook)?
5. **Capability granularity**: design `map_meta_cap` shape now so future
   user-and-sharing feature drops in cleanly?

## Recommendation

Proceed with this model. Phase 0 first to lock the open questions, then
sequentially through phases 1-6. Total scope at focused effort: 4-6 weeks.

This document supersedes the rejection of Option B in
`mem:decision-content-model`. That rejection was based on assumptions that
did not match the as-built code or the direction of Cortext.
