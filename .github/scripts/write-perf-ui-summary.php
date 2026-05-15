#!/usr/bin/env php
<?php
/**
 * Renders the UI performance benchmark JSON as a markdown table grouped by
 * scenario category. Writes to stdout and appends to the GitHub step summary
 * when $GITHUB_STEP_SUMMARY is set.
 *
 * Usage:
 *   php .github/scripts/write-perf-ui-summary.php --current=artifacts/perf-ui.json
 *
 * @package Cortext
 */

declare(strict_types=1);

$args         = parse_args( $argv );
$current_path = $args['current'] ?? 'artifacts/perf-ui.json';
$base_path    = $args['base'] ?? '';
$base_label   = $args['base-label'] ?? 'base';
$summary_path = $args['summary'] ?? getenv( 'GITHUB_STEP_SUMMARY' );

$output = build_output( $current_path, $base_path, $base_label );
// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI markdown output for GitHub summaries should stay unescaped.
echo $output;

if ( is_string( $summary_path ) && '' !== $summary_path ) {
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Standalone CI helper writes to GitHub's summary file outside WordPress.
	file_put_contents( $summary_path, $output, FILE_APPEND );
}

/**
 * Parses `--name=value` flags out of $argv.
 *
 * @param array<int,string> $argv Raw argv.
 * @return array<string,string>
 */
function parse_args( array $argv ): array {
	$args = array();
	foreach ( array_slice( $argv, 1 ) as $arg ) {
		if ( ! str_starts_with( $arg, '--' ) ) {
			continue;
		}
		$parts = explode( '=', substr( $arg, 2 ), 2 );
		$key   = $parts[0] ?? '';
		if ( '' === $key ) {
			continue;
		}
		$args[ $key ] = $parts[1] ?? '1';
	}
	return $args;
}

function build_output( string $current_path, string $base_path, string $base_label ): string {
	$current = load_report( $current_path, 'UI performance run' );
	if ( null === $current['report'] ) {
		return $current['message'];
	}

	$base_report = null;
	if ( '' !== $base_path ) {
		$base = load_report( $base_path, "{$base_label} UI performance run" );
		if ( null !== $base['report'] ) {
			$base_report = $base['report'];
		}
	}

	// Categories are ordered from broadest (collection-level) down to the
	// most localized surfaces. The category id is the tag the spec writes;
	// the label is what shows up in the table section header.
	$category_order = array(
		'collection_read' => 'Collection',
		'row'             => 'Row',
		'column'          => 'Column',
		'navigation'      => 'Navigation',
		'surface'         => 'Surface',
	);

	$scenario_labels = array(
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

	$scenarios      = is_array( $current['report']['scenarios'] ?? null ) ? $current['report']['scenarios'] : array();
	$base_scenarios = is_array( $base_report['scenarios'] ?? null ) ? $base_report['scenarios'] : array();
	$has_base       = count( $base_scenarios ) > 0;

	if ( count( $scenarios ) === 0 ) {
		return "UI performance run had no scenarios.\n";
	}

	if ( $has_base ) {
		return render_comparison( $scenarios, $base_scenarios, $scenario_labels, $category_order, $base_label );
	}

	return render_current_only( $scenarios, $scenario_labels, $category_order );
}

/**
 * Renders the full UI performance table when there is no baseline to compare
 * against (e.g. a push to main).
 *
 * @param array<string,mixed> $scenarios       Current scenarios keyed by id.
 * @param array<string,string> $scenario_labels Label per scenario id.
 * @param array<string,string> $category_order  Ordered category id => label.
 */
function render_current_only( array $scenarios, array $scenario_labels, array $category_order ): string {
	$grouped = group_scenarios_by_category( $scenarios, $category_order );

	$headers    = array( 'Scenario', 'ready ms', 'rows API ms', 'REST', 'longtask total' );
	$alignments = array( 'left', 'right', 'right', 'right', 'right' );
	$rows       = array();

	foreach ( $category_order as $category_id => $category_label ) {
		if ( empty( $grouped[ $category_id ] ) ) {
			continue;
		}
		$rows[] = array( '**' . $category_label . '**', '', '', '', '' );
		foreach ( $grouped[ $category_id ] as $name => $data ) {
			$rows[] = array(
				$scenario_labels[ $name ] ?? $name,
				ui_metric_value( $data['ready_ms'] ?? null ),
				ui_metric_value( $data['rows_api_ms'] ?? null ),
				ui_metric_value( $data['rest_request_count'] ?? null ),
				ui_metric_value( $data['long_task_total_ms'] ?? null ),
			);
		}
	}

	$lines = array( '## UI performance', '' );
	$lines = array_merge( $lines, markdown_table( $headers, $alignments, $rows ) );

	return implode( "\n", $lines ) . "\n";
}

/**
 * Renders the comparison view: one-line headline if everything is within noise,
 * otherwise a compact table that only lists scenarios with notable changes.
 *
 * @param array<string,mixed>  $scenarios       Current scenarios.
 * @param array<string,mixed>  $base_scenarios  Baseline scenarios.
 * @param array<string,string> $scenario_labels Label per scenario id.
 * @param array<string,string> $category_order  Ordered category id => label.
 * @param string               $base_label      Baseline label.
 */
function render_comparison( array $scenarios, array $base_scenarios, array $scenario_labels, array $category_order, string $base_label ): string {
	$grouped = group_scenarios_by_category( $scenarios, $category_order );

	$ui_metrics = array(
		array(
			'key'   => 'ready_ms',
			'label' => 'ready_ms',
			'type'  => 'timing',
		),
		array(
			'key'   => 'rows_api_ms',
			'label' => 'rows_api_ms',
			'type'  => 'timing',
		),
		array(
			'key'   => 'long_task_total_ms',
			'label' => 'longtask',
			'type'  => 'timing',
		),
		array(
			'key'   => 'rest_request_count',
			'label' => 'REST',
			'type'  => 'integer',
		),
	);

	$changed_rows   = array();
	$within_noise   = 0;
	$total_compared = 0;

	foreach ( $category_order as $category_id => $category_label ) {
		if ( empty( $grouped[ $category_id ] ) ) {
			continue;
		}
		foreach ( $grouped[ $category_id ] as $name => $data ) {
			$base = is_array( $base_scenarios[ $name ] ?? null ) ? $base_scenarios[ $name ] : null;
			if ( null === $base ) {
				continue;
			}

			++$total_compared;
			$buckets = ui_scenario_change_buckets( $data, $base, $ui_metrics );

			if ( ! $buckets['has_changes'] ) {
				++$within_noise;
				continue;
			}

			$changed_rows[] = array(
				$scenario_labels[ $name ] ?? $name,
				$category_label,
				format_ui_change_cell( $buckets['timing'] ),
				format_ui_change_cell( $buckets['deterministic'] ),
			);
		}
	}

	$title = '## UI performance vs ' . $base_label;

	if ( 0 === $total_compared ) {
		return $title . "\n\nNo shared UI scenarios to compare.\n";
	}

	if ( count( $changed_rows ) === 0 ) {
		return $title . "\n\nAll " . $total_compared . ' UI ' . ( 1 === $total_compared ? 'scenario' : 'scenarios' ) . " within noise.\n";
	}

	$changed  = count( $changed_rows );
	$headline = $changed . ' of ' . $total_compared . ' UI ' . ( 1 === $total_compared ? 'scenario' : 'scenarios' ) . ' changed';
	if ( $within_noise > 0 ) {
		$headline .= '; ' . $within_noise . ' within noise';
	}

	$lines   = array( $title, '', $headline . '.', '' );
	$lines[] = '<details>';
	$lines[] = '<summary>Show changes</summary>';
	$lines[] = '';

	foreach ( markdown_table( array( 'Scenario', 'Category', 'Timing', 'Deterministic' ), array( 'left', 'left', 'left', 'left' ), $changed_rows ) as $line ) {
		$lines[] = $line;
	}

	$lines[] = '';
	$lines[] = '</details>';
	$lines[] = '';
	$lines[] = '_UI timing deltas count past 15%. REST request counts are deterministic; any non-zero delta is counted._';

	return implode( "\n", $lines ) . "\n";
}

/**
 * Groups scenarios into the configured category order, with an `_uncategorized`
 * bucket appended on the fly when needed.
 *
 * @param array<string,mixed>   $scenarios      Scenarios keyed by id.
 * @param array<string,string> &$category_order Ordered category id => label.
 *                                              Mutated to add `_uncategorized`
 *                                              when scenarios fall outside the
 *                                              known categories.
 * @return array<string,array<string,mixed>>
 */
function group_scenarios_by_category( array $scenarios, array &$category_order ): array {
	$grouped = array_fill_keys( array_keys( $category_order ), array() );
	$unknown = array();

	foreach ( $scenarios as $name => $data ) {
		if ( ! is_array( $data ) ) {
			continue;
		}
		$category = (string) ( $data['category'] ?? '' );
		if ( isset( $grouped[ $category ] ) ) {
			$grouped[ $category ][ $name ] = $data;
		} else {
			$unknown[ $name ] = $data;
		}
	}

	if ( count( $unknown ) > 0 ) {
		$grouped['_uncategorized']        = $unknown;
		$category_order['_uncategorized'] = 'Uncategorized';
	}

	return $grouped;
}

/**
 * Buckets notable metric changes for one UI scenario.
 *
 * @param array<string,mixed>                                  $current Current scenario.
 * @param array<string,mixed>                                  $base    Base scenario.
 * @param array<int,array{key:string,label:string,type:string}> $metrics Metrics to compare.
 * @return array{has_changes:bool,timing:array<int,string>,deterministic:array<int,string>}
 */
function ui_scenario_change_buckets( array $current, array $base, array $metrics ): array {
	$timing        = array();
	$deterministic = array();

	foreach ( $metrics as $metric ) {
		$current_value = $current[ $metric['key'] ] ?? null;
		$base_value    = $base[ $metric['key'] ] ?? null;
		$change        = ui_metric_change_text( $current_value, $base_value, $metric );

		if ( null === $change ) {
			continue;
		}

		if ( 'timing' === $metric['type'] ) {
			$timing[] = $change;
		} else {
			$deterministic[] = $change;
		}
	}

	return array(
		'has_changes'   => count( $timing ) > 0 || count( $deterministic ) > 0,
		'timing'        => $timing,
		'deterministic' => $deterministic,
	);
}

/**
 * Returns the formatted change text for one UI metric, or null if the change
 * sits within the noise floor (or either value is missing).
 *
 * @param mixed                                  $current Current value.
 * @param mixed                                  $base    Base value.
 * @param array{key:string,label:string,type:string} $metric Metric definition.
 */
function ui_metric_change_text( mixed $current, mixed $base, array $metric ): ?string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return null;
	}

	$current_value = (int) round( (float) $current );
	$base_value    = (int) round( (float) $base );
	$delta         = $current_value - $base_value;

	if ( 0 === $delta ) {
		return null;
	}

	if ( 'integer' === $metric['type'] ) {
		return $metric['label'] . ' ' . signed_number( (float) $delta, 0 );
	}

	if ( 0 === $base_value ) {
		return $metric['label'] . ' ' . signed_number( (float) $delta, 0 ) . ' ms';
	}

	$percent = ( $delta / $base_value ) * 100.0;
	if ( abs( $percent ) < 15.0 ) {
		return null;
	}

	return $metric['label'] . ' ' . signed_number( $percent, 1 ) . '%';
}

/**
 * Renders a list of change strings as a single table cell.
 *
 * @param array<int,string> $changes Change strings.
 */
function format_ui_change_cell( array $changes ): string {
	if ( count( $changes ) === 0 ) {
		return '-';
	}

	return implode( ', ', $changes );
}

/**
 * Loads a UI performance JSON report.
 *
 * @param string $path  Artifact path.
 * @param string $label Human-readable report label.
 * @return array{report:?array<string,mixed>,message:string}
 */
function load_report( string $path, string $label ): array {
	if ( ! is_file( $path ) || 0 === filesize( $path ) ) {
		return array(
			'report'  => null,
			'message' => "{$label} produced no output.\n",
		);
	}

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local artifact path in a standalone CI helper.
	$raw = file_get_contents( $path );
	if ( false === $raw ) {
		return array(
			'report'  => null,
			'message' => "Could not read {$label} output.\n",
		);
	}

	$report = json_decode( $raw, true );
	if ( ! is_array( $report ) ) {
		return array(
			'report'  => null,
			'message' => 'Could not parse ' . $label . ' JSON: ' . json_last_error_msg() . "\n",
		);
	}

	return array(
		'report'  => $report,
		'message' => '',
	);
}

function ui_metric_value( mixed $current ): string {
	if ( ! is_numeric( $current ) ) {
		return 'n/a';
	}

	return (string) (int) round( (float) $current );
}

function signed_number( float $value, int $decimals ): string {
	$formatted = number_format( $value, $decimals, '.', '' );
	if ( $value > 0 ) {
		return '+' . $formatted;
	}

	return $formatted;
}

/**
 * Builds an aligned GitHub-flavored markdown table.
 *
 * @param array<int,string>            $headers    Column headers.
 * @param array<int,string>            $alignments One of `left` or `right` per column.
 * @param array<int,array<int,string>> $rows       Pre-stringified cell values.
 * @return array<int,string>
 */
function markdown_table( array $headers, array $alignments, array $rows ): array {
	$widths = array_map( 'strlen', $headers );
	foreach ( $rows as $row ) {
		foreach ( $row as $index => $cell ) {
			$widths[ $index ] = max( $widths[ $index ] ?? 0, strlen( $cell ) );
		}
	}
	foreach ( $widths as $index => $width ) {
		$widths[ $index ] = max( 3, $width );
	}

	$format_row = static function ( array $row ) use ( $alignments, $widths ): string {
		foreach ( $row as $index => $cell ) {
			$pad_type      = 'right' === ( $alignments[ $index ] ?? 'left' ) ? STR_PAD_LEFT : STR_PAD_RIGHT;
			$row[ $index ] = str_pad( $cell, $widths[ $index ], ' ', $pad_type );
		}
		return '| ' . implode( ' | ', $row ) . ' |';
	};

	$separator = array();
	foreach ( $widths as $index => $width ) {
		$separator[] = 'right' === ( $alignments[ $index ] ?? 'left' )
			? str_repeat( '-', $width - 1 ) . ':'
			: str_repeat( '-', $width );
	}

	return array_merge(
		array( $format_row( $headers ), '| ' . implode( ' | ', $separator ) . ' |' ),
		array_map( $format_row, $rows )
	);
}
