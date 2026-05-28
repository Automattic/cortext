#!/usr/bin/env bash
# Build a distributable Cortext plugin ZIP.

set -euo pipefail
cd "$(dirname "$0")/.."

dist_dir="dist"
stage_dir="${dist_dir}/cortext"
zip_path="${dist_dir}/cortext.zip"

command -v zip >/dev/null || {
	echo "Missing required command: zip" >&2
	exit 1
}

pnpm install --frozen-lockfile
pnpm run build

rm -rf "$stage_dir" "$zip_path"
mkdir -p "$stage_dir"

runtime_paths=(
	cortext.php
	readme.txt
	LICENSE
	cortext-banner.png
	cortext-banner.svg
	includes
	templates
	build
	seed-assets
	composer.json
	composer.lock
)

cp -R "${runtime_paths[@]}" "$stage_dir"

composer install \
	--working-dir="$stage_dir" \
	--no-dev \
	--no-scripts \
	--optimize-autoloader \
	--no-interaction

rm -f "${stage_dir}/composer.json" "${stage_dir}/composer.lock"

(
	cd "$dist_dir"
	zip -qr cortext.zip cortext
)

echo "Built ${zip_path}"
