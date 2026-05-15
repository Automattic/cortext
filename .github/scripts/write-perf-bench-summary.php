#!/usr/bin/env php
<?php
declare(strict_types=1);

$args         = parse_args( $argv );
$current_path = $args['current'] ?? 'artifacts/perf-bench.json';
$base_path    = $args['base'] ?? '';
$base_label   = $args['base-label'] ?? 'base';
$summary_path = $args['summary'] ?? getenv( 'GITHUB_STEP_SUMMARY' );
$comparison_only = isset( $args['comparison-only'] ) && '0' !== $args['comparison-only'];
$failures_only_metric = $args['failures-only-metric'] ?? '';

if ( '' !== $failures_only_metric ) {
	exit( failures_are_only_metric( $current_path, $failures_only_metric ) ? 0 : 1 );
}

$output = build_output( $current_path, $base_path, $base_label, $comparison_only );
echo $output;

if ( is_string( $summary_path ) && '' !== $summary_path ) {
	file_put_contents( $summary_path, $output, FILE_APPEND );
}

/**
 * @param array<int,string> $argv
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

function build_output( string $current_path, string $base_path, string $base_label, bool $comparison_only ): string {
	$current = load_report( $current_path, 'benchmark' );
	if ( null === $current['report'] ) {
		return $current['message'];
	}

	if ( $comparison_only ) {
		if ( '' === $base_path ) {
			return "Base benchmark produced no output.\n";
		}

		return implode( "\n", comparison_lines( $current['report'], $base_path, $base_label ) ) . "\n";
	}

	$lines = benchmark_summary_lines( $current['report'] );

	if ( '' !== $base_path ) {
		$lines[] = '';
		$lines   = array_merge( $lines, comparison_lines( $current['report'], $base_path, $base_label ) );
	}

	return implode( "\n", $lines ) . "\n";
}

function failures_are_only_metric( string $current_path, string $metric ): bool {
	$current = load_report( $current_path, 'benchmark' );
	if ( null === $current['report'] ) {
		return false;
	}

	$failures = $current['report']['failures'] ?? null;
	if ( ! is_array( $failures ) || count( $failures ) === 0 ) {
		return false;
	}

	foreach ( $failures as $failure ) {
		if ( ! is_array( $failure ) || ( $failure['metric'] ?? '' ) !== $metric ) {
			return false;
		}
	}

	return true;
}

/**
 * @return array{report:?array<string,mixed>,message:string}
 */
function load_report( string $path, string $label ): array {
	if ( ! is_file( $path ) || 0 === filesize( $path ) ) {
		return array(
			'report'  => null,
			'message' => ucfirst( $label ) . " produced no output.\n",
		);
	}

	$raw = file_get_contents( $path );
	if ( false === $raw ) {
		return array(
			'report'  => null,
			'message' => "Could not read {$label} output.\n",
		);
	}

	$json = extract_json_object( $raw );
	if ( null === $json ) {
		return array(
			'report'  => null,
			'message' => ucfirst( $label ) . " output had no JSON.\n",
		);
	}

	$report = json_decode( $json, true );
	if ( ! is_array( $report ) ) {
		return array(
			'report'  => null,
			'message' => "Could not parse {$label} JSON: " . json_last_error_msg() . "\n",
		);
	}

	return array(
		'report'  => $report,
		'message' => '',
	);
}

function extract_json_object( string $raw ): ?string {
	$json_start = strpos( $raw, '{' );
	if ( false === $json_start ) {
		return null;
	}

	$depth     = 0;
	$in_string = false;
	$escaped   = false;
	$length    = strlen( $raw );

	for ( $index = $json_start; $index < $length; $index++ ) {
		$char = $raw[ $index ];

		if ( $in_string ) {
			if ( $escaped ) {
				$escaped = false;
			} elseif ( '\\' === $char ) {
				$escaped = true;
			} elseif ( '"' === $char ) {
				$in_string = false;
			}
			continue;
		}

		if ( '"' === $char ) {
			$in_string = true;
		} elseif ( '{' === $char ) {
			$depth++;
		} elseif ( '}' === $char ) {
			$depth--;
			if ( 0 === $depth ) {
				return substr( $raw, $json_start, $index - $json_start + 1 );
			}
		}
	}

	return null;
}

/**
 * @param array<string,mixed> $report
 * @return array<int,string>
 */
function benchmark_summary_lines( array $report ): array {
	$iterations = is_array( $report['iterations'] ?? null ) ? $report['iterations'] : array();
	$lines      = array(
		'## Performance benchmark',
		'',
		'- Result: ' . ( ! empty( $report['passed'] ) ? 'passed' : 'failed' ),
		'- Total time: ' . number_value( $report['elapsedMs'] ?? null ) . ' ms',
		'- Runs: ' . integer_value( $iterations['measured'] ?? null ) . ' measured, ' . integer_value( $iterations['warmup'] ?? null ) . ' warm-up',
		'',
	);

	$scenario_rows = array();
	foreach ( (array) ( $report['scenarios'] ?? array() ) as $scenario ) {
		if ( ! is_array( $scenario ) ) {
			continue;
		}

		$budget          = is_array( $scenario['budget'] ?? null ) ? $scenario['budget'] : array();
		$scenario_rows[] = array(
			! empty( $scenario['passed'] ) ? 'pass' : 'fail',
			escape_cell( $scenario['label'] ?? '' ),
			number_value( $scenario['p50_ms'] ?? null ),
			number_value( $scenario['p95_ms'] ?? null ),
			number_value( $budget['p95_ms'] ?? null ),
			integer_value( $scenario['sql_queries_p50'] ?? null ),
			integer_value( $scenario['sql_queries_p95'] ?? null ),
			integer_value( $budget['sql_queries_p95'] ?? null ),
			memory_value( $scenario['memory_bytes_p95'] ?? null ),
			memory_value( $budget['memory_bytes_p95'] ?? null ),
		);
	}

	$lines = array_merge(
		$lines,
		markdown_table(
			array( 'Status', 'Scenario', 'p50 ms', 'p95 ms', 'p95 limit', 'SQL p50', 'SQL p95', 'SQL limit', 'Memory p95', 'Memory limit' ),
			array( 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right' ),
			$scenario_rows
		)
	);

	if ( ! empty( $report['failures'] ) ) {
		$lines[] = '';
		$lines[] = '### Budget misses';
		$lines[] = '';

		$failure_rows = array();
		foreach ( (array) $report['failures'] as $failure ) {
			if ( ! is_array( $failure ) ) {
				continue;
			}

			$metric         = (string) ( $failure['metric'] ?? '' );
			$failure_rows[] = array(
				escape_cell( $failure['scenario'] ?? '' ),
				escape_cell( $metric ),
				failure_value( $metric, $failure['actual'] ?? null ),
				failure_value( $metric, $failure['budget'] ?? null ),
			);
		}

		$lines = array_merge(
			$lines,
			markdown_table(
				array( 'Scenario', 'Metric', 'Actual', 'Budget' ),
				array( 'left', 'left', 'right', 'right' ),
				$failure_rows
			)
		);
	}

	return $lines;
}

/**
 * @param array<string,mixed> $current
 * @return array<int,string>
 */
function comparison_lines( array $current, string $base_path, string $base_label ): array {
	$base = load_report( $base_path, "{$base_label} benchmark" );
	$escaped_base_label = escape_cell( $base_label );
	$lines = array(
		'## Performance vs ' . $escaped_base_label,
		'',
	);

	if ( null === $base['report'] ) {
		$lines[] = trim( $base['message'] );
		return $lines;
	}

	if ( ! reports_share_config( $current, $base['report'] ) ) {
		$lines[] = 'Baseline stale: seed args or budget path changed.';
		return $lines;
	}

	$current_scenarios = is_array( $current['scenarios'] ?? null ) ? $current['scenarios'] : array();
	$base_scenarios    = is_array( $base['report']['scenarios'] ?? null ) ? $base['report']['scenarios'] : array();
	$rows              = array();
	$change_summary    = empty_change_summary();
	$metrics           = comparison_metric_definitions( $current_scenarios, $base_scenarios );

	if ( count( $metrics ) === 0 ) {
		$lines[] = 'No comparable metrics to compare.';
		return $lines;
	}

	foreach ( $current_scenarios as $scenario_id => $scenario ) {
		if ( ! is_array( $scenario ) || ! isset( $base_scenarios[ $scenario_id ] ) || ! is_array( $base_scenarios[ $scenario_id ] ) ) {
			continue;
		}

		$base_scenario = $base_scenarios[ $scenario_id ];
		$scenario_summary = scenario_change_summary( $scenario, $base_scenario, $metrics );
		$change_summary   = merge_change_summary( $change_summary, $scenario_summary );

		$rows[] = array(
			escape_cell( $scenario['label'] ?? $scenario_id ),
			scenario_takeaway( $scenario_summary ),
			notable_changes_text( $scenario_summary ),
		);
	}

	if ( count( $rows ) === 0 ) {
		$lines[] = 'No shared scenarios to compare.';
		return $lines;
	}

	$lines[] = comparison_summary_text( $change_summary );
	$lines[] = '';
	$lines[] = '<details>';
	$lines[] = '<summary>Show scenario comparison table</summary>';
	$lines[] = '';

	foreach (
		markdown_table(
			array( 'Scenario', 'Result', 'Notable changes' ),
			array( 'left', 'left', 'left' ),
			$rows
		) as $table_line
	) {
		$lines[] = $table_line;
	}

	$lines[] = '';
	$lines[] = '</details>';
	$lines[] = '';
	$lines[] = '_Deltas <10% on p50/p95 may be runner noise; SQL counts and memory are deterministic._';

	return $lines;
}

/**
 * Summarizes all metric changes for a single scenario.
 *
 * @param array<string,mixed>                                $scenario      Current scenario.
 * @param array<string,mixed>                                $base_scenario Base scenario.
 * @param array<int,array{key:string,label:string,type:string}> $metrics    Comparable metrics.
 * @return array{total:int,better:int,worse:int,same:int,better_changes:array<int,string>,worse_changes:array<int,string>}
 */
function scenario_change_summary( array $scenario, array $base_scenario, array $metrics ): array {
	$summary = empty_change_summary();

	foreach ( $metrics as $metric ) {
		$current = $scenario[ $metric['key'] ] ?? null;
		$base    = $base_scenario[ $metric['key'] ] ?? null;
		$change  = metric_change_kind( $current, $base, $metric['type'] );

		if ( 'missing' === $change ) {
			continue;
		}

		++$summary['total'];

		if ( 'same' === $change ) {
			++$summary['same'];
			continue;
		}

		++$summary[ $change ];
		$summary[ $change . '_changes' ][] = metric_change_text( $metric['label'], $current, $base, $metric['type'] );
	}

	return $summary;
}

/**
 * Combines one scenario summary into the aggregate summary.
 *
 * @param array{total:int,better:int,worse:int,same:int} $summary          Aggregate summary.
 * @param array{total:int,better:int,worse:int,same:int} $scenario_summary Scenario summary.
 * @return array{total:int,better:int,worse:int,same:int}
 */
function merge_change_summary( array $summary, array $scenario_summary ): array {
	foreach ( array( 'total', 'better', 'worse', 'same' ) as $key ) {
		$summary[ $key ] += $scenario_summary[ $key ];
	}

	return $summary;
}

/**
 * Formats the scenario-level result.
 *
 * @param array{better:int,worse:int} $summary Scenario summary.
 */
function scenario_takeaway( array $summary ): string {
	if ( 0 === $summary['better'] && 0 === $summary['worse'] ) {
		return 'unchanged';
	}

	if ( $summary['better'] > 0 && 0 === $summary['worse'] ) {
		return 'better';
	}

	if ( $summary['worse'] > 0 && 0 === $summary['better'] ) {
		return 'worse';
	}

	if ( $summary['better'] > $summary['worse'] ) {
		return 'mostly better';
	}

	if ( $summary['worse'] > $summary['better'] ) {
		return 'mostly worse';
	}

	return 'mixed';
}

/**
 * Formats notable metric changes for one scenario.
 *
 * @param array{better_changes:array<int,string>,worse_changes:array<int,string>} $summary Scenario summary.
 */
function notable_changes_text( array $summary ): string {
	$parts = array();

	if ( count( $summary['better_changes'] ) > 0 ) {
		$parts[] = 'Better: ' . implode( ', ', $summary['better_changes'] );
	}

	if ( count( $summary['worse_changes'] ) > 0 ) {
		$parts[] = 'Worse: ' . implode( ', ', $summary['worse_changes'] );
	}

	if ( count( $parts ) === 0 ) {
		return 'No notable changes';
	}

	return implode( '<br>', array_map( 'escape_cell', $parts ) );
}

function metric_change_text( string $label, mixed $current, mixed $base, string $type ): string {
	return $label . ' ' . short_delta_value( $current, $base, $type );
}

/**
 * Builds the comparable metric columns present in the benchmark reports.
 *
 * @param array<string,mixed> $current_scenarios Current report scenarios.
 * @param array<string,mixed> $base_scenarios    Base report scenarios.
 * @return array<int,array{key:string,label:string,type:string}>
 */
function comparison_metric_definitions( array $current_scenarios, array $base_scenarios ): array {
	$metrics = array();

	foreach ( $current_scenarios as $scenario_id => $scenario ) {
		if ( ! is_array( $scenario ) || ! isset( $base_scenarios[ $scenario_id ] ) || ! is_array( $base_scenarios[ $scenario_id ] ) ) {
			continue;
		}

		foreach ( $scenario as $key => $value ) {
			if ( ! should_compare_metric( $key, $value, $base_scenarios[ $scenario_id ][ $key ] ?? null ) || isset( $metrics[ $key ] ) ) {
				continue;
			}

			$metrics[ $key ] = array(
				'key'   => $key,
				'label' => metric_label( $key ),
				'type'  => metric_type( $key ),
			);
		}
	}

	return array_values( $metrics );
}

/**
 * Checks whether a scenario value should be compared as a metric.
 */
function should_compare_metric( string $key, mixed $current, mixed $base ): bool {
	if ( in_array( $key, array( 'runs' ), true ) ) {
		return false;
	}

	return is_numeric( $current ) && is_numeric( $base );
}

/**
 * Formats a benchmark metric key as a markdown table header.
 */
function metric_label( string $key ): string {
	if ( preg_match( '/^p(\\d+)_ms$/', $key, $matches ) ) {
		return 'p' . $matches[1] . ' ms';
	}

	if ( preg_match( '/^sql_queries_p(\\d+)$/', $key, $matches ) ) {
		return 'SQL p' . $matches[1];
	}

	if ( preg_match( '/^memory_bytes_p(\\d+)$/', $key, $matches ) ) {
		return 'Memory p' . $matches[1];
	}

	if ( preg_match( '/^(.+)_p(\\d+)_ms$/', $key, $matches ) ) {
		return ucwords( str_replace( '_', ' ', $matches[1] ) ) . ' p' . $matches[2] . ' ms';
	}

	return ucwords( str_replace( '_', ' ', $key ) );
}

/**
 * Infers how a benchmark metric should be formatted.
 */
function metric_type( string $key ): string {
	if ( str_starts_with( $key, 'memory_bytes_' ) ) {
		return 'memory';
	}

	if ( str_starts_with( $key, 'sql_queries_' ) ) {
		return 'integer';
	}

	return 'number';
}

/**
 * Creates empty metric change counts.
 *
 * @return array{total:int,better:int,worse:int,same:int,better_changes:array<int,string>,worse_changes:array<int,string>}
 */
function empty_change_summary(): array {
	return array(
		'total'          => 0,
		'better'         => 0,
		'worse'          => 0,
		'same'           => 0,
		'better_changes' => array(),
		'worse_changes'  => array(),
	);
}

function metric_change_kind( mixed $current, mixed $base, string $type ): string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return 'missing';
	}

	$current_float = (float) $current;
	$base_float    = (float) $base;
	$delta         = $current_float - $base_float;

	if ( ! is_notable_metric_change( $delta, $base_float, $type ) ) {
		return 'same';
	}

	return $current_float < $base_float ? 'better' : 'worse';
}

function short_delta_value( mixed $current, mixed $base, string $type ): string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return 'n/a';
	}

	$current_float = (float) $current;
	$base_float    = (float) $base;
	$delta         = $current_float - $base_float;

	return match ( $type ) {
		'integer' => signed_number( $delta, 0 ),
		'memory'  => signed_number( $delta / 1048576, 1 ) . ' MiB',
		default   => 0.0 !== $base_float ? signed_number( $delta / $base_float * 100, 1 ) . '%' : signed_number( $delta, 3 ) . ' ms',
	};
}

/**
 * Checks whether a metric delta is large enough for the visible summary.
 *
 * @param float  $delta Metric delta.
 * @param float  $base  Base metric value.
 * @param string $type  Metric formatting type.
 */
function is_notable_metric_change( float $delta, float $base, string $type ): bool {
	if ( 0.0 === $delta ) {
		return false;
	}

	if ( 'number' !== $type ) {
		return true;
	}

	return 0.0 === $base || abs( $delta / $base ) >= 0.10;
}

/**
 * Formats the visible comparison summary.
 *
 * @param array{total:int,better:int,worse:int,same:int} $summary
 */
function comparison_summary_text( array $summary ): string {
	if ( 0 === $summary['total'] ) {
		return 'Summary: no comparable metrics.';
	}

	if ( 0 === $summary['better'] && 0 === $summary['worse'] ) {
		return 'Summary: all ' . $summary['total'] . ' comparable ' . pluralize( $summary['total'], 'metric' ) . ' are unchanged or within noise.';
	}

	return 'Summary: ' . $summary['better'] . ' ' . pluralize( $summary['better'], 'metric' ) . ' notably better, '
		. $summary['worse'] . ' ' . pluralize( $summary['worse'], 'metric' ) . ' notably worse, '
		. $summary['same'] . ' ' . pluralize( $summary['same'], 'metric' ) . ' unchanged or within noise.';
}

function pluralize( int $count, string $singular ): string {
	return 1 === $count ? $singular : $singular . 's';
}

/**
 * @param array<string,mixed> $current
 * @param array<string,mixed> $base
 */
function reports_share_config( array $current, array $base ): bool {
	return is_string( $current['seed_config_hash'] ?? null )
		&& is_string( $base['seed_config_hash'] ?? null )
		&& hash_equals( $base['seed_config_hash'], $current['seed_config_hash'] );
}

function escape_cell( mixed $value ): string {
	return str_replace( array( '|', "\n", "\r" ), array( '\\|', ' ', ' ' ), (string) $value );
}

function number_value( mixed $value, int $decimals = 3 ): string {
	return is_numeric( $value ) ? number_format( (float) $value, $decimals, '.', '' ) : 'n/a';
}

function integer_value( mixed $value ): string {
	return is_numeric( $value ) ? (string) (int) $value : 'n/a';
}

function memory_value( mixed $value ): string {
	return is_numeric( $value ) ? number_format( (float) $value / 1048576, 1, '.', '' ) . ' MiB' : 'n/a';
}

function failure_value( string $metric, mixed $value ): string {
	if ( 'memory_bytes_p95' === $metric ) {
		return memory_value( $value );
	}

	if ( str_starts_with( $metric, 'sql_queries_' ) ) {
		return integer_value( $value );
	}

	return number_value( $value );
}

function signed_number( float $value, int $decimals ): string {
	$formatted = number_format( $value, $decimals, '.', '' );
	if ( $value > 0 ) {
		return '+' . $formatted;
	}

	return $formatted;
}

/**
 * @param array<int,string> $headers
 * @param array<int,string> $alignments
 * @param array<int,array<int,string>> $rows
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
