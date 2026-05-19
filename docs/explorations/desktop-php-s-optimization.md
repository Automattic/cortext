# Exploration: Desktop `php -S` optimization

Issue: #205

This exploration keeps the Desktop runtime on `php -S` and adds opt-in hooks
for the runtime ideas from #205: APCu-backed object cache, OPcache file cache,
preload, JIT, and PCRE JIT. None of these change the default runtime unless the
matching environment flag is set.

## Runtime flags

Baseline command used for most runs:

```sh
CORTEXT_RUNTIME=php \
CORTEXT_PHP_BIN=apps/desktop/runtime/bin/php \
CORTEXT_PHP_CLI_SERVER_WORKERS=4 \
npm --prefix apps/desktop start
```

Runtime flags used in this exploration:

- `CORTEXT_PHP_OPCACHE_FILE_CACHE=1`: starts `php -S` with
  `opcache.file_cache` under the runtime state directory.
- `CORTEXT_PHP_PRELOAD=1`: starts `php -S` with
  `opcache.preload=<site>/cortext-preload.php`.
- `CORTEXT_PHP_JIT=1`: enables OPcache JIT for the process with
  `opcache.jit=tracing` and `opcache.jit_buffer_size=64M` unless overridden
  by `CORTEXT_PHP_JIT_MODE` or `CORTEXT_PHP_JIT_BUFFER_SIZE`.
- `CORTEXT_DESKTOP_OBJECT_CACHE=apcu`: copies the APCu exploration
  `object-cache.php` drop-in into the runtime site before PHP starts. When
  unset, the runtime removes this drop-in if it previously copied it.
- `CORTEXT_DESKTOP_RUNTIME_PROBE=1`: exposes
  `/?rest_route=/cortext-desktop/v1/runtime-probe` for engagement checks.

Build the local PHP bundle with APCu and JIT support:

```sh
CORTEXT_STATIC_PHP_EXPERIMENTAL=1 npm --prefix apps/desktop run runtime:php -- --force --rebuild
```

Narrower build flags:

- `CORTEXT_STATIC_PHP_APCU=1`: include APCu.
- `CORTEXT_STATIC_PHP_JIT=1`: keep OPcache JIT support instead of building
  with `--disable-opcache-jit`.

## Engagement checks

Run with `CORTEXT_DESKTOP_RUNTIME_PROBE=1`, then fetch:

```sh
curl -s 'http://127.0.0.1:9402/?rest_route=/cortext-desktop/v1/runtime-probe'
```

The probe should show:

- File cache: `opcache.file_cache` is non-empty and
  `opcache.file_cache_files > 0` after warmup.
- Preload: `opcache.preload` points at `cortext-preload.php`, and
  `opcache.preload_marker.compiled_count > 0`.
- APCu: `apcu.extension_loaded`, `apcu.apc_enabled`,
  `apcu.apc_enable_cli`, and `apcu.store_succeeded` are true.
- Object cache: `object_cache.using_external_object_cache` is true and
  `object_cache.class` is `Cortext_Desktop_APCu_Object_Cache`.
- JIT: `opcache.jit_enabled` is true and `opcache.jit_buffer_used > 0`
  after warmup.
- PCRE JIT: `php.pcre_jit` is true.

For APCu/object-cache persistence, call the probe twice. The second response
should report `apcu.previous_value_found=true` and
`object_cache.previous_value_found=true`.

## Benchmark matrix

Restore the archived workflow benches into `.context/` before running:

```sh
cp /Users/priethor/conductor/archived-contexts/cortext/beirut/bench-desktop-library-workflow.cjs .context/
cp /Users/priethor/conductor/archived-contexts/cortext/beirut/bench-desktop-e2e.cjs .context/
```

The current workspace has those copies at:

- `.context/bench-desktop-library-workflow.cjs`
- `.context/bench-desktop-e2e.cjs`

Run useful variants with:

```sh
npm --prefix apps/desktop run bench:runtime -- --runtime=php --iterations=50 --warmup=10 --label=<variant>
node .context/bench-desktop-library-workflow.cjs 5 <variant>
node .context/bench-desktop-e2e.cjs 5 <variant>
```

Suggested variants:

| Variant | Extra environment |
| --- | --- |
| `baseline-static-workers4` | `CORTEXT_PHP_CLI_SERVER_WORKERS=4` |
| `file-cache-workers4` | baseline + `CORTEXT_PHP_OPCACHE_FILE_CACHE=1` |
| `apcu-bundle-no-features-workers4` | rebuilt PHP only, no feature flags |
| `object-cache-workers4` | rebuilt PHP + `CORTEXT_DESKTOP_OBJECT_CACHE=apcu` |
| `preload-workers4` | baseline + `CORTEXT_PHP_PRELOAD=1` |
| `jit-workers4` | rebuilt PHP + `CORTEXT_PHP_JIT=1` |
| `composed-workers4` | only the variants that pass the decision thresholds |

## Decision thresholds

- Keep object cache if it gets the Library workflow under 1.5s p50, or close
  enough to be worth keeping.
- Keep `opcache.file_cache` if cold launch improves by more than 100ms.
- Keep preload only if it still adds more than 5ms p50 after object cache and
  file cache.
- Keep JIT only if DataView endpoints improve by more than 5% and add less
  than 300MB total RSS.
- If the composed result still leaves the Library workflow above 1.5s p50,
  reopen the worker-runtime investigation with this better baseline.

## Results log

Prior baseline from PR #203:

| Runtime | Workers | Total to opened row p50 | p95 | Open Library p50 | Open row p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bundled PHP, `php -S` | 2 | 3029.6 ms | 3583.5 ms | 1137.3 ms | 474.1 ms |
| Bundled PHP, `php -S` | 4 | 2996.7 ms | 3182.6 ms | 1198.8 ms | 340.9 ms |
| Bundled PHP, `php -S` | 8 | 2818.5 ms | 3435.0 ms | 1114.0 ms | 308.6 ms |
| FrankenPHP worker | n/a | 2832.6 ms | 3253.7 ms | 1108.2 ms | 346.3 ms |

Local bundled PHP matrix from 2026-05-18, using 4 PHP CLI server workers. Every
row forces `apps/desktop/runtime/bin/php`; none of these numbers use the
Homebrew/system PHP.

Artifacts:

- `.context/bench-results/*-http.json`
- `.context/bench-results/*-library.json`
- `.context/bench-results/*-e2e.json`
- `.context/bench-results/engagement-*.json`
- `.context/bench-results/rss-*.json`
- `.context/bench-results/summary.json`

| Variant | DataView HTTP avg p50 | Launch p50 | Open Library p50 | Open row p50 | Total to row p50 | Total to row p95 | RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline static bundle | 54.6 ms | 1440.8 ms | 1213.5 ms | 323.0 ms | 2989.4 ms | 3454.5 ms | n/a |
| `opcache.file_cache` | 57.2 ms | 1288.0 ms | 1215.1 ms | 761.7 ms | 3147.6 ms | 4387.4 ms | n/a |
| `opcache.preload` | 57.6 ms | 1471.4 ms | failed | failed | failed | failed | n/a |
| APCu/JIT-capable bundle, no flags | 52.1 ms | 1320.1 ms | 1302.0 ms | 375.3 ms | 3184.4 ms | 3355.8 ms | 181.5 MB |
| APCu object cache | 16.5 ms | 2610.9 ms | 673.3 ms | 272.7 ms | 3551.1 ms | 3628.4 ms | 182.7 MB |
| JIT | 36.5 ms | 1535.6 ms | 1182.0 ms | 205.1 ms | 2876.9 ms | 3620.7 ms | 227.5 MB |
| File cache + object cache + JIT | 14.6 ms | 2426.0 ms | 682.8 ms | 265.7 ms | 3405.6 ms | 3440.5 ms | 135.9 MB |

## Engagement log

Engagement checks came from the runtime probe against the bundled PHP 8.5.6
APCu/JIT-capable binary:

- File cache: `opcache.file_cache` pointed at the runtime state directory and
  `opcache.file_cache_files=490`.
- Preload: `opcache.preload` pointed at `cortext-preload.php`, with
  `preload_compiled_count=32` and `preload_failed_count=0`.
- APCu object cache: `apcu.extension_loaded=true`, `apcu.apc_enable_cli=true`,
  `apcu.store_succeeded=true`,
  `object_cache.class=Cortext_Desktop_APCu_Object_Cache`, and the second probe
  returned both APCu and object-cache previous values.
- JIT: `opcache.jit=tracing`, `opcache.jit_enabled=true`,
  `opcache.jit_on=true`, and `php.pcre_jit=true`.
- RSS after a 30x endpoint warmup: APCu/JIT-capable no-flags bundle was
  181.5 MB; JIT was 227.5 MB, for a +46.0 MB delta.

## First Compact Run

These were the first calls from the compact 5-iteration matrix. The larger seed
and longer-session runs below are a better basis for the call because they split
the one-time launch cost from repeated Library/DataView navigation.

- Keep JIT as a candidate. DataView endpoint p50 improved by about 30% versus
  the APCu/JIT-capable bundle without flags, and RSS stayed well under the
  +300 MB limit. It also had the best `total_to_row` p50 in this run, though
  launch-to-shell regressed versus the no-flags APCu/JIT-capable bundle.
- Do not keep APCu object cache based on this run alone. It cut REST endpoint
  latency and the Library page hydration time sharply, but launch-to-shell more
  than erased that win and `total_to_row` stayed above baseline.
- Do not keep preload from this pass. The engagement check passed, but the
  Library workflow produced 0/5 usable samples because the Library sidebar item
  never appeared.
- Treat `opcache.file_cache` as inconclusive here. Launch p50 improved by
  152.8 ms, which clears the cold-start threshold in this run, but HTTP and
  Library workflow p50 regressed and p95 was noisy. It needs a repeat before
  becoming a default.
- Do not keep the composed result from this run. It produced the best endpoint
  p50s but launch-to-shell regressed enough that the Library workflow remained
  at 3405.6 ms p50.

At this point the best measured `total_to_row` p50 was still 2876.9 ms with
JIT, well above the 1.5s target. The later runs changed the recommendation.

## Object Cache Break-Even

The 5-iteration UI run was too noisy to make a call on object cache. I repeated
it with 20 launch/workflow samples and 30 warm-session interactions, still on
the bundled APCu/JIT-capable PHP binary.

Artifacts:

- `.context/bench-results/apcu-jit-bundle-no-flags-workers4-ui20-library.json`
- `.context/bench-results/apcu-jit-bundle-no-flags-workers4-ui20-e2e.json`
- `.context/bench-results/apcu-jit-bundle-no-flags-workers4-warm30.json`
- `.context/bench-results/apcu-jit-bundle-no-flags-workers4-warm-nav30.json`
- `.context/bench-results/object-cache-workers4-ui20-library.json`
- `.context/bench-results/object-cache-workers4-ui20-e2e.json`
- `.context/bench-results/object-cache-workers4-warm30.json`
- `.context/bench-results/object-cache-workers4-warm-nav30.json`
- `.context/bench-results/ui20-warm-object-cache-summary.json`

| Variant | Launch p50 | Open Library p50 | Open row p50 | Total to row p50 | Warm row cycle p50 | Warm return-to-Library p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| APCu/JIT-capable bundle, no flags | 1442.3 ms | 1151.1 ms | 473.0 ms | 3091.1 ms | 259.4 ms | 840.7 ms |
| APCu object cache | 2656.1 ms | 725.9 ms | 286.4 ms | 3706.9 ms | 256.8 ms | 706.0 ms |

Object cache adds about 1213.8 ms to launch p50 in this run. It saves about
425.2 ms on a fresh Library load and 134.7 ms on a warm return to Library after
navigating away to the welcome page. Warm row open/close cycles are nearly
flat: 259.4 ms p50 without object cache and 256.8 ms p50 with object cache.

That makes the tradeoff depend on the session:

- For the first launch-to-row workflow, object cache does not pay for itself:
  total-to-row is 615.8 ms slower.
- For repeated Library/DataView page loads, the launch tax breaks even after
  roughly three fresh Library loads, or roughly ten warm return-to-Library
  navigations after the app is already open.
- For repeated row open/close on an already-loaded Library page, there is no
  win to measure.

This made object cache worth keeping in the investigation, but not enough to
call it the default yet. The later full/perf seed runs are the stronger signal.

## Deep Navigation Follow-Up

Added `.context/bench-desktop-library-deep-navigation.cjs` to cover an open app
session closer to normal use:

- open 8 distinct Library rows by title instead of toggling the same row;
- create one Library row between row navigation and page navigation;
- navigate 13 distinct sidebar pages, including normal pages plus the Library
  and Music Catalog DataView pages.

Artifacts:

- `.context/bench-results/apcu-jit-bundle-no-flags-workers4-deep-nav.json`
- `.context/bench-results/object-cache-workers4-deep-nav.json`
- `.context/bench-results/deep-nav-summary.json`

| Variant | Launch | First Library | Distinct row p50 | Distinct row p95 | Create row | 13-page nav p50 | 13-page nav p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| APCu/JIT-capable bundle, no flags | 1451.7 ms | 1199.4 ms | 331.3 ms | 1002.6 ms | 423.8 ms | 139.8 ms | 1876.3 ms |
| APCu object cache | 2779.0 ms | 938.5 ms | 355.3 ms | 381.5 ms | 699.5 ms | 537.3 ms | 3159.4 ms |

This compact-seed navigation test still did not justify object cache as a
default. The larger dataset runs below changed that read: the perf-sized
Library row path benefits much more from APCu.

## Seed Size and JIT Follow-Up

Added two local helpers for the larger dataset matrix:

- `.context/run-desktop-seed-matrix.sh`
- `.context/summarize-desktop-seed-matrix.cjs`

The runner restores a saved snapshot before each block and always uses the
bundled PHP binary with four `php -S` workers. Saved snapshots:

- `.context/snapshots/snapshot-full-seed.zip`
- `.context/snapshots/snapshot-full-plus-perf-seed.zip`

The full+perf snapshot starts from `wp cortext seed --full`, then adds
`wp cortext perf-seed --reset --force`, which creates three benchmark
collections with 1250 rows each.

Artifacts:

- `.context/bench-results/full-seed-*-workers4-*.json`
- `.context/bench-results/full-perf-seed-*-workers4-*.json`
- `.context/bench-results/seed-matrix-summary.json`

| Dataset / variant | HTTP avg p50 | Launch p50 | Open Library p50 | Open row p50 | Total to row p50 | Warm return Library p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Compact, no flags | 53.5 ms | 1442.3 ms | 1151.1 ms | 473.0 ms | 3091.1 ms | 840.7 ms |
| Compact, APCu object cache | 18.4 ms | 2656.1 ms | 725.9 ms | 286.4 ms | 3706.9 ms | 706.0 ms |
| Full, no flags | n/a | 1424.5 ms | 1386.4 ms | 916.3 ms | 4238.8 ms | 1110.2 ms |
| Full, APCu object cache | n/a | 2657.4 ms | 964.8 ms | 428.3 ms | 4216.6 ms | 1083.6 ms |
| Full, JIT | 43.2 ms | 1600.7 ms | 1209.3 ms | 415.5 ms | 3359.8 ms | 869.4 ms |
| Full, APCu object cache + JIT | 19.6 ms | 2868.6 ms | 1079.6 ms | 460.4 ms | 4429.2 ms | 1149.8 ms |
| Full+perf, no flags | 75.9 ms | 1447.1 ms | 1438.9 ms | 1742.1 ms | 4680.9 ms | 933.1 ms |
| Full+perf, APCu object cache | 21.7 ms | 2671.0 ms | 996.2 ms | 437.1 ms | 4295.1 ms | 1132.1 ms |
| Full+perf, JIT | 53.9 ms | 1632.3 ms | 1260.1 ms | 574.0 ms | 3568.4 ms | 1111.7 ms |
| Full+perf, APCu object cache + JIT | 20.0 ms | 2869.0 ms | 1098.6 ms | 450.4 ms | 4391.5 ms | 1117.4 ms |

The larger datasets changed the read:

- Database size does not move launch much without object cache:
  compact/full/full+perf stayed around 1.4-1.45s p50.
- Database size does change Library and row work. Full seed added about
  1.15s to the launch-to-row workflow versus compact. Adding the perf dataset
  pushed no-flags row open from 916.3 ms to 1742.1 ms p50.
- Treat the APCu launch cost as acceptable for the Desktop app. It is paid once
  per session, while Library/DataView navigation is repeated during normal use.
- With launch excluded, APCu object cache has the best measured effect on the
  Library workflow. On full seed, Library+row p50 is 1393.1 ms with APCu
  versus 2302.7 ms with no flags and 1624.8 ms with JIT. On full+perf seed,
  Library+row p50 is 1433.2 ms with APCu versus 3180.9 ms with no flags and
  1834.1 ms with JIT.
- APCu also gives the fastest endpoint p50s, cuts full+perf row open from
  1742.1 ms to 437.1 ms, and is the only variant that avoided the Music
  Catalog timeout without also enabling JIT.
- APCu object cache + JIT did not compose well before adding
  `opcache.file_cache`. It kept the best endpoint p50s, but was slightly worse
  than APCu-only for the post-launch Library+row workflow on both full and
  full+perf seeds.
- Music Catalog is the warning sign in the perf-sized database. In deep
  navigation, `full-perf-seed` no-flags and JIT-only timed out waiting for
  `Abbey Road` after 120s. APCu object cache and APCu+JIT loaded Music Catalog
  in about 4.4-4.5s. JIT-only on full seed also produced one extreme
  Music Catalog sample at 98.3s. Treat the deep-session totals for these rows
  as timeout diagnostics, not normal p50 session timing.

### Full OPcache File Cache Matrix

The file-cache follow-up used the same full and full+perf snapshots, still
forcing `apps/desktop/runtime/bin/php` and four `php -S` workers. It tested
`opcache.file_cache` by itself and with APCu object cache and JIT. The table
also repeats the earlier JIT-only and APCu+JIT rows so the comparison is in one
place.

Artifacts:

- `.context/bench-results/full-seed-file-cache-*-workers4-*.json`
- `.context/bench-results/full-perf-seed-file-cache-*-workers4-*.json`
- `.context/bench-results/seed-matrix-summary.json`

Full seed:

| Variant | HTTP avg p50 | Launch p50 | Library+row p50 | Total to row p50 | Warm return Library p50 | Deep nav total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| No flags | n/a | 1424.5 ms | 2302.7 ms | 4238.8 ms | 1110.2 ms | 21591.0 ms |
| APCu object cache | n/a | 2657.4 ms | 1393.1 ms | 4216.6 ms | 1083.6 ms | 20327.1 ms |
| JIT | 43.2 ms | 1600.7 ms | 1624.8 ms | 3359.8 ms | 869.4 ms | 112042.7 ms |
| APCu object cache + JIT | 19.6 ms | 2868.6 ms | 1540.1 ms | 4429.2 ms | 1149.8 ms | 21764.3 ms |
| File cache | 59.0 ms | 1234.1 ms | 1946.7 ms | 3927.1 ms | 1130.5 ms | 137113.0 ms |
| File cache + APCu object cache | 21.8 ms | 2445.6 ms | 1433.6 ms | 3903.3 ms | 1093.3 ms | 19046.7 ms |
| File cache + JIT | 40.0 ms | 1231.4 ms | 1865.5 ms | 3334.9 ms | 1108.7 ms | 137736.0 ms |
| File cache + APCu object cache + JIT | 19.7 ms | 2449.7 ms | 1436.8 ms | 3902.5 ms | 1095.3 ms | 21161.7 ms |

Full+perf seed:

| Variant | HTTP avg p50 | Launch p50 | Library+row p50 | Total to row p50 | Warm return Library p50 | Deep nav total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| No flags | 75.9 ms | 1447.1 ms | 3180.9 ms | 4680.9 ms | 933.1 ms | 138073.1 ms |
| APCu object cache | 21.7 ms | 2671.0 ms | 1433.2 ms | 4295.1 ms | 1132.1 ms | 20828.6 ms |
| JIT | 53.9 ms | 1632.3 ms | 1834.1 ms | 3568.4 ms | 1111.7 ms | 134387.9 ms |
| APCu object cache + JIT | 20.0 ms | 2869.0 ms | 1549.0 ms | 4391.5 ms | 1117.4 ms | 21088.0 ms |
| File cache | 75.8 ms | 1170.7 ms | 2979.5 ms | 4342.5 ms | 883.1 ms | 23842.1 ms |
| File cache + APCu object cache | 21.0 ms | 2400.4 ms | 1338.9 ms | 3733.9 ms | 847.7 ms | 19751.0 ms |
| File cache + JIT | 51.4 ms | 1186.3 ms | 2909.4 ms | 4186.5 ms | 871.7 ms | 21743.9 ms |
| File cache + APCu object cache + JIT | 18.9 ms | 2411.9 ms | 1286.8 ms | 3713.3 ms | 777.8 ms | 18135.6 ms |

File-cache takeaways:

- `opcache.file_cache` engagement passed: the runtime probe reported
  a non-empty file-cache directory and `opcache.file_cache_files=490` after
  warmup.
- `opcache.file_cache` alone clears the cold-launch threshold. It improved
  full launch by 190.4 ms and full+perf launch by 276.3 ms versus no flags.
  It should not be kept alone for the Library workflow, though: post-launch
  Library+row stayed at 1946.7 ms on full seed and 2979.5 ms on full+perf.
- `opcache.file_cache + APCu object cache` is worth keeping in the candidate
  stack. On full+perf it improved APCu-only Library+row from 1433.2 ms to
  1338.9 ms and warm return-to-Library from 1132.1 ms to 847.7 ms, while also
  lowering launch by 270.5 ms versus APCu-only.
- `opcache.file_cache + JIT` is not useful without APCu for the Library
  workflow. It keeps launch low, but full+perf Library+row stayed at
  2909.4 ms.
- `opcache.file_cache + APCu object cache + JIT` was the best full+perf
  session result: 1286.8 ms Library+row p50, 777.8 ms warm return-to-Library
  p50, and the lowest endpoint p50. On full seed it was roughly tied with
  file-cache + APCu object cache, so JIT matters most on the larger perf-sized
  dataset.

### Bundle Size Impact

Measured by rebuilding the bundled PHP binary four times with the same
static-php-cli version and PHP 8.5.6, then saving each binary under
`.context/php-bundle-size/`.

| Build | Raw PHP binary | Raw delta | gzip size | gzip delta |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 30.06 MB | 0.00 MB | 9.08 MB | 0.00 MB |
| APCu | 30.10 MB | +0.04 MB | 9.10 MB | +0.02 MB |
| JIT | 30.71 MB | +0.65 MB | 9.39 MB | +0.31 MB |
| APCu + JIT | 30.77 MB | +0.71 MB | 9.41 MB | +0.33 MB |

Other size notes:

- `opcache.file_cache` adds no binary size. It creates runtime cache files in
  the app state directory.
- `object-cache-apcu.php` is 12 KB.
- Preload support files are about 8 KB total.
- The runtime probe mu-plugin is about 8 KB. I would keep it exploration-only
  unless we decide we want a hidden diagnostic endpoint.

### Before Making This Default

Before making `opcache.file_cache + APCu object cache + JIT` the default:

- Repeat the full+perf hard matrix at least once more from a clean machine state,
  because file-cache UI wins are plausible but not as structurally obvious as
  APCu's HTTP/DataView wins.
- Capture RSS for the final composed variant after the HTTP warmup and after
  the deep navigation test. The compact JIT delta was only +46.0 MB, but the
  final call should use the same dataset as the winning UI result.
- Keep the engagement checks in CI or in a manual smoke script: file cache has
  files, APCu object cache persists between probe calls, JIT is enabled and
  uses buffer, and PCRE JIT stays on.
- Run the Desktop smoke test with the final composed flags, then manually
  verify launch, autologin, restart, persisted rows/pages, and clearing the
  runtime state directory.
- Verify cache lifecycle across app update/snapshot replacement. File cache
  must be safe to clear, and stale bytecode must not survive a runtime or app
  code update.
- If shipping a universal macOS bundle, repeat the final engagement and smoke
  checks on both Apple Silicon and Intel binaries.

### Preload Retest

The first preload manifest mixed WordPress core files, the Cortext plugin
entrypoint, and Cortext classes. Its engagement check passed, but the Desktop
UI stayed blank. Local UI diagnostics showed the admin page loading with missing
WordPress JS globals:

- `wp is not defined`
- `jQuery is not defined`
- `Cannot read properties of undefined (reading 'hooks')`
- `Cannot read properties of undefined (reading '__')`

Removing `wp-content/plugins/cortext/cortext.php` was not enough. A safer
Cortext-only manifest, with no `wp-includes/*` files and no plugin entrypoint,
fixed the blank page and produced a clean preload engagement check:

- `preload_compiled_count=17`
- `preload_failed_count=0`
- APCu object cache persisted across probe calls

That still did not help performance. The full+perf matrix against the current
best stack (`opcache.file_cache + APCu object cache + JIT`) regressed:

| Variant | HTTP avg p50 | Launch p50 | Library+row p50 | Total to row p50 | Warm return Library p50 | Deep nav total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| File cache + APCu object cache + JIT | 18.9 ms | 2411.9 ms | 1286.8 ms | 3713.3 ms | 777.8 ms | 18135.6 ms |
| File cache + APCu object cache + JIT + preload | 19.9 ms | 2503.0 ms | 1513.3 ms | 3994.6 ms | 1124.0 ms | 23809.6 ms |

The takeaway is narrow: manual preloading of WordPress core is unsafe in this
setup, and a safe Cortext-only manifest does not improve the best stack. Do not
keep preload for this iteration.

Current recommendation:

- Keep APCu object cache as the main Desktop-session optimization. With the
  one-time launch cost treated as acceptable, APCu is the change that moves the
  repeated Library/DataView workflow under or near 1.5s p50 on full and
  full+perf seeds.
- Keep `opcache.file_cache + APCu object cache` as the lower-risk composed
  candidate. It improves full+perf Library+row to 1338.9 ms p50 and improves
  warm return-to-Library to 847.7 ms p50.
- Keep `opcache.file_cache + APCu object cache + JIT` as the fastest measured
  composed candidate for the perf-sized database. Review the JIT surface before
  making it the default. The measured RSS delta for JIT was only +46.0 MB in
  the compact matrix, but the final candidate should get its own RSS pass.
- Do not keep `opcache.file_cache` alone or `opcache.file_cache + JIT` for the
  Library workflow. They improve launch and sometimes avoid the worst deep-nav
  timeout, but they do not fix the repeated Library/DataView path.
- Do not keep preload. The original core+plugin manifest made the Desktop UI
  blank, and the safer Cortext-only manifest worked but regressed the winning
  full+perf stack.

## Verification

Checks run while adding and testing the exploration hooks:

- `node --check` passes for the edited Desktop runtime scripts and restored
  `.context` benchmark scripts.
- `php -l` passes for the runtime probe, APCu object-cache drop-in, and
  preload files.
- `git diff --check` passes.
- `npm --prefix apps/desktop run snapshot` succeeds and copies preload/probe
  runtime files into the Desktop snapshot.
- `npm --prefix apps/desktop run test:e2e` passes.
- `npm --prefix apps/desktop run runtime:php` builds the baseline bundled PHP
  8.5.6 binary.
- `CORTEXT_STATIC_PHP_EXPERIMENTAL=1 npm --prefix apps/desktop run runtime:php -- --force --rebuild`
  builds the bundled PHP 8.5.6 binary with APCu and OPcache JIT support.
- The full local matrix above ran with `apps/desktop/runtime/bin/php`; the
  archived `.context` benchmark scripts were adjusted locally so their prime
  phase also uses the selected bundled runtime instead of Homebrew PHP.
- `.context/run-desktop-seed-matrix.sh full-jit` and
  `.context/run-desktop-seed-matrix.sh perf-all` completed the full/full+perf
  seed matrix with no system PHP rows.
- `.context/run-desktop-seed-matrix.sh opcache-all` completed the full/full+perf
  `opcache.file_cache` hard matrix with no system PHP rows.
