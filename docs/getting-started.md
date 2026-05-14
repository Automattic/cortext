# Getting started

Cortext is an early prototype. There is no packaged release yet; to try it you run it from source. The same paths work whether you are kicking the tires or contributing.

## Requirements

-   PHP 8.1+
-   WordPress 6.9+ (provided by wp-env)
-   Docker (recommended runtime for wp-env)
-   Node.js 24.15
-   pnpm 11+
-   Git

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

Plain `wp-env start`, `pnpm run env:start`, and `pnpm start` skip the seed. To opt in, use `./scripts/run.sh`, `pnpm run start:seed`, `pnpm run env:start:seed`, or `pnpm run env:seed`. Reruns are safe: existing collections, fields, entries, and non-empty pages are left alone, and only missing demo records get added. The default seed creates a compact page tree and a few representative rows per collection; use `pnpm run env:seed:full` when you need the larger catalog.

To stop cleanly:

```
./scripts/archive.sh
```

This is not optional. wp-env runs detached and would leak containers if a worktree were removed without archiving first.

## Day-to-day

```
pnpm run dev          # JS watcher, when wp-env is already running
pnpm run build        # production build
pnpm run lint:js      # ESLint, scoped to src/
pnpm run lint:php     # PHPCS via pnpm (same as composer phpcs)
pnpm run lint:style   # stylelint for src/**/*.{css,pcss,scss}
pnpm run format       # Prettier
pnpm run start:seed   # boot wp-env, seed demo data, start the JS watcher
pnpm run env:start:seed # boot wp-env and add any missing demo data
pnpm run env:seed     # add any missing demo data to the dev wp-env
pnpm run env:seed:full # add the full demo catalog to the dev wp-env
pnpm run env:seed:reset # delete Cortext data and recreate the demo set
pnpm run env:seed:reset:full # delete Cortext data and recreate the full demo set
pnpm run test:unit    # Jest
pnpm run test:e2e     # Playwright end-to-end tests

composer phpcs       # WordPress Coding Standards
composer test:php    # PHPUnit (via WorDBless)
```

### End-to-end tests

E2E tests run against a dedicated wp-env instance on port 8889, separate from the development site:

```
pnpm run test:env:start   # boot the test environment
pnpm run test:env:start:seed # boot the test environment and seed demo data
pnpm run test:env:seed    # add any missing demo data to the test wp-env
pnpm run test:env:seed:full # add the full demo catalog to the test wp-env
pnpm run test:env:seed:reset # delete Cortext test data and recreate the demo set
pnpm run test:env:seed:reset:full # delete Cortext test data and recreate the full demo set
pnpm run test:e2e         # run Playwright tests
pnpm run test:e2e:debug   # run with the Playwright UI
```

These run the same seed command as the dev environment, just pointed at `.wp-env.test.json`.

## Parallel worktrees

Ports are derived from the worktree's absolute path, so multiple worktrees (one per branch, say) shouldn't collide. The site-title label re-derives from `git branch --show-current` on every `run.sh`, so it survives branch renames and checkouts within the same worktree.

If you use an agent orchestrator (Conductor, Cursor, Cline, or similar), wire:

-   Setup hook: `./scripts/setup.sh`
-   Run hook: `./scripts/run.sh`
-   Archive hook: `./scripts/archive.sh`

## Contributing

Cortext is a prototype, so docs, architecture notes, and scope are all fair game for PRs.

-   Branch prefix: `add/`, `fix/`, `docs/`, `refactor/`, `tests/`, followed by a concise slug.
-   CI runs ESLint, stylelint, Jest, PHPCS, and PHPUnit. Keep them green before requesting review.
-   The [design principles](vision.md) describe the posture the project is willing to defend; if a PR proposes routing around a WordPress primitive, expect the conversation to start there.
