<?php
/**
 * Shared scenario id => human label mapping for the UI performance benchmark.
 *
 * The id comes from the tag the Playwright spec writes; the label is what
 * the PR comment and job summary render.
 *
 * @package Cortext
 */

declare(strict_types=1);

/**
 * @return array<string,string>
 */
function perf_ui_scenario_labels(): array {
	return array(
		'collection_ready_basic'   => 'Open collection (cold)',
		'collection_ready_rollups' => 'Paginate to rollups',
		'sort_apply'               => 'Sort apply',
		'search_rows_ready'        => 'Search rows',
		'row_detail_ready'         => 'Open row detail',
		'row_create_ready'         => 'Create row',
		'row_navigate_next'        => 'Navigate to next row',
		'column_actions_open'      => 'Open column actions',
		'column_rename_inline'     => 'Rename column inline',
		'workspace_home_ready'     => 'Open workspace home',
		'shell_navigation_warm'    => 'Warm shell navigation',
		'page_edit_ready'          => 'Open page in editor',
		'command_palette_open'     => 'Open command palette',
	);
}
