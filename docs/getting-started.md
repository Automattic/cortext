# Getting started

Cortext is an early prototype. There is no packaged release yet; to try it you run it from source. The same paths work whether you are kicking the tires or contributing.

## Requirements

- PHP 8.1+
- WordPress 6.9+ (provided by wp-env)
- Docker (recommended runtime for wp-env)
- Node.js 20+ (matching `@wordpress/scripts`)
- Git

## First-time setup

```
git clone https://github.com/priethor/cortext.git
cd cortext
./scripts/setup.sh
```

`setup.sh` installs PHP and JS dependencies, assigns a deterministic port for the current worktree, writes a git-ignored `.wp-env.override.json`, and drops two helper plugins under `.wp-env-plugins/`: one labels the admin bar with the branch name, the other auto-logs you in as admin on localhost so agents and parallel worktrees don't have to juggle credentials.

## Running Cortext

```
./scripts/run.sh
```

`run.sh` boots wp-env detached, re-derives the site-title label from the current branch, seeds the Cortext demo workspace, and starts the JS watcher. When the admin URL is ready, sign in and click "Cortext" in the admin menu.

Plain `wp-env start`, `npm run env:start`, and `npm start` skip the seed. To opt in, use `./scripts/run.sh`, `npm run start:seed`, `npm run env:start:seed`, or `npm run env:seed`. Reruns are safe: existing collections, fields, entries, and non-empty pages are left alone, and only missing demo records get added. The seed creates a small page tree with embedded collection views so the editor and DataViews have something to render on first boot.

To stop cleanly:

```
./scripts/archive.sh
```

This is not optional. wp-env runs detached and would leak containers if a worktree were removed without archiving first.

## Day-to-day

```
npm run dev          # JS watcher, when wp-env is already running
npm run build        # production build
npm run lint:js      # ESLint, scoped to src/
npm run lint:php     # PHPCS via npm (same as composer phpcs)
npm run lint:style   # stylelint for src/**/*.{css,pcss,scss}
npm run format       # Prettier
npm run start:seed   # boot wp-env, seed demo data, start the JS watcher
npm run env:start:seed # boot wp-env and add any missing demo data
npm run env:seed     # add any missing demo data to the dev wp-env
npm run env:seed:reset # delete Cortext data and recreate the demo set
npm run test:unit    # Jest
npm run test:e2e     # Playwright end-to-end tests

composer phpcs       # WordPress Coding Standards
composer test:php    # PHPUnit (via WorDBless)
```

### End-to-end tests

E2E tests run against a dedicated wp-env instance on port 8889, separate from the development site:

```
npm run test:env:start   # boot the test environment
npm run test:env:start:seed # boot the test environment and seed demo data
npm run test:env:seed    # add any missing demo data to the test wp-env
npm run test:env:seed:reset # delete Cortext test data and recreate the demo set
npm run test:e2e         # run Playwright tests
npm run test:e2e:debug   # run with the Playwright UI
```

These run the same seed command as the dev environment, just pointed at `.wp-env.test.json`.

## Parallel worktrees

Ports are derived from the worktree's absolute path, so multiple worktrees (one per branch, say) shouldn't collide. The site-title label re-derives from `git branch --show-current` on every `run.sh`, so it survives branch renames and checkouts within the same worktree.

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
