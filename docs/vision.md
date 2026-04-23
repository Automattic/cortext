# Vision and Principles

## The problem

Notion is great at structured knowledge work. Databases, views, relations, inline databases inside pages, super tags. But your data lives on someone else's servers, policies can change, and the content model isn't something you can extend.

WordPress owns the data story. Self-hosted, exportable, stable for over twenty years. What WordPress has never offered is the Notion experience. The block editor handles documents well. Everything structured (custom fields, relations, views) has historically lived in ACF/SCF territory, and the stitching has always felt a step behind what Notion does natively.

## The opportunity

WordPress core recently shipped three primitives that change the calculus:

1. `@wordpress/dataviews` (6.7+): a filterable, sortable, multi-layout list/grid/table component. Source-agnostic, mountable anywhere.
2. `@wordpress/editor` plus `BlockCanvas`: a standalone block editor you can mount outside the usual post-editor chrome.
3. Block Bindings (6.5+): any block attribute can source its value from an external provider.

With these in place, the gap between WordPress and a Notion-inspired UX is no longer a missing primitive. It's a missing composition. Cortext is that composition.

## Design principles

### 1. WordPress-native first

Every architectural decision leans on core APIs: `register_post_type`, `register_post_meta`, `register_taxonomy`, `register_rest_field`, `register_block_bindings_source`, `@wordpress/editor`, `@wordpress/dataviews`, `@wordpress/core-data`. No custom tables. No bypassing the REST API. No fighting the block editor.

If something is hard to do the WordPress way, that's a signal to reconsider, not to route around. Sometimes the reconsideration reveals a misuse of the primitive; other times it reveals a genuine gap in core, and the right answer is to fix it upstream. Because Cortext is a prototype, forking an experimental component locally to iterate on it quickly is acceptable; the goal in that case is to land the improvement upstream once it proves out. A parallel implementation that outlives the iteration cycle is technical debt.

Your data is liberated as a direct consequence. Every primitive is a WordPress primitive: properties are post meta, documents and rows are posts, cross-type tags are taxonomy terms. Your data stays readable even if you uninstall the plugin, exportable via WXR, SQL dump, WP-CLI, or REST. First-class Notion import (in phase-1 scope) makes the move in feel frictionless.

This same principle shapes Cortext's relationship with AI. Cortext isn't an AI-first knowledge base, and that's by design. WordPress contributors are already working on WordPress's AI story (semantic search, markdown support, agent-friendly APIs), and anything built on native WP primitives inherits those improvements as they land. Leaning on WP as the backend is a bet that the platform gets smarter over time, not a reason to build that work in parallel.

### 2. Tailored UX

Cortext is WordPress under the hood, but you wouldn't know it. The workspace UI is built from scratch to let users focus on their knowledge base, free from WordPress complexities. wp-admin remains available for operators who want it; everyone else lives in a Notion-style shell.

### 3. Bounded customization

Where Cortext exposes an extension point, the boundary is cosmetic or data-shaped, not structural. Layout grids, component positioning, and the shape of the workspace are owned by the product and do not shift across installs. The first concrete instance is the shell-theming contract (see [Theming](architecture/theming.md)): shell themes style the workspace via tokens, not by rearranging it.

A customization surface that includes structure ships a different product on every site and turns docs, support, and mental models into per-install work. A bounded cosmetic or data-shaped API gives users freedom to make Cortext theirs without fragmenting what Cortext means.

Apply this wherever an extension point is proposed. If something is load-bearing to the product shape, it is not a customization knob. If it is purely how something looks or which data surfaces, it is a candidate for the contract.
