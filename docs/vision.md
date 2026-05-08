# Vision and Principles

## The problem

Knowledge bases need documents, typed records, views, relations, and reusable schema. WordPress has the storage pieces for that work, but the editing experience is scattered across custom fields, list tables, plugin screens, and theme templates.

WordPress owns the data story. It is self-hosted, exportable, and stable. The block editor handles documents well. What is missing is a knowledge base interface that treats pages, collections, fields, and views as one product surface while keeping the data in WordPress.

## The opportunity

WordPress core now has three pieces that make this practical:

1. `@wordpress/dataviews` (6.7+): a filterable, sortable, multi-layout list/grid/table component. Source-agnostic, mountable anywhere.
2. `@wordpress/editor` plus `BlockCanvas`: a standalone block editor you can mount outside the usual post-editor chrome.
3. Block Bindings (6.5+): any block attribute can source its value from an external provider.

The pieces are there. Cortext wires them together.

## Design principles

### 1. WordPress-native first

Every architectural decision leans on core APIs: `register_post_type`, `register_post_meta`, `register_taxonomy`, `register_rest_field`, `register_block_bindings_source`, `@wordpress/editor`, `@wordpress/dataviews`, `@wordpress/core-data`. No custom tables. No REST API bypass. No fighting the block editor.

If something is hard to do the WordPress way, that is a signal to reconsider the shape of the feature. Sometimes we are using the primitive wrong. Sometimes core has a real gap, and the better answer is to fix it upstream. Cortext is a prototype, so a short-lived local fork of an experimental component is fine while we learn. A parallel implementation that sticks around after the experiment is technical debt.

The data stays readable because it is ordinary WordPress data: properties are post meta, documents and rows are posts, and cross-type tags are taxonomy terms. Even if you uninstall the plugin, the raw data is still inspectable. Once the data model settles, export should be possible through WXR, SQL dumps, WP-CLI, or REST.

Cortext is not an AI-first knowledge base, and that is deliberate. WordPress contributors are already working on semantic search, markdown support, and agent-friendly APIs. If Cortext keeps its data in native WordPress shapes, it can pick up that work as it lands instead of building a separate AI layer too early.

### 2. Tailored UX

Cortext is WordPress under the hood, but the workspace UI is built for maintaining a knowledge base rather than doing ordinary wp-admin chores. wp-admin stays available for operators who want it; everyone else works in a dedicated shell.

The shell is themeable, but the API is intentionally small. Operators can retune Cortext chrome with tokens. They cannot move the sidebar, reshape DataViews, or replace the inspector. Content pages keep the full WordPress block-theme API, so the workspace can feel like Cortext while published pages still feel like the site. See [Theming](theming.md) for the current contract notes.
