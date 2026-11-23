#!/usr/bin/env bash

set -euo pipefail

# Build, sign, and notarize the Cortext desktop DMG.

# Release tag builds publish to the GitHub Release.
if [[ "${BUILDKITE_TAG:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  version="$BUILDKITE_TAG"
  publish=true
else
  base_version="$(python3 -c 'import json; print(json.load(open("apps/desktop/package.json"))["version"])')"
  version="${base_version}-${BUILDKITE_COMMIT:0:7}"
  publish=false
fi

# A tag build compiles, signs and notarizes the app before it uploads anything,
# so check up front that the upload can work.
if "$publish"; then
  echo "--- :closed_lock_with_key: check GitHub Release access"
  [[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]] || {
    echo "No GitHub token on this agent (GH_TOKEN or GITHUB_TOKEN). See docs/release.md."
    exit 1
  }
  # The repo is public, so a 200 alone proves nothing; ask whether the token can
  # push. `gh auth status` is no use here: installation tokens can't call /user.
  [[ "$(gh api repos/Automattic/cortext --jq .permissions.push)" == "true" ]] || {
    echo "The GitHub token on this agent can't write to Automattic/cortext."
    exit 1
  }
  # "Prepare release" creates the draft before it pushes the tag.
  gh release view "$version" --repo Automattic/cortext >/dev/null || {
    echo "No GitHub Release for $version. Run \"Prepare release\" first."
    exit 1
  }
fi

echo "--- :package: install JS + PHP dependencies"
corepack enable
corepack prepare "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" --activate
# The xcode-* agent image ships no composer; brew pulls php in as a dependency.
command -v composer >/dev/null || brew install composer
composer install --no-dev --optimize-autoloader --no-interaction
pnpm install --frozen-lockfile
npm --prefix apps/desktop ci

# Electron 42 skips the binary download during `npm ci`; fetch it so
# electron-builder packages a complete app.
( cd apps/desktop && npx install-electron )

echo "--- :hammer_and_wrench: install static-php-cli build toolchain"
# static-php-cli source-builds any library without a pre-built binary (e.g.
# libxml2), which the minimal agent image can't do unaided.
brew install cmake autoconf automake libtool bison re2c
export PATH="$(brew --prefix bison)/bin:$PATH"

echo "--- :php: build bundled arm64 PHP runtime"
# Compiling PHP takes two and a half minutes and 33 GitHub API calls, one per
# library it looks up. Unauthenticated those share a 60-an-hour cap with every
# other mac agent, so busy afternoons fail on a 403 nobody caused.
#
# The binary depends on nothing but this installer, which pins both versions and
# lists the extensions, so its hash is a safe key. A restored binary still gets
# checked: install-runtime.mjs skips the build but verifies what it found. If
# the agent has no cache bucket, both commands fail and PHP builds as usual.
php_cache_key="cortext-php-$(uname -m)-$(hash_file apps/desktop/scripts/install-runtime.mjs)"
restore_cache "$php_cache_key" || echo "Cache restore unavailable; building PHP."
npm --prefix apps/desktop run runtime:php
save_cache apps/desktop/runtime/bin/php "$php_cache_key" || echo "Cache save unavailable."

echo "--- :card_index_dividers: build distribution snapshot"
CORTEXT_DESKTOP_DISTRIBUTION=1 npm --prefix apps/desktop run snapshot

echo "--- :key: install Developer ID cert into the agent keychain"
( cd apps/desktop && install_gems && bundle exec fastlane set_up_signing )

echo "--- :apple: build, sign, notarize DMG"
# electron-builder signs from the match-installed keychain cert (mac.identity)
# and notarizes via its built-in @electron/notarize, driven by APPLE_API_*.
# APPLE_API_KEY must be a path to the .p8, so materialize the key the agent
# carries as APP_STORE_CONNECT_API_KEY_KEY into a temp file.
apple_api_key_path="$(mktemp -t cortext_asc).p8"
trap 'rm -f "$apple_api_key_path"' EXIT
# The secret stores the .p8 with newlines as literal \n; %b turns them back into
# real newlines so the file is a valid PEM (a no-op if they are already real).
printf '%b' "$APP_STORE_CONNECT_API_KEY_KEY" > "$apple_api_key_path"
export APPLE_API_KEY="$apple_api_key_path"
export APPLE_API_KEY_ID="$APP_STORE_CONNECT_API_KEY_KEY_ID"
export APPLE_API_ISSUER="$APP_STORE_CONNECT_API_KEY_ISSUER_ID"

# Buildkite uploads release assets only after signature and notarization checks
# pass. Keep electron-builder from trying to publish during the build step.
npm --prefix apps/desktop run dist -- -c.extraMetadata.version="$version" --publish never

echo "--- :white_check_mark: verify signature + notarization"
# electron-builder signs, notarizes and staples the .app, then wraps it in an
# unsigned .dmg — so the notarized artifact to verify is the app, not the dmg.
app="$PWD/apps/desktop/dist/mac-arm64/Cortext.app"
codesign --verify --strict --deep --verbose=2 "$app"
spctl --assess --type exec --verbose=2 "$app"
xcrun stapler validate "$app"

echo "--- :mag: verify packaged app"
npm --prefix apps/desktop run verify:app -- --app "$app"

echo "--- :test_tube: smoke-test packaged app"
node apps/desktop/scripts/packaged-app-smoke.mjs --app "$app"

echo "--- :scroll: check auto-update files"
# Name each file instead of globbing, so a missing one fails the build rather
# than dropping out of the upload.
dist=apps/desktop/dist
binaries=(
  "$dist/Cortext-$version-arm64.dmg"
  "$dist/Cortext-$version-arm64-mac.zip"
  "$dist/Cortext-$version-arm64-mac.zip.blockmap"
)
feed="$dist/latest-mac.yml"
for file in "${binaries[@]}" "$feed"; do
  [[ -f "$file" ]] || { echo "Missing $file; did the mac zip target run?"; exit 1; }
done

if ! "$publish"; then
  echo "--- :information_source: no release tag; DMG and update feed stashed as Buildkite artifacts"
  exit 0
fi

echo "--- :rocket: attach DMG and auto-update feed to the GitHub Release"
# electron-updater reads latest-mac.yml from the Release, then downloads the
# signed zip. Squirrel.Mac installs the zip; the DMG stays for first installs.
# Upload the feed last so apps never see it pointing at files not there yet.
gh release upload "$version" "${binaries[@]}" --repo Automattic/cortext --clobber
gh release upload "$version" "$feed" --repo Automattic/cortext --clobber
