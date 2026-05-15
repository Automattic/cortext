# Cortext desktop

Electron wrapper for Cortext. WordPress runs inside the app via Playground
(PHP-WASM), so there's no external WordPress install to provision.

## Run it

From the repo root, one-time setup:

```sh
npm install
npm --prefix apps/desktop install
npm --prefix apps/desktop run snapshot
```

The snapshot script builds the plugin, runs `wp-playground-cli build-snapshot`
against `blueprint.json`, and writes `apps/desktop/snapshot.zip` (~40 MB). The
blueprint defines `CORTEXT_DESKTOP`, activates Cortext, and seeds demo data
with `wp cortext seed`. Re-run it after plugin changes or when you want a
fresh seed.

Launch:

```sh
npm --prefix apps/desktop start
```

On first launch the app unzips the snapshot into
`~/Library/Application Support/cortext-desktop/site/` and boots Playground
without re-running install.

## What it does

Electron's main process spawns `wp-playground-cli server` against the
unzipped site (WP 6.9) on port 9410. In front of it, a small Node proxy
listens on 9402: any `/wp-content/uploads/*` image is served straight from
disk, everything else is forwarded to Playground. Skipping PHP-WASM for
thumbnails saves a round-trip per image, which adds up fast in a grid view.

When Playground reports ready, Electron loads
`http://127.0.0.1:9402/wp-admin/admin.php?page=cortext`. DevTools open by
default; pass `CORTEXT_DEVTOOLS=0` to turn them off. Closing the window
shuts Playground down.

## Performance

A cold launch (snapshot extract + boot) takes ~5-10 seconds. Warm launches
get to "Ready!" in ~1-2 seconds, with another second or so before the shell
paints. Inside the app, navigation is noticeably slower than `wp-env` or a
real WordPress: every PHP request still runs through PHP-WASM, and there's
no way around that without leaving Playground.
