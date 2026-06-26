# Release process

Cortext builds release notes from GitHub milestones. The process is intentionally
small for now; we can add more steps once we have a regular release cadence.

## Milestones

-   Milestone titles are version numbers, starting with `0.1.0`.
-   Git tags and GitHub Release names use the same version number, without a
    leading `v`.
-   Milestones do not need due dates.
-   Keep exactly one non-patch release milestone open for the main line, such as
    `0.2.0`.
-   Patch milestones, such as `0.1.1`, may be open at the same time for hotfix
    releases.
-   After publishing a non-patch release, the workflow creates the next
    non-patch milestone, such as `0.3.0` after `0.2.0`. Patch releases do not
    create a next milestone.
-   After publishing a release, close its milestone.

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

Area labels are optional and group release notes within each `type:*` section.
PRs without exactly one supported area label appear under `Other`, so missing or
ambiguous areas do not block releases. Add area labels when they make planning,
filtering, or release notes easier:

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
assigns it to the single open non-patch milestone unless:

-   the PR already has a milestone, or
-   the PR has `release: skip`.

If there is no open non-patch milestone, or more than one, the workflow comments
on the PR and fails. Patch and hotfix PRs should be assigned to their patch
milestone manually before merge.

`.github/workflows/enforce-pr-labels.yml` also checks open PRs before merge. It
fails if a ready PR has zero `type:*` labels or more than one.

## Changelog preview

By default, release notes are the public changelog. They include user-facing
enhancements and bug fixes, and leave docs, tooling, and code quality changes
out of the published notes. Notes are grouped by `type:*` first, then by
`area:*`, with unclassified entries under `Other`.

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
(`.github/workflows/release.yml`). It takes a `milestone`, a `prerelease` flag,
and a `dry_run` flag. The milestone is the release version, such as `0.1.1` or
`0.2.0`, and it must already exist and be open. Run it with `dry_run` on first:
that applies the version bump inside the checkout, builds the plugin ZIP, and
uploads the release notes without creating a commit, tag, or Release, and
without closing the milestone or creating a next milestone. Turn `dry_run` off
to commit the version bump, push it to the selected branch, and publish a draft
Release.

"Prepare release" first updates the plugin header, `CORTEXT_VERSION`,
`readme.txt` stable tag, root package version, and desktop package versions to
the requested milestone version. On a real release, it commits those changes as
`chore: bump release to <version>` before building. It then calls
`release-plugin.yml` against the bumped commit to build the plugin ZIP, validate
the milestone, write release notes, and create or update the draft GitHub
Release.

Buildkite owns the macOS desktop DMG. The release tag build signs, notarizes,
and staples the app, then uploads the DMG to the same draft Release.

If the DMG needs to be rebuilt, rerun the Buildkite release tag build rather
than starting a GitHub Actions workflow.

Both systems write to the same Release by tag, but only Buildkite uploads the
desktop artifact. The GitHub Actions run owns the title, notes, and plugin ZIP.

## Deploying to WordPress.org

After the GitHub Release is published, deploy that same ZIP to WordPress.org
SVN. SVN is only the distribution channel; GitHub stays the source of truth.

Preview the SVN deploy first:

```bash
pnpm run deploy:wporg -- --version <version>
```

Dry runs also work for an already-published version. If `tags/<version>` already
exists, the script stages a local `tags/__dry-run-<version>` copy so the rest of
the flow can still be checked without touching the real tag.

If the status output looks right, publish it:

```bash
pnpm run deploy:wporg -- --version <version> --commit --username <wporg-user>
```

The "Deploy to WordPress.org SVN" workflow runs the same script. It always runs
a dry-run job first. If `commit` is `true`, a separate publish job uses the
`wordpress-org` GitHub environment, where `WPORG_USERNAME` and `WPORG_PASSWORD`
live as environment secrets. Configure that environment with required reviewers
and restrict it to `main` before using it for real releases.

The script downloads the GitHub Release ZIP, syncs it into `trunk/`, copies
`assets/wordpress-org/` into the SVN assets directory, removes deleted SVN
entries, creates `tags/<version>`, and checks that the plugin header,
`CORTEXT_VERSION`, and stable tag all match. For non-interactive use, set
`WPORG_USERNAME` and `WPORG_PASSWORD`.

When a release succeeds, the workflow closes the released milestone. If it is a
non-patch release, it also creates the next non-patch milestone if it does not
already exist. For example, `2.0.0` creates `2.1.0` and `0.2.0` creates
`0.3.0`. A patch release such as `0.1.1` closes `0.1.1` but does not create a
next milestone.

## Desktop app

The desktop release builds a signed, notarized arm64 macOS app with
electron-builder. Buildkite attaches the DMG to the same Release as the plugin
ZIP, along with `latest-mac.yml` and the signed `*-mac.zip` that Squirrel.Mac
installs. Release notes should tell people to move Cortext to Applications;
in-place updates depend on that.

The installed app checks the latest published GitHub Release on launch and every
few hours after that. When a newer version is available, it downloads it in the
background and asks the user to restart. Draft Releases are ignored. After an app
update, Cortext refreshes the bundled WordPress and plugin code in the user's
extracted site while keeping the database and uploads.
