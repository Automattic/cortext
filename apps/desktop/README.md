# Cortext desktop

Cortext, packaged as an Electron app. WordPress lives inside, served by
Playground (PHP-WASM), so you don't have to set up a server to try it.

## Run it

First time, from the repo root:

```sh
npm install
npm --prefix apps/desktop install
npm --prefix apps/desktop run snapshot
```

The one to remember is `snapshot`. It builds the plugin, hands
`blueprint.json` to `wp-playground-cli build-snapshot`, and produces
`apps/desktop/snapshot.zip` (~40 MB). That zip is a baked WordPress site:
Cortext installed, `CORTEXT_DESKTOP` defined, `wp cortext seed` already
run. Re-run after changing plugin code, or when you want the seed back to a
clean state.

Start the app with:

```sh
npm --prefix apps/desktop start
```

The first launch unzips the snapshot into
`~/Library/Application Support/cortext-desktop/site/` and boots Playground
without re-installing anything.

## What it does

There are two processes at play. Electron spawns `wp-playground-cli server`
on port 9410 against the unzipped site (WP 6.9). Sitting in front of it, a
small Node proxy listens on 9402 and routes per-request: anything matching
`/wp-content/uploads/*` is served straight from disk, the rest goes to
Playground. The image shortcut isn't decorative; every PHP-WASM round-trip
costs real time, and a grid view full of thumbnails feels it fast.

Once Playground reports ready, Electron loads
`http://127.0.0.1:9402/wp-admin/admin.php?page=cortext`. DevTools are open
by default; pass `CORTEXT_DEVTOOLS=0` to turn them off. Closing the window
kills the Playground process.

## Performance

A cold launch (extract + boot) takes about 5-10 seconds. Warm launches
reach "Ready!" in 1-2 seconds, with the shell paint coming a beat after
that. Once you're in, navigation is noticeably slower than `wp-env` or a
real WordPress: every PHP request still goes through PHP-WASM, and that's
the deal until we leave Playground.
