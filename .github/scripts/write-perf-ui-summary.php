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
$summary_path = $args['summary'] ?? getenv( 'GITHUB_STEP_SUMMARY' );

$output = build_output( $current_path );
echo $output;

if ( is_string( $summary_path ) && '' !== $summary_path ) {
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

function build_output( string $current_path ): string {
	if ( ! is_file( $current_path ) || 0 === filesize( $current_path ) ) {
		return "UI performance run produced no output.\n";
	}
	$raw = file_get_contents( $current_path );
	if ( false === $raw ) {
		return "Could not read UI performance output.\n";
	}
	$report = json_decode( $raw, true );
	if ( ! is_array( $report ) ) {
		return 'Could not parse UI performance JSON: ' . json_last_error_msg() . "\n";
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

	$scenarios = is_array( $report['scenarios'] ?? null ) ? $report['scenarios'] : array();

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

	$headers    = array( 'Scenario', 'ready ms', 'rows API ms', 'REST', 'longtask total' );
	$alignments = array( 'left', 'right', 'right', 'right', 'right' );
	$rows       = array();
	foreach ( $category_order as $category_id => $category_label ) {
		if ( empty( $grouped[ $category_id ] ) ) {
			continue;
		}
		$rows[] = array( '**' . $category_label . '**', '', '', '', '' );
		foreach ( $grouped[ $category_id ] as $name => $data ) {
			$label  = $scenario_labels[ $name ] ?? $name;
			$rows[] = array(
				$label,
				integer_value( $data['ready_ms'] ?? null ),
				integer_value( $data['rows_api_ms'] ?? null ),
				integer_value( $data['rest_request_count'] ?? null ),
				integer_value( $data['long_task_total_ms'] ?? null ),
			);
		}
	}

	if ( count( $rows ) === 0 ) {
		return "UI performance run had no scenarios.\n";
	}

	$lines = array( '## UI performance', '' );
	$lines = array_merge( $lines, markdown_table( $headers, $alignments, $rows ) );

	return implode( "\n", $lines ) . "\n";
}

function integer_value( mixed $value ): string {
	if ( is_numeric( $value ) ) {
		return (string) (int) round( (float) $value );
	}
	return 'n/a';
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
