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
-   `type: tooling` for CI, release, packaging, scripts, and repo automation
-   `type: dependencies` for dependency updates
-   `type: code quality` for refactors, cleanup, tests, and internal structure

Use `release: skip` for PRs that should not be assigned to the active release
milestone. It only skips milestone assignment; the PR still needs one `type:*`
label.

Dependabot adds `type: dependencies` to its PRs, which groups them under the
Dependencies section in release notes.

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
fails if a ready PR has zero release-note type labels or more than one.

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

Leave `prerelease` off for a normal release. A Release marked as a prerelease
isn't deployed to WordPress.org and isn't offered to installed desktop apps;
people only get it by downloading it.

"Prepare release" first updates the plugin header, `CORTEXT_VERSION`,
`readme.txt` stable tag, root package version, and desktop package versions to
the requested milestone version. It also converts the public GitHub release
notes into WordPress readme markup and inserts the new version at the top of
`readme.txt`'s changelog. On a real release, it commits those changes as `chore:
bump release to <version>` before building. It then calls `release-plugin.yml`
against the bumped commit to build the plugin ZIP, validate the milestone,
write release notes, and create or update the draft GitHub Release. The ZIP
validation fails if either the stable tag or the versioned changelog entry is
missing.

The version-bump job authenticates with a write-enabled deploy key scoped to
this repository so it can push the release commit through the `main` ruleset.
Add `Deploy keys` to the `Protect main` ruleset bypass list with `Always allow`
and store the private key as the `RELEASE_DEPLOY_KEY` secret in the protected
`GitHub Releases` environment. The default `GITHUB_TOKEN` cannot bypass the
ruleset.

Once the draft exists, "Prepare release" pushes the version tag at the release
commit. Buildkite builds the macOS desktop app from that tag while the Release
is still a draft: it signs, notarizes, and staples the app, then attaches the
DMG and the auto-update feed (see [Desktop app](#desktop-app)). That takes about
an hour. Publishing the Release later reuses the tag, so it doesn't start a
second build. If you throw a draft away, delete its tag too; preparing the same
version again fails if the tag points at a different commit.

If the desktop app needs to be rebuilt, rerun the Buildkite release tag build
rather than starting a GitHub Actions workflow.

Both systems write to the same Release by tag, but only Buildkite uploads the
desktop files. The GitHub Actions run owns the title, notes, and plugin ZIP.

Wait until the draft has all the desktop files, then publish it. Publishing
earlier means installed apps find a Release without its update feed and can't
update. Don't leave the draft waiting either: Cortext 0.4.0 and earlier treat
the new tag as the latest version, so their update checks fail until the
Release is published. Publishing a stable Release starts the WordPress.org
deploy.

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

For a documentation-only correction after a version has already been published,
set `readme_only` as well. This updates only `readme.txt` in SVN `trunk` and the
existing `tags/<version>` directory; it does not replace plugin runtime files or
create another release tag. Review the dry run and approve the `wordpress-org`
environment as usual.

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

To stage a readme-only correction for an existing release:

```bash
pnpm run deploy:wporg -- --version <version> --readme-only
```

When we add another distribution channel, such as a desktop update feed, give it
its own workflow on the same release event.

## Desktop app

The desktop release builds a signed, notarized arm64 macOS app with
electron-builder. Buildkite attaches these files to the same Release as the
plugin ZIP:

-   `Cortext-<version>-arm64.dmg`, for first installs
-   `Cortext-<version>-arm64-mac.zip` and its `.blockmap`, which Squirrel.Mac
    installs on update
-   `latest-mac.yml`, the update feed that points apps at the zip

Release notes should tell people to move Cortext to Applications; in-place
updates depend on that.

Before uploading, every build checks that all four files exist. Branch and PR
builds run the same check and keep the files as Buildkite artifacts, but
upload nothing. On a tag build, the binaries go up first and `latest-mac.yml`
last, so apps never see a feed that points at files that aren't there yet.

Uploading needs a GitHub token that can write to `Automattic/cortext`. The mac
agent gets `GITHUB_TOKEN` from the pipeline's secrets, which Apps Infra manages
in `mobile-secrets` (`CI/secrets/cortext/env`). Never pass it through a build's
environment variables form. Tag builds check the token before installing
anything: if it's missing, can't push, or there is no Release for the tag yet,
the build fails in seconds with a message saying which.

If a tag build fails after the app was built, retry the upload without
rebuilding. Download the four files from the build's Artifacts tab (or with
`buildkite-agent artifact download "apps/desktop/dist/*" .`), then upload them
in this order:

```bash
gh release upload <version> Cortext-<version>-arm64.dmg \
  Cortext-<version>-arm64-mac.zip Cortext-<version>-arm64-mac.zip.blockmap \
  --repo Automattic/cortext --clobber
gh release upload <version> latest-mac.yml --repo Automattic/cortext --clobber
```

The installed app checks the latest published GitHub Release on launch and every
few hours after that. When a newer version is available, it downloads it in the
background and asks the user to restart. Drafts and prereleases are ignored, and
so is a tag whose Release isn't published yet. After an app
update, Cortext refreshes the bundled WordPress and plugin code in the user's
extracted site while keeping the database and uploads.
