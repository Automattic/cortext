#!/usr/bin/env php
<?php
declare(strict_types=1);

$args                 = parse_args( $argv );
$current_path         = $args['current'] ?? 'artifacts/perf-bench.json';
$base_path            = $args['base'] ?? '';
$base_label           = $args['base-label'] ?? 'base';
$summary_path         = $args['summary'] ?? getenv( 'GITHUB_STEP_SUMMARY' );
$comparison_only      = isset( $args['comparison-only'] ) && '0' !== $args['comparison-only'];
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
			++$depth;
		} elseif ( '}' === $char ) {
			--$depth;
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
	$base               = load_report( $base_path, "{$base_label} benchmark" );
	$escaped_base_label = escape_cell( $base_label );
	$lines              = array(
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
	$metrics           = comparison_metric_definitions( $current_scenarios, $base_scenarios );

	if ( count( $metrics ) === 0 ) {
		$lines[] = 'No comparable metrics to compare.';
		return $lines;
	}

	$changed_rows  = array();
	$unchanged     = 0;
	$total_compared = 0;

	foreach ( $current_scenarios as $scenario_id => $scenario ) {
		if ( ! is_array( $scenario ) || ! isset( $base_scenarios[ $scenario_id ] ) || ! is_array( $base_scenarios[ $scenario_id ] ) ) {
			continue;
		}

		++$total_compared;

		$bucketed = scenario_change_buckets( $scenario, $base_scenarios[ $scenario_id ], $metrics );
		if ( ! $bucketed['has_changes'] ) {
			++$unchanged;
			continue;
		}

		$changed_rows[] = array(
			escape_cell( $scenario['label'] ?? $scenario_id ),
			format_change_cell( $bucketed['timing'] ),
			format_change_cell( $bucketed['deterministic'] ),
		);
	}

	if ( 0 === $total_compared ) {
		$lines[] = 'No shared scenarios to compare.';
		return $lines;
	}

	if ( count( $changed_rows ) === 0 ) {
		$lines[] = 'All ' . $total_compared . ' ' . pluralize( $total_compared, 'scenario' ) . ' within noise.';
		return $lines;
	}

	$changed = count( $changed_rows );
	$headline = $changed . ' of ' . $total_compared . ' ' . pluralize( $total_compared, 'scenario' ) . ' changed';
	if ( $unchanged > 0 ) {
		$headline .= '; ' . $unchanged . ' within noise';
	}
	$lines[] = $headline . '.';

	$lines[] = '';
	$lines[] = '<details>';
	$lines[] = '<summary>Show changes</summary>';
	$lines[] = '';

	foreach (
		markdown_table(
			array( 'Scenario', 'Timing', 'Deterministic' ),
			array( 'left', 'left', 'left' ),
			$changed_rows
		) as $table_line
	) {
		$lines[] = $table_line;
	}

	$lines[] = '';
	$lines[] = '</details>';
	$lines[] = '';
	$lines[] = '_Timing deltas count when the change exceeds max(10%, 2x baseline MAD). SQL counts and memory are deterministic; any non-zero delta is counted._';

	return $lines;
}

/**
 * Buckets metric changes for one scenario into timing vs deterministic groups.
 *
 * @param array<string,mixed>                                   $scenario      Current scenario.
 * @param array<string,mixed>                                   $base_scenario Base scenario.
 * @param array<int,array{key:string,label:string,type:string}> $metrics       Comparable metrics.
 * @return array{has_changes:bool,timing:array<int,string>,deterministic:array<int,string>}
 */
function scenario_change_buckets( array $scenario, array $base_scenario, array $metrics ): array {
	$timing        = array();
	$deterministic = array();

	foreach ( $metrics as $metric ) {
		$current      = $scenario[ $metric['key'] ] ?? null;
		$base         = $base_scenario[ $metric['key'] ] ?? null;
		$baseline_mad = paired_baseline_mad( $metric['key'], $base_scenario );
		$change       = metric_change_kind( $current, $base, $metric['type'], $baseline_mad );

		if ( 'missing' === $change || 'same' === $change ) {
			continue;
		}

		$text = $metric['label'] . ' ' . short_delta_value( $current, $base, $metric['type'] );
		if ( 'number' === $metric['type'] ) {
			$timing[] = $text;
		} else {
			$deterministic[] = $text;
		}
	}

	return array(
		'has_changes'   => count( $timing ) > 0 || count( $deterministic ) > 0,
		'timing'        => $timing,
		'deterministic' => $deterministic,
	);
}

/**
 * Renders a list of change strings as a single comparison table cell.
 *
 * @param array<int,string> $changes Change strings.
 */
function format_change_cell( array $changes ): string {
	if ( count( $changes ) === 0 ) {
		return '-';
	}

	return implode( ', ', array_map( 'escape_cell', $changes ) );
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
 *
 * Excludes metrics that would inflate the notable count without adding signal:
 * - `runs` is the sample count, not a measurement.
 * - `mad_ms` / `*_mad_ms` is the noise floor; used to scale the timing threshold,
 *   not displayed.
 * - `p95_ms` / `*_p95_ms` (timing) is too noisy with the iteration counts we run
 *   in CI; p50 is the primary timing signal. SQL/memory p95 stay because they
 *   are deterministic across iterations.
 * - `sql_queries_p50` / `memory_bytes_p50` are redundant with their p95 siblings
 *   (deterministic metrics produce the same value at every percentile).
 */
function should_compare_metric( string $key, mixed $current, mixed $base ): bool {
	if ( 'runs' === $key ) {
		return false;
	}

	if ( is_timing_dispersion_key( $key ) ) {
		return false;
	}

	if ( is_timing_p95_key( $key ) ) {
		return false;
	}

	if ( 'sql_queries_p50' === $key || 'memory_bytes_p50' === $key ) {
		return false;
	}

	// `total_p50_ms` duplicates the scenario's aggregate `p50_ms` in stepped
	// scenarios. The per-step keys (`resolve_*`, `hydrate_*`, ...) still pass.
	if ( 'total_p50_ms' === $key ) {
		return false;
	}

	return is_numeric( $current ) && is_numeric( $base );
}

/**
 * Identifies timing dispersion keys (`mad_ms`, `<step>_mad_ms`).
 */
function is_timing_dispersion_key( string $key ): bool {
	return 'mad_ms' === $key || (bool) preg_match( '/_mad_ms$/', $key );
}

/**
 * Identifies timing p95 keys (`p95_ms`, `<step>_p95_ms`).
 *
 * Deterministic p95 metrics (`sql_queries_p95`, `memory_bytes_p95`) do not match
 * this pattern because they end in `_p95`, not `_p95_ms`.
 */
function is_timing_p95_key( string $key ): bool {
	return 'p95_ms' === $key || (bool) preg_match( '/_p95_ms$/', $key );
}

/**
 * Identifies timing p50 keys (`p50_ms`, `<step>_p50_ms`).
 */
function is_timing_p50_key( string $key ): bool {
	return 'p50_ms' === $key || (bool) preg_match( '/_p50_ms$/', $key );
}

/**
 * Returns the baseline MAD that pairs with a timing p50 metric, or null if not
 * available. `p50_ms` pairs with `mad_ms`; `<step>_p50_ms` pairs with
 * `<step>_mad_ms`.
 *
 * @param array<string,mixed> $base_scenario Base scenario report.
 */
function paired_baseline_mad( string $key, array $base_scenario ): ?float {
	if ( ! is_timing_p50_key( $key ) ) {
		return null;
	}

	$mad_key = 'p50_ms' === $key ? 'mad_ms' : preg_replace( '/_p50_ms$/', '_mad_ms', $key );
	if ( ! is_string( $mad_key ) || ! isset( $base_scenario[ $mad_key ] ) || ! is_numeric( $base_scenario[ $mad_key ] ) ) {
		return null;
	}

	return (float) $base_scenario[ $mad_key ];
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

function metric_change_kind( mixed $current, mixed $base, string $type, ?float $baseline_mad = null ): string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return 'missing';
	}

	$current_float = (float) $current;
	$base_float    = (float) $base;
	$delta         = $current_float - $base_float;

	if ( ! is_notable_metric_change( $delta, $base_float, $type, $baseline_mad ) ) {
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
 * Checks whether a metric delta is large enough to count as a notable change.
 *
 * Deterministic metrics (SQL counts, memory bytes) count any non-zero delta.
 *
 * Timing metrics use a 10% floor against the baseline value. When the baseline
 * reported a MAD (median absolute deviation), the floor scales up to twice the
 * baseline MAD relative to the median, which keeps natural per-run jitter out
 * of the notable count for scenarios with high variance.
 *
 * @param float      $delta        Metric delta.
 * @param float      $base         Base metric value.
 * @param string     $type         Metric formatting type.
 * @param float|null $baseline_mad Baseline MAD for the paired timing metric.
 */
function is_notable_metric_change( float $delta, float $base, string $type, ?float $baseline_mad = null ): bool {
	if ( 0.0 === $delta ) {
		return false;
	}

	if ( 'number' !== $type ) {
		return true;
	}

	if ( 0.0 === $base ) {
		return true;
	}

	$threshold = 0.10;
	if ( null !== $baseline_mad && $baseline_mad > 0.0 ) {
		$threshold = max( $threshold, 2.0 * ( $baseline_mad / $base ) );
	}

	return abs( $delta / $base ) >= $threshold;
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
 * @param array<int,string>            $headers
 * @param array<int,string>            $alignments
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
