![Cortext](cortext-banner.png)

# Cortext

A WordPress plugin that brings a Notion-inspired workspace to your own WordPress site: nested pages, typed collections with multiple views, and cross-type taxonomies that add fields to individual rows. Built on native WordPress primitives (CPTs, post meta, taxonomies, Gutenberg, DataViews, Block Bindings).

**Status**: prototype under active development.

## Why

Notion handles structured knowledge well, but your data lives on their servers. WordPress owns the data story and now has the primitives to close the UX gap: `@wordpress/dataviews`, standalone `@wordpress/editor` with `BlockCanvas`, and Block Bindings. Cortext composes them.

Because it is still WordPress, Cortext picks up things Notion cannot: publishing a row as a fully-themed public page, custom theming throughout, and running entirely offline via WordPress Playground.

## How it works, in one paragraph

Two post types handle storage: `cortext_page` for workspace documents, and `cortext_collection_{slug}` for collection rows (one dynamically-registered CPT per collection). A global taxonomy (internally `cortext_supertag`, final user-facing name TBD) attaches to every collection CPT, enabling cross-collection polymorphism inspired by Tana's super tags. Typed properties register as post meta with UUID-based keys. One REST field, `cortext_row_resolved_schema`, returns the effective property set for a given row (union of collection and supertag properties) and is the only contract clients read. A React shell mounts Gutenberg's `EditorProvider` alongside `@wordpress/dataviews` on a full-screen admin page.

## Docs

- [Getting started](docs/getting-started.md): install, run, day-to-day commands.
- [Vision and principles](docs/vision.md): what drives the design.
- [Content modeling guide](docs/modeling-guide.md): collections vs cross-type taxonomies, with examples.
- [Architecture](docs/architecture.md): content-model sketch.
- [Shell architecture](docs/architecture/shell.md): React shell, mount point, editor setup.
- [Data model](docs/architecture/data-model.md): REST contract and implementation status.
- [Theming](docs/architecture/theming.md): content themes vs shell themes, token contract scope.
- [Roadmap](docs/roadmap.md): what ships when.

## Requirements

- WordPress 6.9+
- PHP 8.1+
- A recent block theme is recommended but not required.

## Development

Quick start:

```
./scripts/setup.sh   # install deps, assign a per-worktree port
./scripts/run.sh     # boot Playground, start the JS watcher
./scripts/archive.sh # stop the detached Playground server
```

Runs on WordPress Playground; no Docker required. Parallel worktrees get deterministic per-path ports so branches and agents do not collide on the Playground port. Full workflow, contribution notes, and command reference in [Getting started](docs/getting-started.md).
