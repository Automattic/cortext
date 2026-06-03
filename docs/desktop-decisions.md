# Desktop decisions

Running log for desktop-specific runtime and packaging decisions. Keep the detailed benchmark numbers in PR comments or artifacts unless they become stable product guidance.

## 2026-06-02 — Package the desktop app as an unsigned arm64 DMG

**Decision.** `apps/desktop` packages to a macOS DMG with electron-builder. `npm --prefix apps/desktop run dist` runs the build against a `build` block in `package.json`: appId `com.automattic.cortext`, product name `Cortext`, a single arm64 `dmg` target, `identity: null` so it is unsigned, and `snapshot.zip` plus `runtime/bin/php` listed as `extraResources`. The output lands in `apps/desktop/dist`. `main.js` reads the bundled snapshot and PHP from `process.resourcesPath` when `app.isPackaged`, and DevTools stay closed in the packaged build. The distribution snapshot is built with `CORTEXT_DESKTOP_DISTRIBUTION=1`, which ships only the autologin mu-plugin and drops the timing and runtime-probe ones; the autologin mu-plugin is now inert unless `CORTEXT_DESKTOP` is defined.

**Release flow.** `release.yml` is a `workflow_dispatch` orchestrator. It takes an explicit release milestone, bumps metadata to that milestone version first, committing it on real releases and only applying it locally on dry runs. Then it calls two reusable workflows against the bumped commit: `release-plugin.yml` (plugin ZIP, milestone, notes) and `release-desktop.yml` (builds the arm64 PHP, builds the distribution snapshot, runs electron-builder, attaches the DMG). Both write to the same Release by tag, so the first run creates the draft and later runs add to it. Successful releases close the published milestone; non-patch releases also create the next non-patch milestone. Each child workflow can also run on its own from the Actions tab. The shipped app checks GitHub Releases on launch and links to the download when a newer version exists; installing updates in place is not done, since that needs a signed app and Squirrel.Mac.

**Why unsigned and arm64 only.** This is an alpha for technical testers, so we skip the Apple Developer ID, signing, and notarization for now and live with the Open Anyway step on first launch. arm64 is the only target because static-php-cli does not cross-compile on macOS, so a second architecture means a second native runner.

**Revisit when.** We have an Apple Developer ID and want a signed, notarized build (which is also what unblocks in-place updates), an Intel or universal build earns its second runner, or a Homebrew cask is worth adding.

## 2026-05-18 — Desktop startup avoids WordPress work in readiness checks

**Decision.** The desktop runtime checks readiness with a static WordPress asset, not `wp-admin`. The generated desktop `wp-config.php` also sets `DISABLE_WP_CRON` to `true`.

**Why.** Readiness should only prove that the local server is accepting requests. Loading `wp-admin` does real WordPress work before the window navigates. In a fresh single-worker `php -S` snapshot, that path can trigger WP-Cron. Cron then makes an HTTP loopback request to the same local server and waits behind the current request until PHP times out. That was enough to send the Electron smoke test to `error.html`, even though the app loaded manually once the timeout cleared.

**Trade-off.** Desktop snapshots no longer run WP-Cron automatically. That is fine for the local single-user app: scheduled publishing, background update checks, and cron-style jobs are not part of the v1 desktop flow. Startup is more predictable without self-HTTP work.

**Revisit when.** Cortext desktop needs scheduled jobs, sync, import/export queues, or any feature that depends on WordPress cron semantics. If that happens, use an explicit job runner or a separate controlled process. Do not hang it off startup readiness.

## 2026-05-18 — Merge the desktop runtime baseline before deeper PHP tuning

**Decision.** Merge the runtime baseline first: bundled-PHP discovery, `php -S` workers, runtime flags, and the benchmark harness. Leave detailed benchmark results in the PR discussion and deeper PHP tuning for follow-up PRs.

**Why.** This branch already changes process lifecycle and packaging assumptions. It is enough to review on its own. The Library workflow bottleneck is request concurrency, and static PHP with `PHP_CLI_SERVER_WORKERS=4` gets the useful win without making FrankenPHP or PHP-FPM the default. The remaining ideas need separate proof: file cache changes cold/warm start behavior, APCu has coherency risk across workers, preload changes boot behavior, and JIT requires a new PHP build because the current static binary was compiled without OPcache JIT.

**Follow-up order.** After merge, measure each idea against the merged baseline:

- OPcache `file_cache` first, because it is runtime-configurable and does not need a PHP rebuild.
- Request/query profiling for the Library workflow before adding object cache, so we know whether APCu is fixing real repeated reads or just adding cache coherency risk across CLI server workers.
- Preload or targeted `opcache_compile_file()` only after the hot PHP files are known from profiling.
- A JIT-enabled PHP rebuild last. If tested, verify `opcache_get_status()['jit']['buffer_used'] > 0` after warmup and measure memory at 4 and 8 workers.

**Not in this branch.** Do not make FrankenPHP the default, do not switch v1 desktop back to Playground/WASM, and do not bundle PHP-FPM/Caddy unless a follow-up benchmark shows a real Library workflow win that justifies the packaging cost.

**Trade-off.** This branch is not the final performance ceiling. Follow-up work should measure each optimization independently and keep only changes that move the real Library workflow. Single-endpoint p50 wins are not enough.

**Revisit when.** The runtime baseline is merged, the PHP bundle build is automated for supported architectures, or the Library workflow is still too slow after worker concurrency is enabled.

## 2026-05-15 — Desktop keeps `php -S`, but PHP bundling needs a tuned build

**Decision.** Keep `php -S` as the default desktop runtime. The app and snapshot builder now prefer `apps/desktop/runtime/bin/php` when present, so a signed app can run without PHP installed on the user's machine. The current packaging candidate is a custom static PHP 8.5 CLI bundle with OPcache and `CORTEXT_PHP_CLI_SERVER_WORKERS=4`. FrankenPHP worker mode and PHP-FPM + Caddy stay as spike paths behind `CORTEXT_RUNTIME`.

**Why.** The local benchmark runs did not give us a reason to leave `php -S`. Endpoint timings were close across system PHP, bundled static PHP, and PHP-FPM + Caddy. FrankenPHP did not win the endpoint benchmark either, though it helped show the real issue: Library hydrates several DataViews, and row detail opens trigger more requests. One-worker `php -S` serializes too much of that burst. `PHP_CLI_SERVER_WORKERS=4` gives the static PHP CLI bundle the needed concurrency without Caddy or a long-running WordPress worker. The detailed numbers live in the PR discussion rather than committed docs.

Reviewers can exercise the bundled paths without committing binaries by running `npm --prefix apps/desktop run runtime:php` or `npm --prefix apps/desktop run runtime:franken`; both commands write ignored files under `apps/desktop/runtime/bin/`.

**Trade-off.** Desktop still needs a reproducible PHP artifact before signed/notarized distribution. The packaging PR should build the custom PHP CLI for arm64 and x64, verify checksums, copy the selected binary into the Electron bundle, and run the smoke test on a machine without PHP on `PATH`.

**Revisit when.** The custom PHP bundle regresses on another architecture, a WordPress-safe worker adapter exists, FrankenPHP publishes a smaller/checksummed macOS bundle, or a static PHP-FPM bundle proves substantially faster with production-equivalent PHP binaries.

## 2026-05-15 — Desktop app runs on native PHP, not Playground

**Decision.** The Electron desktop app starts the bundled site with `php -S` and a `wp-content/db.php` SQLite drop-in. It no longer starts `wp-playground-cli`. The build pipeline downloads and installs WordPress directly with wp-cli, then activates the plugin and seeds demo data.

**Why.** On the same machine and workspace, Playground REST endpoints took ~600-1000 ms per request. Native PHP took ~30-60 ms. Shell paint dropped from ~1 s to ~80 ms. With the seed dataset open in DataViews, that is the difference between "this needs work" and "this is fine".

**Trade-off.** The desktop app needs PHP at runtime. In development that can be `apps/desktop/runtime/bin/php`, `CORTEXT_PHP_BIN`, or `php` on `PATH`. The signed app should bundle PHP per architecture.

**Revisit when.** We bundle PHP for distribution, or another runtime gives us the same packaging story without giving up native-PHP performance.
