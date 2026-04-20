#!/usr/bin/env bash
# Regenerate the mu-style plugin that labels the site title with the current
# branch name. Run on every `scripts/run.sh` so the label survives branch
# renames and checkouts within a worktree.
set -euo pipefail
cd "$(dirname "$0")/.."

branch=$(git branch --show-current)
label=${branch#*/}

mkdir -p .wp-env-plugins/worktree-label
cat > .wp-env-plugins/worktree-label/worktree-label.php <<EOF
<?php
/* Plugin Name: Worktree Label */
add_filter( 'option_blogname', fn() => '${label}' );
EOF
