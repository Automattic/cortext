#!/usr/bin/env bash

set -euo pipefail

# Build, sign, and notarize the Cortext desktop DMG.

# Release tag builds publish to the GitHub Release.
if [[ "${BUILDKITE_TAG:-}" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  version="${BUILDKITE_TAG#v}"
  publish=true
else
  base_version="$(python3 -c 'import json; print(json.load(open("apps/desktop/package.json"))["version"])')"
  version="${base_version}-${BUILDKITE_COMMIT:0:7}"
  publish=false
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
npm --prefix apps/desktop run runtime:php

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

npm --prefix apps/desktop run dist -- -c.extraMetadata.version="$version"

echo "--- :white_check_mark: verify signature + notarization"
dmg=(apps/desktop/dist/*.dmg)
[[ ${#dmg[@]} -eq 1 ]] || { echo "Expected exactly one DMG, found ${#dmg[@]}"; exit 1; }
dmg="${dmg[0]}"
# electron-builder signs, notarizes and staples the .app, then wraps it in an
# unsigned .dmg — so the notarized artifact to verify is the app, not the dmg.
app="apps/desktop/dist/mac-arm64/Cortext.app"
codesign --verify --strict --deep --verbose=2 "$app"
spctl --assess --type exec --verbose=2 "$app"
xcrun stapler validate "$app"

if ! "$publish"; then
  echo "--- :information_source: no release tag; signed DMG stashed as a Buildkite artifact"
  exit 0
fi

echo "--- :rocket: attach DMG to draft GitHub Release"
if ! gh release view "$version" --repo Automattic/cortext >/dev/null 2>&1; then
  gh release create "$version" \
    --repo Automattic/cortext \
    --draft \
    --title "Cortext $version" \
    --notes "Cortext $version"
fi
gh release upload "$version" "$dmg" --repo Automattic/cortext --clobber
