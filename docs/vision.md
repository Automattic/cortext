# Vision and Principles

## The problem

Knowledge bases need documents, typed records, views, and relations. WordPress
has the storage pieces for that work, but the editing experience is scattered
across custom fields, list tables, plugin screens, and theme templates.

WordPress is self-hosted, exportable, and stable. The block editor handles documents well. What is missing is a knowledge base interface that treats pages, collections, fields, and views as one product surface while keeping the data in WordPress.

## The opportunity

WordPress core now has enough of the pieces to make this practical: posts, post
meta, REST, the block editor, and DataViews. Cortext wires those together into
one knowledge base surface.

## Design principles

### 1. WordPress-native first

Every architectural decision should start with WordPress primitives. No custom
tables unless the post/meta model clearly fails. No REST API bypass. No fighting
the block editor.

If something is hard to do the WordPress way, that is a signal to reconsider the shape of the feature. Sometimes we are using the primitive wrong. Sometimes core has a real gap, and the better answer is to fix it upstream. Cortext is a prototype, so a short-lived local fork of an experimental component is fine while we learn. A parallel implementation that sticks around after the experiment is technical debt.

The data stays readable because it is ordinary WordPress data: properties are
post meta, and documents and rows are posts. Even if you uninstall the plugin,
the raw data is still inspectable. Once the data model settles, export should be
possible through WXR, SQL dumps, WP-CLI, or REST.

Cortext is not an AI-first knowledge base, and that is deliberate. If Cortext
keeps its data in native WordPress shapes, it can adopt future WordPress work
without building a separate data layer too early.

### 2. Tailored UX

Cortext is WordPress under the hood, but the workspace UI is built for maintaining a knowledge base rather than doing ordinary wp-admin chores. wp-admin stays available for operators who want it; everyone else works in a dedicated shell.

The workspace UI can be themed, but the API is intentionally small. Themes can adjust colors and basic visual details; they cannot move the sidebar, reshape DataViews, or replace the inspector. Content pages keep the full WordPress block-theme API, so the workspace can feel like Cortext while published pages still feel like the site. See [Theming](theming.md) for the current contract notes.
