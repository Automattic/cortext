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

Electron takes the first free loopback port in the 9403-9498 band, spawns PHP
against the unzipped site, and uses `router.php` for the rewrite behavior
WordPress normally gets from nginx or Apache. The selected port is saved per
desktop profile so origin-scoped preferences remain available after a restart.
The band sits below the ephemeral range the kernel hands out for outbound
sockets, so a saved port is unlikely to be taken while Cortext is closed. If it
is taken anyway, Cortext scans the band again and saves the new choice. Profiles
created by an older build try their previous port once for the same migration
reason. A forced change creates a new browser origin, so browser-only
preferences and the local Notion key must be entered again. WordPress settings
and uploads survive; blocks that embed uploaded media keep the previous origin
in their markup and need re-inserting, because content still stores absolute
URLs.

Each launch creates a new 256-bit authentication token in memory. Every Cortext
window uses one dedicated Electron session, which adds the token to requests
for the local runtime. The session remains persistent so browser-backed product
preferences such as theme and sidebar layout survive restarts; the token itself
is never stored in that session. Its HTTP cache is disabled, and cookies,
service workers, and Cache API data for the runtime are cleared at launch.
Requests that leave the runtime origin are stripped of the header and cannot
regain it by redirecting back. Only requests coming from a Cortext frame carry
the token, so embedded third-party content such as an Embed block renders while
staying outside the boundary: neither the frame, nor a frame nested inside it,
nor a service worker or popup it opens can reach the runtime. External
top-level links open in the system browser, an embedded frame cannot steer the
app window, and internal popups stay in the protected session.

The dedicated session denies Electron permissions by default. HTTP and HTTPS
frames may use fullscreen, so video embeds keep working. Only the exact Cortext
runtime origin may write sanitized clipboard data. That origin and HTTPS embeds
may use DRM and third-party storage. Cortext blocks camera and microphone
access, screen capture, location, notifications, clipboard reads, filesystem
and device access, input locks, requests to open external apps, and any
permission it does not recognize.

The runtime rejects requests without the matching token before serving
WordPress or static files. It also requires the request `Host` and any supplied
`Origin` to match the selected runtime origin, and every server binds only to
`127.0.0.1`. The token is passed through the runtime environment and is never
written to disk, included in a URL, logged, forwarded to PHP by Caddy, or added
to benchmark results. This protects the local admin session from web pages and
accidental localhost clients. It does not protect against native processes
running as the same macOS user, which can already read that user's Cortext
data.

Only one Cortext process may use a desktop profile at a time. Opening the app
again focuses the existing window instead of starting another PHP process
against the same SQLite database.

Desktop hides the publishing and copy-link controls. Published localhost URLs
are also protected by the token, so they are intentionally not shareable in
Safari or another client; publishing remains available when Cortext runs as a
WordPress plugin on a web site.

In a dev run, DevTools open by default; set `CORTEXT_DEVTOOLS=0` to turn them
off. Packaged builds disable DevTools and remove "Toggle Developer Tools" from
the View menu. Electron fuses also disable Node modes and inspector arguments,
prevent application code from loading outside `app.asar`, and remove extra
`file://` privileges. Cortext serves its loading and error pages through the
private `cortext-shell://` scheme under a restrictive content security policy.
Closing the window kills the PHP process.

For runtime experiments, set `CORTEXT_RUNTIME` before launch:

```sh
CORTEXT_RUNTIME=php npm --prefix apps/desktop start
CORTEXT_RUNTIME=franken npm --prefix apps/desktop start
CORTEXT_RUNTIME=php-fpm npm --prefix apps/desktop start
```

`php` is the default. It uses `apps/desktop/runtime/bin/php` first, then
falls back to `php` on `PATH`. Set `CORTEXT_PHP_BIN` to force a specific
binary. Set `CORTEXT_PHP_CLI_SERVER_WORKERS=4` to run PHP's built-in server
with worker children for request-heavy pages. Windows always uses a single
worker.

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

On launch, and every few hours after that, the installed app checks the latest
published GitHub Release with electron-updater. If a newer version exists, it
downloads it in the background and asks the user to restart. Draft Releases are
ignored, so users only get an update after someone publishes the Release. The
Cortext app menu includes "Check for Updates..." and a toggle for automatic
installs. In-place updates require the signed, notarized app running from
Applications.

In desktop, WordPress is bundled runtime code, not a site the user maintains
through wp-admin. The snapshot disables core, plugin, and theme updates. Each
launch refreshes the update-lock mu-plugin in the extracted site. New WordPress
and Cortext code ships with Cortext desktop releases: after an app update,
Cortext refreshes the bundled files in the extracted site, keeps the user's
database and uploads, and lets WordPress run any database upgrade on the next
load.

Release builds are arm64-only, signed, and notarized on Buildkite. Local builds
remain unsigned unless you provide a signing environment.

Inspect an already built `.app` with:

```sh
npm --prefix apps/desktop run verify:app -- \
  --app "$PWD/apps/desktop/dist/mac-arm64/Cortext.app"
```

The verifier reads the fuse settings directly from the packaged Electron
executable. It requires `app.asar`, rejects an unpacked app directory or
`app.asar.unpacked` payload, checks the bundled snapshot and runtime files, and
confirms that the PHP binary is executable and arm64.

## Releasing

`.github/workflows/release.yml` is the entry point; run it from the Actions tab.
It builds the plugin ZIP, validates the milestone, writes release notes, and
creates or updates the draft GitHub Release. Buildkite owns the macOS desktop
DMG: the release tag build builds the arm64 PHP runtime, builds the distribution
snapshot, runs electron-builder, signs and notarizes the app, and uploads the
DMG to the same Release. Before uploading, Buildkite verifies the signature,
notarization, fuses, bundled files, and PHP binary, then starts the same `.app`
with a temporary profile. The packaged-app smoke test connects only to
Chromium's renderer through CDP on loopback. It waits for the Cortext canvas,
confirms that a request without the token gets `403` and a second launch exits,
then quits the app and checks that Electron, PHP, and the runtime port are gone.

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
starts the selected runtime on an available loopback port, measures
representative admin and REST endpoints, and writes
`artifacts/desktop-runtime-<runtime-or-label>.json`. Pass `--label=<name>`
when comparing multiple binaries behind the same runtime, such as
`--label=php-system` and `--label=php-bundled`.
The desktop snapshot adds a `Server-Timing: cortext_wp` header, so the JSON
has both total HTTP latency and WordPress request time.

## Tests

Run the desktop smoke test with Playwright Electron:

```sh
npm --prefix apps/desktop run snapshot
npm --prefix apps/desktop run test:e2e
```

The test starts Electron with a temporary `--user-data-dir`, so it never reads
or removes the developer's normal desktop profile. It exercises session
authentication, external navigation, embedded third-party frames, and internal
popups. It also checks the app menu's Reload command, blocked sensitive
permissions, working embed fullscreen, rejection of unauthenticated requests,
and canvas rendering.

## Runtime files

`runtime/` contains the PHP-side files copied into the snapshot:

- `router.php`: gives PHP's built-in server the `.htaccess` behavior
  WordPress expects. Existing files are served from disk; everything else
  goes through `index.php`.
- `bootstrap.php`: defines the selected runtime origin before WordPress or
  an existing desktop `wp-config.php` loads.
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
