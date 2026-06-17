# Cortext desktop

Cortext, packaged as an Electron app. It runs a local WordPress install
on PHP and SQLite, so you do not need to set up a server to try it.

## Requirements

- Node 24.x (matches the repo's `engines` field).
- PHP 8.1+ with `pdo_sqlite`, either at `apps/desktop/runtime/bin/php`,
  via `CORTEXT_PHP_BIN`, or on `PATH`. If you use Homebrew,
  `brew install php` is enough; Homebrew's PHP includes `pdo_sqlite`.

The source checkout does not commit a PHP binary. When a bundled PHP is
present locally, both `npm run snapshot` and the desktop runtime prefer it
over `PATH`.

To run from source you can use a local PHP install, or build the bundled
runtime with `npm --prefix apps/desktop run runtime:php`. The packaged DMG
ships that bundled runtime, so build it before `npm run dist` (see Package it
below).

## Run it

First time, from the repo root:

```sh
npm install
npm --prefix apps/desktop install
npm --prefix apps/desktop run snapshot
```

Most of the setup happens in `snapshot`: it downloads WordPress and wp-cli
into `apps/desktop/.snapshot-cache/`, installs and activates the plugin,
runs `wp cortext seed`, then writes `apps/desktop/snapshot.zip` (~30 MB).
The downloads are cached between builds.

Re-run after changing plugin code, or when you want the seed back to a
clean state.

Start the app with:

```sh
npm --prefix apps/desktop start
```

The first launch unzips the snapshot into
`~/Library/Application Support/cortext-desktop/site/` and boots PHP
without reinstalling WordPress.

To test the bundled-PHP path, build the static PHP CLI before running
`snapshot` or `start`:

```sh
npm --prefix apps/desktop run runtime:php
npm --prefix apps/desktop run snapshot
npm --prefix apps/desktop start
```

That command downloads `static-php-cli` into `apps/desktop/.runtime-cache/`
and writes `apps/desktop/runtime/bin/php`. It can take a few minutes on a
fresh machine. The binary is ignored by git.

## What it does

Electron spawns `php -S 127.0.0.1:9402` against the unzipped site and
uses `router.php` for the rewrite behavior WordPress normally gets from
nginx or Apache. Once PHP reports that it is accepting connections, the
window loads `http://127.0.0.1:9402/wp-admin/admin.php?page=cortext`.

In a dev run, DevTools open by default; set `CORTEXT_DEVTOOLS=0` to turn them
off. The packaged build never opens them. Closing the window kills the PHP
process.

For runtime experiments, set `CORTEXT_RUNTIME` before launch:

```sh
CORTEXT_RUNTIME=php npm --prefix apps/desktop start
CORTEXT_RUNTIME=franken npm --prefix apps/desktop start
CORTEXT_RUNTIME=php-fpm npm --prefix apps/desktop start
```

`php` is the default. It uses `apps/desktop/runtime/bin/php` first, then
falls back to `php` on `PATH`. Set `CORTEXT_PHP_BIN` to force a specific
binary. Set `CORTEXT_PHP_CLI_SERVER_WORKERS=4` to run PHP's built-in server
with worker children for request-heavy pages.

`franken` expects FrankenPHP at `apps/desktop/runtime/bin/frankenphp`, on
`PATH`, or at `CORTEXT_FRANKENPHP_BIN`. Install the local binary with:

```sh
npm --prefix apps/desktop run runtime:franken
CORTEXT_RUNTIME=franken npm --prefix apps/desktop start
```

`php-fpm` expects `php-fpm` plus Caddy at
`apps/desktop/runtime/bin/caddy`, on `PATH`, or at `CORTEXT_CADDY_BIN`.
Install the local Caddy binary with `npm --prefix apps/desktop run
runtime:caddy`. `php-fpm` itself still needs to come from `PATH` or
`CORTEXT_PHP_FPM_BIN`.

## Package it

Build an unsigned macOS DMG:

```sh
npm --prefix apps/desktop run runtime:php
CORTEXT_DESKTOP_DISTRIBUTION=1 npm --prefix apps/desktop run snapshot
npm --prefix apps/desktop run dist
```

`dist` runs electron-builder using the `build` block in `package.json`. It
writes an arm64 `.dmg` to `apps/desktop/dist/` and bundles `snapshot.zip`,
`runtime/bin/php`, and the desktop update-lock mu-plugin, so build the snapshot
and PHP binary first. `CORTEXT_DESKTOP_DISTRIBUTION=1` keeps the autologin and
update-lock mu-plugins in the snapshot, but drops the timing and runtime-probe
helpers used for development and benchmarks.

The DMG is not signed, so macOS blocks it on first launch. Open it once from
System Settings > Privacy & Security > "Open Anyway", or run
`xattr -dr com.apple.quarantine /Applications/Cortext.app`.

On launch the installed app checks GitHub for the latest release and links to
the download if you are behind. It does not update itself.

In desktop, WordPress is bundled runtime code, not a site the user maintains
through wp-admin. The snapshot disables core, plugin, and theme updates, and
each launch refreshes the update-lock mu-plugin in the extracted site. WordPress
changes come through new Cortext desktop releases.

Release builds are arm64-only, signed, and notarized on Buildkite. Local builds
remain unsigned unless you provide a signing environment.

## Releasing

`.github/workflows/release.yml` is the entry point; run it from the Actions tab.
It builds the plugin ZIP, validates the milestone, writes release notes, and
creates or updates the draft GitHub Release. Buildkite owns the macOS desktop
DMG: the release tag build builds the arm64 PHP runtime, builds the distribution
snapshot, runs electron-builder, signs and notarizes the app, and uploads the
DMG to the same Release.

## Performance

Cold launch extracts the zip and starts PHP, usually in 3-5 seconds. Warm
launches are under a second on the test machine. REST endpoints usually
respond in 30-60 ms, roughly the same as Cortext running in `wp-env` or
another local WordPress install on the same machine.

To collect repeatable desktop HTTP timings:

```sh
npm --prefix apps/desktop run snapshot
npm --prefix apps/desktop run bench:runtime -- --runtime=php --iterations=50 --warmup=10
```

The benchmark extracts the snapshot into `apps/desktop/.runtime-bench/`,
starts the selected runtime on port 9402, measures representative admin
and REST endpoints, and writes `artifacts/desktop-runtime-<runtime-or-label>.json`.
Pass `--label=<name>` when comparing multiple binaries behind the same
runtime, such as `--label=php-system` and `--label=php-bundled`.
The desktop snapshot adds a `Server-Timing: cortext_wp` header, so the JSON
has both total HTTP latency and WordPress request time.

## Tests

Run the desktop smoke test with Playwright Electron:

```sh
npm --prefix apps/desktop run snapshot
npm --prefix apps/desktop run test:e2e
```

The test removes `~/Library/Application Support/cortext-desktop/`, starts
Electron, waits for the window to reach the Cortext admin page, and checks
that `#cortext-root` is visible. It takes about 7 seconds locally once the
snapshot exists.

## Runtime files

`runtime/` contains the PHP-side files copied into the snapshot:

- `router.php`: gives PHP's built-in server the `.htaccess` behavior
  WordPress expects. Existing files are served from disk; everything else
  goes through `index.php`.
- `worker.php`: experimental FrankenPHP worker entrypoint used only when
  `CORTEXT_RUNTIME=franken`.
- `mu-plugins/cortext-autologin.php`: bypasses `auth_redirect()` and
  maps the current request to the local admin before `pluggable.php`
  loads. Desktop-only; do not ship this on a public site.
- `mu-plugins/cortext-update-lock.php`: disables WordPress core, plugin,
  theme, and file-editor updates in desktop. The runtime copies it into the
  extracted site on every launch, so older local sites get the same lock.
- `mu-plugins/cortext-timing.php`: emits the local `Server-Timing` value
  used by the desktop runtime benchmark.

The `sqlite-database-integration` plugin and its `db.php` drop-in are
downloaded during `npm run snapshot`, not vendored in git.
