# Contributing

Cortext is in beta. The product surface is moving, so small pull requests are much easier to review.

Start with [Getting started](docs/getting-started.md) for setup, local development, and test commands.

## Branches

Use a short, self-explanatory branch name. Prefixes like `add/`, `fix/`, or `docs/` are fine, but clarity matters more than strict naming.

## Pull request titles

Start the title with a [Conventional Commits](https://www.conventionalcommits.org/) type, capitalized, then a short sentence: `Perf: Fetch only the fields the shell's document lists use`. Squash merges use the title as the commit subject on `main`, and the release notes drop the prefix.

Use `Feat`, `Fix`, `Perf`, `Refactor`, `Docs`, `Test`, `Build`, `CI`, `Chore`, `Style`, or `Revert`. A scope is optional, as in `Build(deps):`. Areas like `Desktop:` or `tooling:` are not types; use the `area:` and `type:` labels for those.

## Interface text

Use the words in the [Glossary](docs/glossary.md), and write them like this:

-   **Tone.** Friendly and a little playful. When two words are equally clear, pick the warmer one: "Side peek", not "Side panel"; "Center peek", not "Center modal". Clarity still wins over cuteness.
-   **Name what people do, not how it is built.** "Side peek" says what you are doing; "side panel", "pop-up", and "modal" describe the widget. The same goes for "drawer", "popover", and "toggle".
-   **Sentence case** for every label, button, menu item, and title: "Add to favorites", not "Add To Favorites". WordPress admin post type labels follow core's own casing.
-   **Errors** start with "Couldn't", then say what failed: "Couldn't save the formula." Do not use "We couldn't" or "Cortext could not", or blame the user. Use contractions in the rest of the copy too ("This can't be undone.").
-   **Next step.** When the user can fix the problem, say how and use the term from the glossary: "Unarchive this collection before changing its fields."
-   **Quotes.** Put curly quotes around names the user typed, like “%s”. Keep straight quotes in formula examples and in REST errors about field IDs or operators.
-   **Ellipsis.** Use the single character `…`. Add it to menu items that open another step ("Change type…", "Empty Trash…") and to progress states ("Saving…").
-   **No title.** A document without a title shows as `(untitled)`.
-   **Whole sentences.** Do not build a label by dropping another label into a sentence, like "Open in %s". It breaks sentence case and translation. Write each variant out.
-   **Say where an action applies** when the same action exists in more than one place: "Hide in view" in a table hides the field in that view, and "Hide in documents" hides it on every document in the collection.
-   **"Row" and "column"** describe only the shape of the table, as in "Resize column" or moving a row to a new position. They are not names for documents or fields.
-   **Other apps.** Name Notion only in import copy. Do not compare Cortext to other apps in interface text.

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
