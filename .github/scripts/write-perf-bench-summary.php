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
	$metrics           = array(
		array( 'p50_ms', 'number' ),
		array( 'p95_ms', 'number' ),
		array( 'sql_queries_p95', 'integer' ),
		array( 'memory_bytes_p95', 'memory' ),
	);

	foreach ( $current_scenarios as $scenario_id => $scenario ) {
		if ( ! is_array( $scenario ) || ! isset( $base_scenarios[ $scenario_id ] ) || ! is_array( $base_scenarios[ $scenario_id ] ) ) {
			continue;
		}

		$base_scenario = $base_scenarios[ $scenario_id ];
		foreach ( $metrics as $metric ) {
			$change_summary = add_metric_change(
				$change_summary,
				$scenario[ $metric[0] ] ?? null,
				$base_scenario[ $metric[0] ] ?? null,
				$metric[1]
			);
		}

		$rows[] = array(
			escape_cell( $scenario['label'] ?? $scenario_id ),
			comparison_value( $scenario['p50_ms'] ?? null, $base_scenario['p50_ms'] ?? null, 'number' ),
			comparison_value( $scenario['p95_ms'] ?? null, $base_scenario['p95_ms'] ?? null, 'number' ),
			comparison_value( $scenario['sql_queries_p95'] ?? null, $base_scenario['sql_queries_p95'] ?? null, 'integer' ),
			comparison_value( $scenario['memory_bytes_p95'] ?? null, $base_scenario['memory_bytes_p95'] ?? null, 'memory' ),
		);
	}

	if ( count( $rows ) === 0 ) {
		$lines[] = 'No shared scenarios to compare.';
		return $lines;
	}

	$lines[] = comparison_summary_text( $change_summary );
	$lines[] = '';
	$lines[] = '<details>';
	$lines[] = '<summary>Show metric comparison table</summary>';
	$lines[] = '';

	foreach (
		markdown_table(
			array( 'Scenario', 'p50 ms', 'p95 ms', 'SQL p95', 'Memory p95' ),
			array( 'left', 'right', 'right', 'right', 'right' ),
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
 * Creates empty metric change counts.
 *
 * @return array{total:int,better:int,worse:int,same:int}
 */
function empty_change_summary(): array {
	return array(
		'total'  => 0,
		'better' => 0,
		'worse'  => 0,
		'same'   => 0,
	);
}

/**
 * Counts one comparable metric change.
 *
 * @param array{total:int,better:int,worse:int,same:int} $summary
 * @param mixed                                          $current Current metric value.
 * @param mixed                                          $base    Base metric value.
 * @param string                                         $type    Metric formatting type.
 * @return array{total:int,better:int,worse:int,same:int}
 */
function add_metric_change( array $summary, mixed $current, mixed $base, string $type ): array {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return $summary;
	}

	$current_float = (float) $current;
	$base_float    = (float) $base;
	$delta         = $current_float - $base_float;
	$notable       = is_notable_metric_change( $delta, $base_float, $type );

	++$summary['total'];

	if ( ! $notable ) {
		++$summary['same'];
	} elseif ( $current_float < $base_float ) {
		++$summary['better'];
	} else {
		++$summary['worse'];
	}

	return $summary;
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

function comparison_value( mixed $current, mixed $base, string $type ): string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return 'n/a';
	}

	return formatted_value( $current, $type ) . ' (Δ ' . delta_value( $current, $base, $type ) . ')';
}

function formatted_value( mixed $value, string $type ): string {
	return match ( $type ) {
		'integer' => integer_value( $value ),
		'memory'  => memory_value( $value ),
		default   => number_value( $value ),
	};
}

function delta_value( mixed $current, mixed $base, string $type ): string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return 'n/a';
	}

	$current_float = (float) $current;
	$base_float    = (float) $base;
	$delta         = $current_float - $base_float;
	$percent       = 0.0 !== $base_float ? $delta / $base_float * 100 : null;
	$delta_text    = match ( $type ) {
		'integer' => signed_number( $delta, 0 ),
		'memory'  => signed_number( $delta / 1048576, 1 ) . ' MiB',
		default   => signed_number( $delta, 3 ) . ' ms',
	};

	if ( null === $percent ) {
		return $delta_text;
	}

	return $delta_text . ', ' . signed_number( $percent, 1 ) . '%';
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
