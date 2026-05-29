# Playground

Cortext has a WordPress Playground blueprint for trying the plugin without
cloning the repo or running `wp-env`.

## Demo blueprint

`playground/blueprint.json` installs Cortext from the latest GitHub Release:

```text
https://github.com/Automattic/cortext/releases/latest/download/cortext.zip
```

After the first GitHub Release includes `cortext.zip`, the README link can load
that blueprint:

```text
https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/Automattic/cortext/main/playground/blueprint.json
```

## Build the plugin ZIP

Run:

```bash
pnpm run build:zip
```

The build stages only runtime plugin files in `dist/cortext/`, installs Composer
dependencies there with `--no-dev --no-scripts`, removes Composer metadata, and
writes `dist/cortext.zip`.

## Prepare a release-backed demo

1. Follow the [release process](release.md).
2. Run the `Prepare release` workflow with the release version and dry run
   enabled.
3. Check the workflow summary. The `Release ZIP` section should report version
   metadata for that release, required runtime files present, and source/dev
   paths absent.
4. Run `Prepare release` again with dry run disabled when the draft GitHub
   Release is ready.
5. Publish the draft release after reviewing the release notes and ZIP.

## Gallery submission

The `WordPress/blueprints` gallery needs every referenced file to be part of the
PR. Cortext keeps a gallery-ready blueprint at
`playground/gallery/blueprint.json`; it points to the bundled `./cortext.zip`.

To prepare the gallery PR:

1. Run `pnpm run build:zip`.
2. Fork `WordPress/blueprints` and create `blueprints/cortext/`.
3. Copy `playground/gallery/blueprint.json` to that directory.
4. Copy `playground/gallery/screenshot.jpg` to that directory.
5. Copy `dist/cortext.zip` to that directory as `cortext.zip`.
6. Open the PR.

Regenerate `screenshot.jpg` from a working Playground run before opening the
gallery PR, so the gallery shows the current seeded workspace.

## Verification

Check both blueprint files are valid JSON:

```bash
jq empty playground/blueprint.json playground/gallery/blueprint.json
```

The release workflow checks the ZIP contents. If you need to inspect them by
hand, use:

```bash
unzip -l dist/cortext.zip | less
```

The ZIP should include `cortext/cortext.php`, `cortext/vendor/autoload.php`,
`cortext/build/index.js`, `cortext/seed-assets/icons/`, and
`cortext/readme.txt`. It should not include `node_modules/`, `src/`, `tests/`,
`apps/`, `.github/`, `composer.json`, or `package.json`.
