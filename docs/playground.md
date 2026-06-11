# Playground

Cortext has two WordPress Playground blueprints:

-   `assets/wordpress-org/blueprints/blueprint.json` is the demo linked from the
    README and the blueprint copied to WordPress.org for the plugin Preview
    button. It installs the latest stable Cortext release from WordPress.org.
-   `playground/gallery/blueprint.json` is for the `WordPress/blueprints` gallery
    PR. It installs a bundled `./cortext.zip`, because gallery submissions need to
    include every file they reference.

## README demo

The README link loads:

```text
https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/Automattic/cortext/main/assets/wordpress-org/blueprints/blueprint.json
```

That link loads `assets/wordpress-org/blueprints/blueprint.json`, which installs
Cortext from the WordPress.org plugin directory:

```text
pluginData.resource: wordpress.org/plugins
pluginData.slug: cortext
```

The demo follows whatever version is currently stable on WordPress.org.

## WordPress.org preview

The plugin directory looks for a blueprint at
`assets/blueprints/blueprint.json` in the WordPress.org SVN repository. In this
repo, that source file lives at
`assets/wordpress-org/blueprints/blueprint.json` and is deployed with the other
WordPress.org assets.

After the file is live, enable the public Preview button from the plugin's
Advanced view.

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
jq empty assets/wordpress-org/blueprints/blueprint.json playground/gallery/blueprint.json
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
