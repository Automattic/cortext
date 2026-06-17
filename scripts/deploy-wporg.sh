#!/usr/bin/env bash
# Stage or publish a Cortext GitHub Release ZIP to WordPress.org SVN.

set -euo pipefail
cd "$(dirname "$0")/.."

root_dir=$PWD
version=
mode=dry-run
repo=${GITHUB_REPOSITORY:-Automattic/cortext}
svn_url=${WPORG_SVN_URL:-https://plugins.svn.wordpress.org/cortext}
wporg_username=${WPORG_USERNAME:-}
work_dir=
asset_name=cortext.zip

usage() {
	cat <<'USAGE'
Usage:
  scripts/deploy-wporg.sh --version <version> [--dry-run]
  scripts/deploy-wporg.sh --version <version> --commit --username <wporg-user>

Options:
  --version <version>   Release version, for example 0.2.0.
  --dry-run             Stage and validate the SVN deploy without committing.
  --commit              Commit the staged deploy to WordPress.org SVN.
  --username <user>     WordPress.org SVN username. Defaults to WPORG_USERNAME.
  --work-dir <path>     Scratch directory. Defaults to .context/wporg-deploy/<version>.
  --repo <owner/repo>   GitHub repo that owns the release ZIP.
  --svn-url <url>       WordPress.org SVN repository URL.
  --help                Show this help.

For non-interactive commits, set WPORG_USERNAME and WPORG_PASSWORD. The script
passes the password to SVN through stdin.
USAGE
}

die() {
	echo "Error: $*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null || die "Missing required command: $1"
}

assert_file() {
	[ -f "$1" ] || die "Missing required file: $1"
}

assert_dir() {
	[ -d "$1" ] || die "Missing required directory: $1"
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--)
			shift
			;;
		--version)
			[ "$#" -ge 2 ] || die "--version needs a value"
			version=$2
			shift 2
			;;
		--dry-run)
			mode=dry-run
			shift
			;;
		--commit)
			mode=commit
			shift
			;;
		--username)
			[ "$#" -ge 2 ] || die "--username needs a value"
			wporg_username=$2
			shift 2
			;;
		--work-dir)
			[ "$#" -ge 2 ] || die "--work-dir needs a value"
			work_dir=$2
			shift 2
			;;
		--repo)
			[ "$#" -ge 2 ] || die "--repo needs a value"
			repo=$2
			shift 2
			;;
		--svn-url)
			[ "$#" -ge 2 ] || die "--svn-url needs a value"
			svn_url=$2
			shift 2
			;;
		--help|-h)
			usage
			exit 0
			;;
		*)
			die "Unknown option: $1"
			;;
	esac
done

[ -n "$version" ] || die "Pass --version <version>"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
	die "Version must use the WordPress-style format 0.1.0"

if [ "$mode" = commit ] && [ -n "${WPORG_PASSWORD:-}" ] && [ -z "$wporg_username" ]; then
	die "WPORG_PASSWORD requires --username or WPORG_USERNAME"
fi

for command in gh svn unzip rsync awk diff find jq; do
	require_command "$command"
done

default_work_dir="$root_dir/.context/wporg-deploy/$version"
work_dir=${work_dir:-$default_work_dir}

if [ "$work_dir" = "$default_work_dir" ]; then
	rm -rf "$work_dir"
elif [ -e "$work_dir" ]; then
	die "Work dir already exists: $work_dir"
fi

release_dir="$work_dir/release"
unpack_dir="$work_dir/unpacked"
svn_dir="$work_dir/svn"
zip_path="$release_dir/$asset_name"

mkdir -p "$release_dir" "$unpack_dir"

echo "Downloading $asset_name from $repo release $version"
gh release download "$version" \
	--repo "$repo" \
	--pattern "$asset_name" \
	--dir "$release_dir" \
	--clobber

assert_file "$zip_path"
unzip -q "$zip_path" -d "$unpack_dir"

plugin_dir="$unpack_dir/cortext"
assert_dir "$plugin_dir"

plugin_version=$(awk -F': *' '/^[[:space:]]+\* Version:/ { print $2; exit }' "$plugin_dir/cortext.php")
constant_version=$(sed -n "s/.*define( 'CORTEXT_VERSION', '\([^']*\)' ).*/\1/p" "$plugin_dir/cortext.php")
stable_tag=$(awk -F': *' '/^Stable tag:/ { print $2; exit }' "$plugin_dir/readme.txt")

[ "$plugin_version" = "$version" ] ||
	die "Plugin header version is $plugin_version, expected $version"
[ "$constant_version" = "$version" ] ||
	die "CORTEXT_VERSION is $constant_version, expected $version"
[ "$stable_tag" = "$version" ] ||
	die "Stable tag is $stable_tag, expected $version"

for path in \
	cortext.php \
	readme.txt \
	composer.json \
	vendor/autoload.php \
	build/index.js; do
	assert_file "$plugin_dir/$path"
done

if find "$plugin_dir" \( \
	-path '*/.github/*' -o \
	-path '*/apps/*' -o \
	-path '*/node_modules/*' -o \
	-path '*/src/*' -o \
	-path '*/tests/*' -o \
	-name composer.lock -o \
	-name package.json -o \
	-name pnpm-lock.yaml -o \
	-name "$asset_name" -o \
	-name .DS_Store \
	\) -print | grep .; then
	die "Release ZIP contains development-only files"
fi

asset_dir="$root_dir/assets/wordpress-org"
for path in \
	banner-1544x500.png \
	banner-772x250.png \
	icon-128x128.png \
	icon-256x256.png \
	screenshot-1.jpg \
	blueprints/blueprint.json; do
	assert_file "$asset_dir/$path"
done
jq empty "$asset_dir/blueprints/blueprint.json"

tag_name=$version
if svn ls "$svn_url/tags/$version" >/dev/null 2>&1; then
	if [ "$mode" = commit ]; then
		die "SVN tag already exists: $svn_url/tags/$version"
	fi

	tag_name="__dry-run-$version"
	echo "SVN tag $version already exists. Dry run will use local tag $tag_name."
fi

echo "Checking out $svn_url"
svn checkout --depth immediates "$svn_url" "$svn_dir" >/dev/null
svn update --set-depth infinity "$svn_dir/trunk" "$svn_dir/assets" >/dev/null

rsync -a --delete "$plugin_dir/" "$svn_dir/trunk/"
rsync -a --delete "$asset_dir/" "$svn_dir/assets/"

svn status "$svn_dir/trunk" "$svn_dir/assets" |
	awk '/^!/ { print substr($0, 9) }' |
	while IFS= read -r path; do
		[ -z "$path" ] || svn rm "$path"
	done

svn add --force "$svn_dir/trunk" "$svn_dir/assets" >/dev/null
svn copy "$svn_dir/trunk" "$svn_dir/tags/$tag_name" >/dev/null

diff -qr "$svn_dir/trunk" "$svn_dir/tags/$tag_name" >/dev/null ||
	die "SVN tag contents differ from trunk"

if [ -z "$(svn status "$svn_dir")" ]; then
	die "No SVN changes staged"
fi

echo "SVN status:"
svn status "$svn_dir"

if [ "$mode" = dry-run ]; then
	if [ "$tag_name" != "$version" ]; then
		cat <<EOF

Dry run complete. Nothing was committed to SVN.
Work dir: $work_dir
Staged tag: $tag_name

The real SVN tag $version already exists. Cut a new release before publishing
runtime changes to WordPress.org.
EOF
	else
		cat <<EOF

Dry run complete. Nothing was committed to SVN.
Work dir: $work_dir
Staged tag: $tag_name

To publish, rerun with:
  scripts/deploy-wporg.sh --version $version --commit --username <wporg-user>
EOF
	fi
	exit 0
fi

commit_args=( commit "$svn_dir" -m "Release Cortext $version" )
if [ -n "$wporg_username" ]; then
	commit_args+=( --username "$wporg_username" )
fi

if [ -n "${WPORG_PASSWORD:-}" ]; then
	printf '%s\n' "$WPORG_PASSWORD" |
		svn "${commit_args[@]}" --password-from-stdin --non-interactive
else
	svn "${commit_args[@]}"
fi
