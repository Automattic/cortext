# Contributing

Cortext is in beta. The data model and public surface are moving, so small pull requests are much easier to review.

Start with [Getting started](docs/getting-started.md) for setup, local development, and test commands.

## Branches

Use a short, self-explanatory branch name. Prefixes like `add/`, `fix/`, or `docs/` are fine, but clarity matters more than strict naming.

## Checks

Before asking for review, run the checks that match your change:

```sh
pnpm run format:check
pnpm run lint:js
pnpm run lint:style
composer run phpcs
pnpm run test:unit
composer run test:php
```

For UI or routing changes, run the relevant Playwright coverage with `pnpm run test:e2e` too. E2E tests use the dedicated wp-env test environment described in [Getting started](docs/getting-started.md), not the main development environment.

## License

By contributing to Cortext, you agree that your contribution is licensed under the same license as the project: GPL-2.0-or-later.
