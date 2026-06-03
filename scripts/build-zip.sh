#!/usr/bin/env bash
# Build dist/cortext.zip without changing the local dev install.

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
	includes
	templates
	build
	seed-assets
	composer.json
	composer.lock
)

cp -R "${runtime_paths[@]}" "$stage_dir"

# Keep brand assets under assets/brand/ so runtime URLs for the admin icon and
# seeded page banner match the source tree.
mkdir -p "$stage_dir/assets"
cp -R assets/brand "$stage_dir/assets/"

composer install \
	--working-dir="$stage_dir" \
	--no-dev \
	--no-scripts \
	--optimize-autoloader \
	--no-interaction

rm -f "${stage_dir}/composer.lock"

(
	cd "$dist_dir"
	zip -qr cortext.zip cortext
)

echo "Built ${zip_path}"
