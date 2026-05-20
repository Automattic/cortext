#!/usr/bin/env php
<?php
/**
 * Builds the unified Performance vs <base> comment posted on PRs.
 *
 * Consumes the backend bench JSON and the UI bench JSON, merges their
 * scenarios into a single table, and only renders rows that have notable
 * workload or timing changes. Writes the comment body to stdout.
 *
 * Workload column (deterministic; any non-zero delta counts):
 * - bench backend: sql_queries_p95, memory_bytes_p95
 * - UI: no workload metric. rest_request_count stays in the per-run summary
 *   because it can move by 1-4 requests at the same paint state.
 *
 * Timing column (noisy; threshold per metric):
 * - bench backend: p50_ms and per-step p50_ms, with threshold
 *   max(10%, 2x baseline MAD) when MAD is available.
 * - UI: ready_ms, rows_api_ms with threshold max(15%, 2x baseline MAD) when
 *   the spec writes a _mad companion key.
 *   long_task_total_ms stays in the per-run summary. It mostly tracks browser
 *   GC and scheduler timing, not server work, so it should not flag scenarios.
 *
 * @package Cortext
 */

declare(strict_types=1);

require_once __DIR__ . '/perf-ui-scenario-labels.php';

$args = parse_args( $argv );

$bench_current      = $args['bench-current'] ?? '';
$bench_base         = $args['bench-base'] ?? '';
$ui_current         = $args['ui-current'] ?? '';
$ui_base            = $args['ui-base'] ?? '';
$base_label         = $args['base-label'] ?? 'base';
$run_url            = $args['run-url'] ?? '';
$exit_on_regression = isset( $args['exit-on-regression'] );

$result = build_comment( $bench_current, $bench_base, $ui_current, $ui_base, $base_label, $run_url );
// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI markdown output for GitHub PR comments stays unescaped.
echo $result['comment'];

if ( $exit_on_regression && $result['has_regression'] ) {
	exit( 1 );
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

/**
 * @return array{comment:string,has_regression:bool}
 */
function build_comment( string $bench_current_path, string $bench_base_path, string $ui_current_path, string $ui_base_path, string $base_label, string $run_url ): array {
	$rows               = array();
	$missing_baselines  = array();

	if ( '' !== $bench_current_path && '' !== $bench_base_path ) {
		if ( null === read_json( $bench_base_path ) ) {
			$missing_baselines[] = 'backend';
		} else {
			$rows = array_merge( $rows, collect_bench_rows( $bench_current_path, $bench_base_path ) );
		}
	}

	if ( '' !== $ui_current_path && '' !== $ui_base_path ) {
		if ( null === read_json( $ui_base_path ) ) {
			$missing_baselines[] = 'UI';
		} else {
			$rows = array_merge( $rows, collect_ui_rows( $ui_current_path, $ui_base_path ) );
		}
	}

	$workload_scenarios = 0;
	$timing_scenarios   = 0;
	foreach ( $rows as $row ) {
		if ( '' !== $row['workload'] ) {
			++$workload_scenarios;
		}
		if ( '' !== $row['timing'] ) {
			++$timing_scenarios;
		}
	}

	$lines = array( '## Performance vs ' . $base_label, '' );

	if ( count( $missing_baselines ) > 0 ) {
		// The baseline run failed or did not produce JSON. Say that directly
		// instead of printing a comparison table with no useful comparison.
		// The PR-side numbers still appear in the job summary.
		$lines[] = 'Baseline data unavailable for ' . implode( ' and ', $missing_baselines ) . ' - comparison skipped. Re-run the workflow or check the baseline steps in the job log.';
	} else {
		$lines[] = build_headline( $workload_scenarios, $timing_scenarios );
	}

	if ( count( $rows ) > 0 ) {
		$table_rows = array();
		foreach ( $rows as $row ) {
			$table_rows[] = array(
				$row['label'],
				'' === $row['workload'] ? '-' : $row['workload'],
				'' === $row['timing'] ? '-' : $row['timing'],
			);
		}

		$lines[] = '';
		foreach ( markdown_table( array( 'Scenario', 'Workload', 'Timing' ), array( 'left', 'left', 'left' ), $table_rows ) as $line ) {
			$lines[] = $line;
		}
	}

	if ( '' !== $run_url ) {
		$lines[] = '';
		$lines[] = '_Full numbers in the [job summary](' . $run_url . ')._';
	}

	return array(
		'comment'        => implode( "\n", $lines ) . "\n",
		'has_regression' => rows_have_regression( $rows ),
	);
}

/**
 * Returns true if any row has a positive (regression) delta in workload or
 * timing. Improvements (delta with `-` prefix) don't count, so the workflow
 * doesn't fail on a -20% timing or a -2 SQL queries change.
 *
 * @param array<int,array{label:string,workload:string,timing:string}> $rows
 */
function rows_have_regression( array $rows ): bool {
	foreach ( $rows as $row ) {
		if ( 1 === preg_match( '/\+\d/', $row['workload'] ) ) {
			return true;
		}
		if ( 1 === preg_match( '/\+\d/', $row['timing'] ) ) {
			return true;
		}
	}
	return false;
}

function build_headline( int $workload_scenarios, int $timing_scenarios ): string {
	if ( 0 === $workload_scenarios && 0 === $timing_scenarios ) {
		return 'No workload changes. Timings within jitter.';
	}

	$parts = array();
	if ( $workload_scenarios > 0 ) {
		$parts[] = 'Workload changed in ' . $workload_scenarios . ' ' . scenarios_word( $workload_scenarios ) . '.';
	}
	if ( $timing_scenarios > 0 ) {
		$parts[] = $timing_scenarios . ' ' . scenarios_word( $timing_scenarios ) . ' with notable timing changes.';
	}

	return implode( ' ', $parts );
}

function scenarios_word( int $count ): string {
	return 1 === $count ? 'scenario' : 'scenarios';
}

/**
 * Collects backend bench rows that show at least one notable change.
 *
 * @return array<int,array{label:string,workload:string,timing:string}>
 */
function collect_bench_rows( string $current_path, string $base_path ): array {
	$current = read_json( $current_path );
	$base    = read_json( $base_path );
	if ( null === $current || null === $base ) {
		return array();
	}

	if ( ! reports_share_config( $current, $base ) ) {
		return array();
	}

	$current_scenarios = is_array( $current['scenarios'] ?? null ) ? $current['scenarios'] : array();
	$base_scenarios    = is_array( $base['scenarios'] ?? null ) ? $base['scenarios'] : array();

	$rows = array();
	foreach ( $current_scenarios as $scenario_id => $scenario ) {
		if ( ! is_array( $scenario ) || ! isset( $base_scenarios[ $scenario_id ] ) || ! is_array( $base_scenarios[ $scenario_id ] ) ) {
			continue;
		}

		$base_scenario = $base_scenarios[ $scenario_id ];

		$workload_changes = array();
		$timing_changes   = array();

		$sql_change = workload_change( $scenario['sql_queries_p95'] ?? null, $base_scenario['sql_queries_p95'] ?? null );
		if ( null !== $sql_change ) {
			$workload_changes[] = $sql_change . ' SQL ' . ( 1 === abs( (int) $sql_change ) ? 'query' : 'queries' );
		}

		$memory_change = memory_change( $scenario['memory_bytes_p95'] ?? null, $base_scenario['memory_bytes_p95'] ?? null );
		if ( null !== $memory_change ) {
			$workload_changes[] = $memory_change . ' MiB peak memory';
		}

		foreach ( collect_bench_timing_keys( $scenario ) as $key ) {
			$timing_change = bench_timing_change( $scenario[ $key ] ?? null, $base_scenario[ $key ] ?? null, $base_scenario[ pair_mad_key( $key ) ] ?? null );
			if ( null !== $timing_change ) {
				$timing_changes[] = bench_timing_label( $key ) . ' ' . $timing_change;
			}
		}

		if ( 0 === count( $workload_changes ) && 0 === count( $timing_changes ) ) {
			continue;
		}

		$rows[] = array(
			'label'    => escape_cell( $scenario['label'] ?? $scenario_id ),
			'workload' => implode( ', ', $workload_changes ),
			'timing'   => implode( ', ', $timing_changes ),
		);
	}

	return $rows;
}

/**
 * Returns the p50 timing keys present on the scenario, including stepped keys.
 * `total_p50_ms` is excluded because it duplicates the aggregate `p50_ms`.
 *
 * @param array<string,mixed> $scenario
 * @return array<int,string>
 */
function collect_bench_timing_keys( array $scenario ): array {
	$keys = array();
	foreach ( $scenario as $key => $value ) {
		if ( ! is_string( $key ) || ! is_numeric( $value ) ) {
			continue;
		}
		if ( 'total_p50_ms' === $key ) {
			continue;
		}
		if ( 'p50_ms' === $key || (bool) preg_match( '/_p50_ms$/', $key ) ) {
			$keys[] = $key;
		}
	}
	return $keys;
}

function bench_timing_label( string $key ): string {
	if ( 'p50_ms' === $key ) {
		return 'p50';
	}

	if ( preg_match( '/^(.+)_p50_ms$/', $key, $matches ) ) {
		return ucwords( str_replace( '_', ' ', $matches[1] ) ) . ' p50';
	}

	return $key;
}

function pair_mad_key( string $p50_key ): string {
	if ( 'p50_ms' === $p50_key ) {
		return 'mad_ms';
	}
	return (string) preg_replace( '/_p50_ms$/', '_mad_ms', $p50_key );
}

/**
 * Collects UI bench rows that show at least one notable change.
 *
 * @return array<int,array{label:string,workload:string,timing:string}>
 */
function collect_ui_rows( string $current_path, string $base_path ): array {
	$current = read_json( $current_path );
	$base    = read_json( $base_path );
	if ( null === $current || null === $base ) {
		return array();
	}

	$current_scenarios = is_array( $current['scenarios'] ?? null ) ? $current['scenarios'] : array();
	$base_scenarios    = is_array( $base['scenarios'] ?? null ) ? $base['scenarios'] : array();
	$labels            = perf_ui_scenario_labels();

	$rows = array();
	foreach ( $current_scenarios as $scenario_id => $scenario ) {
		if ( ! is_array( $scenario ) || ! isset( $base_scenarios[ $scenario_id ] ) || ! is_array( $base_scenarios[ $scenario_id ] ) ) {
			continue;
		}

		$base_scenario    = $base_scenarios[ $scenario_id ];
		$workload_changes = array();
		$timing_changes   = array();

		foreach ( array( 'ready_ms' => 'ready', 'rows_api_ms' => 'rows API' ) as $key => $label ) {
			$change = ui_timing_change(
				$scenario[ $key ] ?? null,
				$base_scenario[ $key ] ?? null,
				$base_scenario[ $key . '_mad' ] ?? null
			);
			if ( null !== $change ) {
				$timing_changes[] = $label . ' ' . $change;
			}
		}

		if ( 0 === count( $workload_changes ) && 0 === count( $timing_changes ) ) {
			continue;
		}

		$rows[] = array(
			'label'    => escape_cell( $labels[ $scenario_id ] ?? $scenario_id ),
			'workload' => implode( ', ', $workload_changes ),
			'timing'   => implode( ', ', $timing_changes ),
		);
	}

	return $rows;
}

/**
 * Formats a non-zero integer delta. Returns null when there is no change or
 * one side is missing.
 */
function workload_change( mixed $current, mixed $base ): ?string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return null;
	}
	$delta = (int) $current - (int) $base;
	if ( 0 === $delta ) {
		return null;
	}
	return signed_number( (float) $delta, 0 );
}

/**
 * Formats a non-zero memory delta in MiB. Returns null when there is no
 * meaningful change (under 0.05 MiB) or one side is missing.
 */
function memory_change( mixed $current, mixed $base ): ?string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return null;
	}
	$delta_mib = ( (float) $current - (float) $base ) / 1048576.0;
	if ( abs( $delta_mib ) < 0.05 ) {
		return null;
	}
	return signed_number( $delta_mib, 1 );
}

/**
 * Returns the timing change text for a backend p50 metric when |Δ| exceeds
 * max(10%, 2x baseline MAD%). Null when within noise or values missing.
 */
function bench_timing_change( mixed $current, mixed $base, mixed $baseline_mad ): ?string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return null;
	}
	$base_float = (float) $base;
	if ( 0.0 === $base_float ) {
		return null;
	}
	$delta_pct = ( (float) $current - $base_float ) / $base_float * 100.0;
	$threshold = 10.0;
	if ( is_numeric( $baseline_mad ) && (float) $baseline_mad > 0.0 ) {
		$threshold = max( 10.0, 2.0 * (float) $baseline_mad / $base_float * 100.0 );
	}
	if ( abs( $delta_pct ) < $threshold ) {
		return null;
	}
	return signed_number( $delta_pct, 1 ) . '%';
}

/**
 * Returns the timing change text for a UI metric when |Δ| exceeds
 * max(15%, 2x baseline MAD%). Null when values are missing or still inside
 * the noise floor.
 *
 * When the spec aggregates samples (PERF_UI_ITERATIONS > 1), it writes a
 * <metric>_mad companion. We use 2x MAD as the noise floor and only flag
 * deltas above max(15%, 2*MAD/base*100%). Without MAD, we keep the flat 15%
 * threshold used for a single reading.
 */
function ui_timing_change( mixed $current, mixed $base, mixed $baseline_mad = null ): ?string {
	if ( ! is_numeric( $current ) || ! is_numeric( $base ) ) {
		return null;
	}
	$base_float = (float) $base;
	if ( 0.0 === $base_float ) {
		return null;
	}
	$delta_pct = ( (float) $current - $base_float ) / $base_float * 100.0;
	$threshold = 15.0;
	if ( is_numeric( $baseline_mad ) && (float) $baseline_mad > 0.0 ) {
		$threshold = max( 15.0, 2.0 * (float) $baseline_mad / $base_float * 100.0 );
	}
	if ( abs( $delta_pct ) < $threshold ) {
		return null;
	}
	return signed_number( $delta_pct, 1 ) . '%';
}

function read_json( string $path ): ?array {
	if ( ! is_file( $path ) || 0 === filesize( $path ) ) {
		return null;
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Standalone CI helper reading local artifacts.
	$raw = file_get_contents( $path );
	if ( false === $raw ) {
		return null;
	}
	$json = extract_first_json_object( $raw );
	if ( null === $json ) {
		return null;
	}
	$decoded = json_decode( $json, true );
	return is_array( $decoded ) ? $decoded : null;
}

function extract_first_json_object( string $raw ): ?string {
	$start = strpos( $raw, '{' );
	if ( false === $start ) {
		return null;
	}
	$depth     = 0;
	$in_string = false;
	$escaped   = false;
	$length    = strlen( $raw );
	for ( $i = $start; $i < $length; $i++ ) {
		$char = $raw[ $i ];
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
				return substr( $raw, $start, $i - $start + 1 );
			}
		}
	}
	return null;
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

function signed_number( float $value, int $decimals ): string {
	$formatted = number_format( $value, $decimals, '.', '' );
	if ( $value > 0 ) {
		return '+' . $formatted;
	}
	return $formatted;
}

function escape_cell( mixed $value ): string {
	return str_replace( array( '|', "\n", "\r" ), array( '\\|', ' ', ' ' ), (string) $value );
}

/**
 * Builds an aligned GitHub-flavored markdown table.
 *
 * @param array<int,string>            $headers    Column headers.
 * @param array<int,string>            $alignments `left` or `right` per column.
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
