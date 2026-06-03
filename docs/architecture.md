# Architecture

Cortext is a WordPress plugin for building a knowledge base with documents, collections, and typed rows. This page gives the contributor-level picture. It is not a public API contract.

The short version: Cortext keeps its data in WordPress, then adds a focused admin shell on top.

## Storage

Cortext stores its data in WordPress posts and post meta. Pages, collections, and rows are all one post type, `crtxt_document`; a document's role comes from its state rather than from a dedicated type:

-   A document with no schema and no trait is a page. `post_parent` carries the workspace hierarchy.
-   A document with a `cortext_fields` schema is a collection. It mirrors itself as a term in the `crtxt_trait` taxonomy.
-   A document carrying a collection's `crtxt_trait` term is a row of that collection.
-   `crtxt_field` posts hold field definitions. Row values live in row post meta (`field-<id>`), with an optional `cortext_field_values` sidecar table for indexed filters and sorts.

One post type instead of a dynamic type per collection keeps per-request boot cost flat as collections grow, and it keeps every document in `wp_posts` so the block editor, revisions, REST, search, and locks keep working without special cases. The [data model](architecture/data-model.md) covers the exact keys; the [decision log](decisions.md) records why the model is shaped this way.

Treat the exact post types, meta keys, REST responses, and block attributes as internal implementation details for now. Do not build external integrations against them yet.

## Admin shell

The main product surface is a full-screen React app in wp-admin. It has a sidebar for pages and collections, a block editor canvas for documents, and collection views for records.

Collection views use WordPress's DataViews package where it fits, with Cortext code around it for inline editing, relations, rollups, row details, and embedded views inside pages.

## Frontend

Cortext pages can render on the public site through a thin plugin template. The active WordPress theme still owns the public page surface. Cortext's shell theme does not leak into published content.

## What we are still testing

Several ideas are still being tested, including reusable schema across collections, import/export, upgrade handling, and the shape of a stable REST contract. For now, treat this repo as beta software and avoid depending on it for important work.

More detailed notes live in:

-   [Shell architecture](architecture/shell.md)
-   [Blocks](architecture/blocks.md): which editor blocks are allowed and excluded.
-   [Data model](architecture/data-model.md)
-   [Theming](theming.md)
