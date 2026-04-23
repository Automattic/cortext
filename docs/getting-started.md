# Getting started

Cortext is an early prototype. There is no packaged release yet; to try it you run it from source. The same paths work whether you are kicking the tires or contributing.

## Requirements

- PHP 8.1+
- WordPress 6.9+ (runtime, via Playground)
- Node.js 20+ (matching `@wordpress/scripts`)
- Git

No Docker, no local MySQL. Cortext runs on WordPress Playground.

## First-time setup

```
git clone https://github.com/priethor/cortext.git
cd cortext
./scripts/setup.sh
```

`setup.sh` installs PHP and JS dependencies, assigns a deterministic port for the current worktree, writes a git-ignored `.wp-env.override.json`, and seeds the branch-label plugin under `.wp-env-plugins/`.

## Running Cortext

```
./scripts/run.sh
```

`run.sh` boots Playground detached, re-derives the site-title label from the current branch, and starts the JS watcher. When the admin URL is ready, sign in and click "Cortext" in the admin menu.

To stop cleanly:

```
./scripts/archive.sh
```

This is not optional. Playground runs detached and would leak the server process if a worktree were removed without archiving first.

## Day-to-day

```
npm run dev          # JS watcher, when Playground is already running
npm run build        # production build
npm run lint:js      # ESLint, scoped to src/
npm run lint:style   # stylelint for src/**/*.{css,pcss,scss}
npm run format       # Prettier
npm run test:unit    # Jest

composer phpcs       # WordPress Coding Standards
composer test:php    # PHPUnit (via WorDBless)
```

## Parallel worktrees

Ports are derived from the worktree's absolute path, so multiple worktrees (one per branch, say) never collide on the Playground port. The site-title label re-derives from `git branch --show-current` on every `run.sh`, so it survives branch renames and checkouts within the same worktree.

If you use an agent orchestrator (Conductor, Cursor, Cline, or similar), wire:

- Setup hook: `./scripts/setup.sh`
- Run hook: `./scripts/run.sh`
- Archive hook: `./scripts/archive.sh`

## Contributing

Cortext is a prototype, so docs, architecture notes, and scope are all fair game for PRs.

- Branch prefix: `add/`, `fix/`, `docs/`, `refactor/`, `tests/`, followed by a concise slug.
- CI runs ESLint, stylelint, Jest, PHPCS, and PHPUnit. Keep them green before requesting review.
- The [design principles](vision.md) describe the posture the project is willing to defend; if a PR proposes routing around a WordPress primitive, expect the conversation to start there.
- The [content modeling guide](modeling-guide.md) captures the mental model for collections and cross-type tags, which is the vocabulary used in issues and reviews.
