#!/usr/bin/env bash
# Clean up this worktree's wp-env instance when Conductor archives it. Stop the
# environment first, then remove the Docker project wp-env created for this
# checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

workspace_path=$PWD
wp_env_home=${WP_ENV_HOME:-"$HOME/.wp-env"}

if pnpm exec wp-env status --json 2>/dev/null | grep -q '"status":"running"'; then
	pnpm exec wp-env stop || true
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
	exit 0
fi

cleanup_compose_project() {
	local compose_file=$1
	local project_dir
	local project_name
	local image_name
	local container_id
	project_dir=$(dirname "$compose_file")
	project_name=$(basename "$project_dir")

	echo "Cleaning wp-env project: ${project_dir}"
	docker compose -f "$compose_file" down --volumes --remove-orphans --rmi local || true

	# If Compose left containers behind under a different project name, the
	# compose-file label is still a useful fallback.
	while IFS= read -r container_id; do
		[ -z "$container_id" ] || docker rm -f "$container_id"
	done < <(
		docker ps -a -q \
			--filter "label=com.docker.compose.project.config_files=${compose_file}"
	)

	for image_name in \
		"${project_name}-wordpress" \
		"${project_name}-cli" \
		"${project_name}-tests-wordpress" \
		"${project_name}-tests-cli"; do
		docker image rm "$image_name" >/dev/null 2>&1 || true
	done

	rm -rf "$project_dir"
}

if [ -d "$wp_env_home" ]; then
	while IFS= read -r -d '' compose_file; do
		# Match only this worktree's mount paths; a sibling like foo-v1 should
		# not match when this workspace is foo.
		if grep -Fq "${workspace_path}:" "$compose_file" ||
			grep -Fq "${workspace_path}/" "$compose_file"; then
			cleanup_compose_project "$compose_file"
		fi
	done < <(find "$wp_env_home" -maxdepth 2 -name docker-compose.yml -print0)
fi
