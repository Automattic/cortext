# Playground

Cortext has two WordPress Playground blueprints:

-   `playground/blueprint.json` powers the demo linked from the README. It
    installs `cortext.zip` from the latest GitHub Release.
-   `playground/gallery/blueprint.json` is for the `WordPress/blueprints` gallery
    PR. It installs a bundled `./cortext.zip`, because gallery submissions need to
    include every file they reference.

## README demo

The README link loads:

```text
https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/Automattic/cortext/main/playground/blueprint.json
```

That blueprint downloads the current release asset:

```text
https://github.com/Automattic/cortext/releases/latest/download/cortext.zip
```

The link starts working after a GitHub Release includes `cortext.zip`. To update
the demo later, publish a new release with a fresh ZIP.

## Gallery submission

Build the plugin ZIP:

```bash
pnpm run build:zip
```

Then copy these files into `blueprints/cortext/` in a fork of
`WordPress/blueprints`:

-   `playground/gallery/blueprint.json`
-   `playground/gallery/screenshot.jpg`
-   `dist/cortext.zip`, renamed to `cortext.zip`

Regenerate `screenshot.jpg` from a working Playground run before opening the
gallery PR.

## Checks

Validate the blueprints:

```bash
jq empty playground/blueprint.json playground/gallery/blueprint.json
```

The release workflow checks the ZIP contents in its run summary. For a local
spot check:

```bash
unzip -l dist/cortext.zip | less
```

The ZIP should include runtime files such as `cortext/cortext.php`,
`cortext/vendor/autoload.php`, `cortext/build/index.js`, and
`cortext/readme.txt`. It should not include source, test, or tooling paths such
as `src/`, `tests/`, `apps/`, `.github/`, `node_modules/`, `composer.lock`, or
`package.json`.
