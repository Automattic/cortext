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
-   Preparing a non-patch release creates the next non-patch milestone, such as
    `0.3.0` after `0.2.0`. Patch releases do not create a next milestone.
-   Preparing a release also closes its milestone. The cut is the version bump
    commit; PRs merged after that belong to the next milestone, even if the
    draft is still waiting to be published or deployed.

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

Once the draft looks right, publish it. Publishing a stable Release starts the
WordPress.org deploy.

## Deploying to WordPress.org

Publishing a stable GitHub Release deploys the release ZIP to WordPress.org
SVN. SVN is just the distribution channel; GitHub stays the source of truth.

The "Deploy to WordPress.org SVN" workflow listens for stable Releases.
Prereleases do not start the automatic deploy. If you later promote a
prerelease to a stable Release, the deploy runs then. Before touching SVN, the
workflow checks the version format, confirms the Release is stable, and makes
sure `cortext.zip` is attached. Then it runs a dry run so you can inspect the
SVN status.

The actual SVN commit runs in a separate publish job behind the `wordpress-org`
GitHub environment. Store `WPORG_USERNAME` and `WPORG_PASSWORD` there as
environment secrets. The environment needs required reviewers, and it must allow
tag refs matching `*.*.*`; the workflow runs on the release tag, so a
branch-only environment rejects the publish job. Review the dry-run output
before approving.

You can still run the same workflow from the Actions tab for reruns and one-off
deploys. Pass a `version` and choose whether to set `commit`. Without `commit`,
the workflow stops after the dry run.

The script downloads the GitHub Release ZIP, syncs it into `trunk/`, copies
`assets/wordpress-org/` into the SVN assets directory, removes deleted SVN
entries, creates `tags/<version>`, and checks that the plugin header,
`CORTEXT_VERSION`, and stable tag all match. For non-interactive use, set
`WPORG_USERNAME` and `WPORG_PASSWORD`.

To preview the SVN deploy locally:

```bash
pnpm run deploy:wporg -- --version <version>
```

Dry runs also work for an already-published version. If `tags/<version>` already
exists, the script stages a local `tags/__dry-run-<version>` copy so the rest of
the flow can still be checked without touching the real tag.

To publish from your machine instead of GitHub Actions:

```bash
pnpm run deploy:wporg -- --version <version> --commit --username <wporg-user>
```

When we add another distribution channel, such as a desktop update feed, give it
its own workflow on the same release event.

## Desktop app

The desktop release builds a macOS DMG with electron-builder and attaches it to
the same Release as the plugin ZIP. The release build is arm64-only, signed, and
notarized by Buildkite. Release notes should tell people to move Cortext to
Applications.
The installed app checks GitHub Releases on launch and links to the download
when a newer version exists, but it does not update itself.
