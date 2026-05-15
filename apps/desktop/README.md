# Cortext desktop

Cortext, packaged as an Electron app. It runs a local WordPress install
on PHP and SQLite, so you do not need to set up a server to try it.

## Requirements

- macOS with PHP 8.1+ on `PATH`. If you use Homebrew, `brew install php`
  is enough; Homebrew's PHP includes `pdo_sqlite`.
- Node 24.x (matches the repo's `engines` field).

Bundling PHP is still future work. For now, the desktop app runs the
`php` it finds on `PATH`.

## Run it

First time, from the repo root:

```sh
npm install
npm --prefix apps/desktop install
npm --prefix apps/desktop run snapshot
```

Most of the setup happens in `snapshot`. It downloads WordPress and
wp-cli into `apps/desktop/.snapshot-cache/` (cached between builds),
installs and activates the plugin, runs `wp cortext seed`, then zips the
WordPress install into `apps/desktop/snapshot.zip` (~30 MB).

Re-run after changing plugin code, or when you want the seed back to a
clean state.

Start the app with:

```sh
npm --prefix apps/desktop start
```

The first launch unzips the snapshot into
`~/Library/Application Support/cortext-desktop/site/` and boots PHP
without reinstalling WordPress.

## What it does

Electron spawns `php -S 127.0.0.1:9402` against the unzipped site and
uses `router.php` for the rewrite behavior WordPress normally gets from
nginx or Apache. Once PHP reports that it is accepting connections, the
window loads `http://127.0.0.1:9402/wp-admin/admin.php?page=cortext`.

DevTools open by default; set `CORTEXT_DEVTOOLS=0` to turn them off.
Closing the window kills the PHP process.

## Performance

Cold launch means extracting the zip and starting PHP, usually 3-5
seconds. Warm launches are comfortably under a second. REST endpoints
usually respond in 30-60 ms, roughly the same as Cortext running in
`wp-env` or another local WordPress install on the same machine.

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

`runtime/` contains the native PHP files copied into the snapshot:

- `router.php`: gives PHP's built-in server the `.htaccess` behavior
  WordPress expects. Existing files are served from disk; everything else
  goes through `index.php`.
- `mu-plugins/cortext-autologin.php`: bypasses `auth_redirect()` and
  maps the current request to the local admin before `pluggable.php`
  loads. Desktop-only; do not ship this on a public site.

The `sqlite-database-integration` plugin and its `db.php` drop-in are
downloaded during `npm run snapshot`, not vendored in git.
