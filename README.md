![Cortext](cortext-banner.png)

# Cortext

> [!WARNING]
> Cortext is an experimental prototype. Do not use it on production sites or with data you cannot afford to lose.
>
> The data layer will change. Post types, meta keys, REST responses, block attributes, theme tokens, and stored content shapes are not stable yet.
>
> We are not writing migrations for early builds. Treat anything you create with Cortext today as throwaway data.

A WordPress plugin for building a knowledge base inside your own site: nested pages, typed collections with multiple views, and cross-type taxonomies that add fields to individual rows. Built on native WordPress primitives (CPTs, post meta, taxonomies, Gutenberg, DataViews, Block Bindings).

## Why

WordPress already has the data story: self-hosted, exportable, and built on APIs that have survived real use. Cortext uses that foundation for knowledge bases. `@wordpress/dataviews`, standalone `@wordpress/editor` with `BlockCanvas`, and Block Bindings provide the UI pieces.

Because it is still WordPress, Cortext can publish knowledge base entries as fully themed public pages, run locally, export through WordPress tools, and keep data readable through standard post, meta, and taxonomy storage.

## How it works, in one paragraph

Storage uses `crtxt_page` for documents, `crtxt_collection` for collection definitions, `crtxt_field` for field definitions, and `crtxt_{slug}` for collection rows. Each collection gets its own dynamically registered CPT. A global cross-type taxonomy, internally `cortext_supertag`, will let reusable labels add fields across collection boundaries. Typed properties live in post meta. A future REST field, `cortext_row_resolved_schema`, will return the effective property set for a row. The admin UI is a React shell that mounts Gutenberg's `EditorProvider` alongside `@wordpress/dataviews`.

## Docs

-   [Getting started](docs/getting-started.md): install, run, day-to-day commands.
-   [Vision and principles](docs/vision.md): what drives the design.
-   [Content modeling guide](docs/modeling-guide.md): collections vs cross-type taxonomies, with examples.
-   [Architecture](docs/architecture.md): content-model sketch.
-   [Shell architecture](docs/architecture/shell.md): React shell, mount point, editor setup.
-   [Data model](docs/architecture/data-model.md): implementation notes and current status.
-   [Theming](docs/theming.md): shell vs content themes, and current token notes.
-   [Licensing](docs/licensing.md): why Cortext uses GPLv2-or-later.
-   [Roadmap](docs/roadmap.md): what ships when.

## Requirements

-   WordPress 6.9+
-   PHP 8.1+
-   A recent block theme is recommended but not required.

## Development

Quick start:

```
./scripts/setup.sh   # install deps, assign a per-worktree port
./scripts/run.sh     # boot wp-env, seed demo data, start the JS watcher
./scripts/archive.sh # stop the detached wp-env environment
```

Runs on Docker via wp-env. Parallel worktrees get deterministic per-path ports so branches and agents do not collide. Demo data is opt-in: `./scripts/run.sh` and `npm run env:start:seed` seed it; plain `wp-env start` does not. Full workflow, contribution notes, and command reference in [Getting started](docs/getting-started.md).
