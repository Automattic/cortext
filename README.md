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

```
./scripts/setup.sh   # install deps, assign a per-worktree port
./scripts/run.sh     # refresh branch label, boot Playground, start watcher
npm run dev          # JS watcher only (Playground already running)
npm run build        # production build
```

Runs on WordPress Playground — no Docker required. The setup script writes a
git-ignored `.wp-env.override.json` so parallel git worktrees use different
ports, and drops a small auto-activated plugin that labels the site title
with the current branch name.

### Orchestrators (Conductor, Cursor, Cline, etc.)

Wire these three scripts into your orchestrator's per-project settings:

- **Setup**:   `./scripts/setup.sh`   — installs deps, assigns a per-worktree port, seeds the branch label
- **Run**:     `./scripts/run.sh`     — refreshes the branch label, boots Playground, starts the JS watcher
- **Archive**: `./scripts/archive.sh` — stops the detached Playground server

Each worktree gets a deterministic port derived from its absolute path, so
agents working in parallel worktrees don't collide on the Playground port.
The run script re-derives the site-title label from the current branch each
time, so it survives branch renames and checkouts within the worktree.
The archive script matters because Playground runs detached — it survives
the run process and would otherwise leak when a worktree is removed.
