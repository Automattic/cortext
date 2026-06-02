# Release process

Cortext builds release notes from GitHub milestones. The process is intentionally
small for now; we can add more steps once we have a regular release cadence.

## Milestones

-   Keep exactly one release milestone open at a time.
-   Milestone titles are version numbers, starting with `0.1.0`.
-   Git tags and GitHub Release names use the same version number, without a
    leading `v`.
-   Milestones do not need due dates.
-   After publishing a release, close its milestone and create the next one.

The first milestone is `0.1.0`.

## Versioning

Use the same version number for the plugin header, `readme.txt` stable tag,
milestone, Git tag, and GitHub Release name.

-   `0.1.0` is the first public beta.
-   `0.1.1` is a patch release for the `0.1` beta line.
-   `0.2.0` is the next beta with larger product changes.
-   `1.0.0` is the first stable release.
-   After `1.0.0`, use major releases such as `2.0.0` for incompatible changes.

While Cortext is in `0.x`, treat minor releases as beta release lines and patch
releases as fixes to the current beta.

## PR labels

Every PR needs exactly one `type:*` label:

-   `type: enhancement` for product changes, including new features and
    improvements to existing behavior
-   `type: bug`
-   `type: docs`
-   `type: tooling` for CI, release, packaging, scripts, dependencies, and
    repo automation
-   `type: code quality` for refactors, cleanup, tests, and internal structure

Use `release: skip` for PRs that should not be assigned to the active release
milestone. It only skips milestone assignment; the PR still needs one `type:*`
label.

Area labels are optional and do not affect release automation. Add them when
they make planning or filtering easier:

-   `area: canvas` for the block editor canvas, blocks, inspector, covers, and
    icons
-   `area: collections` for fields, rows, views, DataViews, relations, rollups,
    formulas, and row properties
-   `area: desktop`
-   `area: performance` for budgets, profiling, benchmarks, and regressions
-   `area: publishing` for public output through WordPress, templates, frontend
    block rendering, and theme-facing views
-   `area: shell` for the app shell, sidebar, routing, top bar, command palette,
    recents, favorites, trash, and layout

## Automatic assignment

When a PR is merged into `main`, `.github/workflows/assign-release-milestone.yml`
assigns it to the single open milestone unless:

-   the PR already has a milestone, or
-   the PR has `release: skip`.

If there is no open milestone, or more than one, the workflow comments on the PR
and fails.

`.github/workflows/enforce-pr-labels.yml` also checks open PRs before merge. It
fails if a ready PR has zero `type:*` labels or more than one.

## Changelog preview

By default, release notes are the public changelog. They include user-facing
enhancements and bug fixes, and leave docs, tooling, and code quality changes
out of the published notes.

Preview the changelog locally:

```bash
pnpm run release:notes -- --milestone 0.1.0 --version 0.1.0 --strict
```

Save the changelog locally:

```bash
pnpm run release:notes -- --milestone 0.1.0 --version 0.1.0 --strict > .context/release-notes-0.1.0.md
```

Preview the full milestone changelog when you want an internal audit:

```bash
pnpm run release:notes -- --milestone 0.1.0 --version 0.1.0 --strict --full
```

Use `--strict` before drafting a release. It fails if any milestone PR is
missing a `type:*` label or has more than one.

## Cutting a release

Releases run from the Actions tab, through the "Prepare release" workflow
(`.github/workflows/release.yml`). It takes a version, a `prerelease` flag, and
a `dry_run` flag. Run it with `dry_run` on first: that builds everything and
uploads the artifacts without creating a tag or a Release. Turn `dry_run` off to
publish a draft Release.

"Prepare release" only orchestrates. It calls two reusable workflows:

-   `release-plugin.yml` resolves the milestone, builds the changelog and the
    plugin ZIP, and creates the draft Release.
-   `release-desktop.yml` builds the bundled PHP and the snapshot, runs
    electron-builder, and attaches the macOS DMG.

Both write to the same Release by tag. Whichever runs first creates the draft,
and the other adds its artifact. The plugin run owns the title and notes; the
desktop run only uploads the DMG. You can also run either workflow on its own
from the Actions tab, which is handy for rebuilding just the DMG against a draft
that already exists.

## Desktop app

The desktop release builds a macOS DMG with electron-builder and attaches it to
the same Release as the plugin ZIP. The build is arm64-only and unsigned for
now, so macOS may show a "Cortext is damaged" warning the first time it opens.
Release notes should tell people to move Cortext to Applications. If the warning
appears, they should click Cancel, open Terminal, and run
`xattr -dr com.apple.quarantine /Applications/Cortext.app && open /Applications/Cortext.app`.
The installed app checks GitHub Releases on launch and links to the download
when a newer version exists, but it does not update itself.
