# Release process

Cortext builds release notes from GitHub milestones. For now the release flow is
small on purpose; we can add ceremony once there is a real cadence to protect.

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

Every PR included in a release needs exactly one `type:*` label:

-   `type: enhancement` for product changes, including new features and
    improvements to existing behavior
-   `type: bug`
-   `type: docs`
-   `type: tooling` for CI, release, packaging, scripts, dependencies, and
    repo automation
-   `type: code quality` for refactors, cleanup, tests, and internal structure

Use `release: skip` for PRs that should not be assigned to the active release
milestone. A skipped PR does not need a `type:*` label.

Area labels are optional and do not affect release automation. Add them when
they make planning or filtering easier:

-   `area: desktop`
-   `area: performance`

## Automatic assignment

When a PR is merged into `main`, `.github/workflows/assign-release-milestone.yml`
assigns it to the single open milestone unless:

-   the PR already has a milestone, or
-   the PR has `release: skip`.

If there is no open milestone, or more than one, the workflow comments on the PR
and fails. If the PR does not have exactly one `type:*` label, it leaves a
comment so the changelog can be fixed before release time.

## Changelog preview

Preview the changelog locally:

```bash
pnpm run release:notes -- --milestone 0.1.0 --version 0.1.0 --strict
```

Save the changelog locally:

```bash
pnpm run release:notes -- --milestone 0.1.0 --version 0.1.0 --strict > .context/release-notes-0.1.0.md
```

Use `--strict` before drafting a release. It fails if any included PR is missing
a `type:*` label or has more than one.
