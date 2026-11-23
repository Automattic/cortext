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

## PR previews

The `Playground Preview` workflow builds the plugin ZIP for every pull request
and uploads it with `playground/gallery/blueprint.json` as the
`cortext-playground` artifact. Together they form a blueprint bundle. A bot
comment on the PR links to:

```text
https://playground.wordpress.net/?blueprint-url=https://playground.wordpress.net/plugin-proxy.php?org=Automattic&repo=cortext&workflow=Playground%20Preview&artifact=cortext-playground&pr=<number>
```

(The comment URL-encodes the `blueprint-url` value.) Playground's plugin proxy
serves the latest artifact from the PR's branch, so the link always opens the
newest build. The proxy looks up the workflow and artifact by name, so renaming
either one breaks the links on open PRs. Artifacts expire after 14 days; push
again to get a fresh one.

PRs from forks still get the artifact, but no comment, because their token can't
write to the PR.

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
