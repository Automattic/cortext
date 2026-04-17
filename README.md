![Cortext](cortext-banner.png)

# Cortext

A WordPress plugin that enables a Notion-inspired workspace on your own WordPress site, perfect for creating your knowledge base. You get nested pages, typed collections with multiple views, and cross-type taxonomies that add fields to individual rows. Built on native WordPress primitives: CPTs, post meta, taxonomies, Gutenberg, DataViews, Block Bindings.

**Status**: prototype under active development.

## Why

Notion handles structured knowledge beautifully, but your data lives on their servers. WordPress owns the data story but has never offered the Notion experience. The primitives to close that gap shipped in recent WordPress releases, and Cortext composes them.

The angle isn't to outdo Notion at its own game. Think Judo Monopoly: it's still WordPress, so Cortext wins where Notion structurally can't. Publishing any row as a fully-themed public page. Custom theming throughout. Running entirely offline via WordPress Playground.

## How it works, in one paragraph

Two post types handle storage: `cortext_page` for workspace documents, and `cortext_collection_{slug}` for collection rows (one dynamically-registered CPT per collection). A global taxonomy (internally `cortext_supertag`, final user-facing name TBD) attaches to every collection CPT, enabling cross-collection polymorphism inspired by Tana's super tags. Typed properties register as post meta with UUID-based keys. One REST field, `cortext_row_resolved_schema`, returns the effective property set for a given row (union of collection + assigned cross-type taxonomy term properties), and is the only contract clients read. A React shell mounts Gutenberg's `EditorProvider` alongside `@wordpress/dataviews` in a full-screen admin page.

## Docs

- [Pitch](docs/pitch.md) — "Operation Notion Liberation"
- [Vision and principles](docs/vision.md) — what drives the design
- [Architecture](docs/architecture.md) — content model, APIs, integration points
- [Roadmap](docs/roadmap.md) — what's shipping when
- [Content modeling guide](docs/modeling-guide.md) — collections vs cross-type taxonomies, with examples

## Requirements

- WordPress 6.9+
- PHP 8.1+
- A recent block theme is recommended but not required

## Development

Scaffolding, build instructions, and activation notes will land as the plugin takes shape.
