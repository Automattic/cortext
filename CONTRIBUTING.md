# Contributing

Cortext is still a prototype. The data model and public surface are moving, so small pull requests are much easier to review.

Start with [Getting started](docs/getting-started.md) for setup, local development, and test commands.

## Branches

Use a short branch prefix followed by a concise slug:

-   `add/`
-   `fix/`
-   `docs/`
-   `refactor/`
-   `tests/`

## Checks

Before asking for review, run the checks that match your change:

```sh
npm run format:check
npm run lint:js
npm run lint:style
composer run phpcs
npm run test:unit
composer run test:php
```

For UI or routing changes, run the relevant Playwright coverage with `npm run test:e2e` too.

## License

By contributing to Cortext, you agree that your contribution is licensed under the same license as the project: GPL-2.0-or-later.
