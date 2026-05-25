<?php
/**
 * WP-CLI benchmark for collection performance.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\CLI;

use Cortext\FieldValues\FieldValueIndex;
use Cortext\FieldValues\FieldValueStore;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\Relations;
use RuntimeException;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class PerfBench {

	private const DATASET_OPTION             = 'cortext_perf_dataset';
	private const DATASET_META_KEY           = '_cortext_perf_dataset';
	private const DATASET_META_VALUE         = 'collection-perf-v1';
	private const DATASET_SEED               = 'collection-perf-v1';
	private const DEFAULT_COLLECTIONS        = 3;
	private const DEFAULT_ROWS               = 1250;
	private const DEFAULT_FIELDS             = 8;
	private const DEFAULT_WIDE_FIELDS        = 40;
	private const MIN_FIELDS                 = 7;
	private const DEFAULT_RELATIONS          = 1;
	private const DEFAULT_ROLLUPS            = 1;
	private const DEFAULT_ITERATIONS         = 7;
	private const DEFAULT_WARMUP             = 1;
	private const PAGE_SIZE                  = 25;
	private const PAGE_50_ROWS               = 1250;
	private const MIGRATION_CAP_ROWS         = 1000;
	private const RELATION_TARGETS           = 250;
	private const RELATION_BASE_TARGETS      = 3;
	private const RELATION_HYDRATION_TARGETS = 40;
	private const ROLLUP_HEAVY_TARGETS       = 80;

	private static bool $rest_routes_initialized = false;

	/**
	 * Seeds a benchmark dataset.
	 *
	 * ## OPTIONS
	 *
	 * [--collections=<count>]
	 * : Number of collections to seed. Default: 3.
	 *
	 * [--rows=<count>]
	 * : Rows per collection. Default: 1250.
	 *
	 * [--fields=<count>]
	 * : Scalar fields on the primary and target collections. Default: 8. Minimum: 7.
	 *
	 * [--wide-fields=<count>]
	 * : Scalar fields on the separate wide collection. Default: 40.
	 *
	 * [--relations=<count>]
	 * : Relation fields from the primary collection to target collections. Default: 1.
	 *
	 * [--rollups=<count>]
	 * : Rollup fields on the primary collection. Default: 1.
	 *
	 * [--reset]
	 * : Delete the existing benchmark dataset first.
	 *
	 * [--force]
	 * : Skip confirmation for --reset.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext perf-seed --reset --force
	 *     wp cortext perf-seed --collections=3 --rows=1250 --fields=8 --wide-fields=40 --relations=1 --rollups=1
	 *
	 * @when after_wp_load
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public static function seed( array $args, array $assoc_args ): void {
		unset( $args );

		$bench = new self();
		$reset = self::flag_bool( $assoc_args, 'reset', false );

		if ( $reset ) {
			\WP_CLI::confirm(
				'Delete the existing Cortext benchmark dataset?',
				array( 'yes' => self::flag_bool( $assoc_args, 'force', false ) )
			);
		}

		try {
			$started_at = hrtime( true );
			$manifest   = $bench->seed_dataset( self::seed_config_from_args( $assoc_args ), $reset );
			$elapsed_ms = self::elapsed_ms( $started_at );
		} catch ( RuntimeException $exception ) {
			\WP_CLI::error( $exception->getMessage() );
			return;
		}

		\WP_CLI::line(
			wp_json_encode(
				array(
					'seed'      => self::DATASET_SEED,
					'reused'    => (bool) ( $manifest['reused'] ?? false ),
					'elapsedMs' => $elapsed_ms,
					'dataset'   => self::public_dataset_summary( $manifest ),
				),
				JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
			)
		);
		\WP_CLI::success( 'Cortext benchmark dataset is ready.' );
	}

	/**
	 * Runs the benchmark and prints JSON.
	 *
	 * ## OPTIONS
	 *
	 * [--iterations=<count>]
	 * : Timed runs per scenario. Default: 7.
	 *
	 * [--warmup=<count>]
	 * : Warm-up runs per scenario. Default: 1.
	 *
	 * [--budget=<path>]
	 * : JSON budget file. Default: includes/CLI/perf-budgets.json.
	 *
	 * [--fail-on-budget]
	 * : Exit with an error when a scenario exceeds its budget.
	 *
	 * [--suite=<suite>]
	 * : Suite to run. Use "default" for CI budget checks or "materialization"
	 * for field-value index work. Default: default.
	 *
	 * [--scenario=<pattern>]
	 * : Run only scenario IDs containing this text.
	 *
	 * [--pretty]
	 * : Pretty-print JSON.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext perf-bench --pretty
	 *     wp cortext perf-bench --budget=includes/CLI/perf-budgets.json --fail-on-budget
	 *
	 * @when after_wp_load
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public static function bench( array $args, array $assoc_args ): void {
		unset( $args );

		$bench       = new self();
		$iterations  = self::flag_int( $assoc_args, 'iterations', self::DEFAULT_ITERATIONS, 1 );
		$warmup      = self::flag_int( $assoc_args, 'warmup', self::DEFAULT_WARMUP, 0 );
		$suite       = (string) ( $assoc_args['suite'] ?? 'default' );
		$scenario    = isset( $assoc_args['scenario'] ) ? (string) $assoc_args['scenario'] : '';
		$budget_path = self::normalize_local_path(
			(string) ( $assoc_args['budget'] ?? CORTEXT_PATH . 'includes/CLI/perf-budgets.json' )
		);
		$budget      = $bench->load_budget( $budget_path );

		try {
			$result = $bench->run_benchmark( $iterations, $warmup, $budget, $budget_path, $suite, $scenario );
		} catch ( RuntimeException $exception ) {
			\WP_CLI::error( $exception->getMessage() );
			return;
		}

		$options = JSON_UNESCAPED_SLASHES;
		if ( self::flag_bool( $assoc_args, 'pretty', false ) ) {
			$options |= JSON_PRETTY_PRINT;
		}
		\WP_CLI::line( wp_json_encode( $result, $options ) );

		if ( self::flag_bool( $assoc_args, 'fail-on-budget', false ) && ! $result['passed'] ) {
			\WP_CLI::error( 'Cortext benchmark budget exceeded.' );
		}
	}

	/**
	 * Summarizes measured samples.
	 *
	 * @param array<int,array{latency_ms:float,sql_queries:int,memory_bytes:int}> $samples Samples.
	 * @return array<string,int|float>
	 */
	public static function summarize_samples( array $samples ): array {
		$latencies = array_column( $samples, 'latency_ms' );
		$queries   = array_column( $samples, 'sql_queries' );
		$memory    = array_column( $samples, 'memory_bytes' );

		return array(
			'runs'             => count( $samples ),
			'p50_ms'           => round( (float) self::percentile( $latencies, 50 ), 3 ),
			'p95_ms'           => round( (float) self::percentile( $latencies, 95 ), 3 ),
			'mad_ms'           => round( (float) self::mad( $latencies ), 3 ),
			'sql_queries_p50'  => (int) self::percentile( $queries, 50 ),
			'sql_queries_p95'  => (int) self::percentile( $queries, 95 ),
			'memory_bytes_p50' => (int) self::percentile( $memory, 50 ),
			'memory_bytes_p95' => (int) self::percentile( $memory, 95 ),
		);
	}

	/**
	 * Checks each summary against its budget.
	 *
	 * @param array<string,array<string,int|float|string>> $scenarios Scenario summaries keyed by scenario ID.
	 * @param array<string,mixed>                          $budget    Decoded budget file.
	 * @return array{scenarios:array<string,array<string,mixed>>,passed:bool,failures:array<int,array<string,mixed>>}
	 */
	public static function apply_budgets( array $scenarios, array $budget ): array {
		$budget_scenarios = isset( $budget['scenarios'] ) && is_array( $budget['scenarios'] )
			? $budget['scenarios']
			: array();
		$failures         = array();
		$with_budgets     = array();

		foreach ( $scenarios as $name => $summary ) {
			$limits           = isset( $budget_scenarios[ $name ] ) && is_array( $budget_scenarios[ $name ] )
				? $budget_scenarios[ $name ]
				: array();
			$scenario_failure = array();

			foreach ( array( 'p95_ms', 'sql_queries_p95', 'memory_bytes_p95' ) as $metric ) {
				if ( ! isset( $limits[ $metric ], $summary[ $metric ] ) ) {
					continue;
				}

				$actual = (float) $summary[ $metric ];
				$limit  = (float) $limits[ $metric ];
				if ( $actual > $limit ) {
					$scenario_failure[] = array(
						'metric' => $metric,
						'actual' => $summary[ $metric ],
						'budget' => $limits[ $metric ],
					);
				}
			}

			$with_budgets[ $name ] = array_merge(
				$summary,
				array(
					'budget'   => $limits,
					'passed'   => count( $scenario_failure ) === 0,
					'failures' => $scenario_failure,
				)
			);

			foreach ( $scenario_failure as $failure ) {
				$failures[] = array_merge( array( 'scenario' => $name ), $failure );
			}
		}

		return array(
			'scenarios' => $with_budgets,
			'passed'    => count( $failures ) === 0,
			'failures'  => $failures,
		);
	}

	/**
	 * Seeds the benchmark dataset.
	 *
	 * @param array<string,int> $config Seed configuration.
	 * @param bool              $reset  Whether to clear the existing benchmark dataset.
	 * @return array<string,mixed> Dataset manifest.
	 * @throws RuntimeException When the existing dataset or seed config is invalid.
	 */
	public function seed_dataset( array $config, bool $reset ): array {
		$this->validate_seed_config( $config );
		$this->ensure_post_types();
		$seed_user_id = $this->default_seed_user_id();
		wp_set_current_user( $seed_user_id );

		if ( $reset ) {
			$this->delete_dataset();
		}

		$existing = get_option( self::DATASET_OPTION );
		if ( is_array( $existing ) && self::manifest_matches_config( $existing, $config ) && $this->manifest_is_usable( $existing ) ) {
			$existing['reused'] = true;
			return $existing;
		}

		if ( is_array( $existing ) && ! $reset ) {
			throw new RuntimeException( 'A different Cortext benchmark dataset already exists. Re-run with --reset --force.' );
		}

		$previous_suspend = wp_suspend_cache_invalidation( true );
		wp_defer_term_counting( true );
		wp_defer_comment_counting( true );
		FieldValueIndex::suspend_sync();

		try {
			$manifest = $this->create_dataset( $config, $seed_user_id );
		} finally {
			FieldValueIndex::resume_sync();
			wp_defer_comment_counting( false );
			wp_defer_term_counting( false );
			wp_suspend_cache_invalidation( $previous_suspend );
		}

		$this->rebuild_seeded_field_value_index( $manifest );
		update_option( self::DATASET_OPTION, $manifest, false );
		return $manifest;
	}

	/**
	 * Bulk seeding writes postmeta first, then rebuilds the sidecar once.
	 *
	 * @param array<string,mixed> $manifest Dataset manifest.
	 */
	private function rebuild_seeded_field_value_index( array $manifest ): void {
		$index = new FieldValueIndex();
		if ( ! $index->install() ) {
			return;
		}

		$this->register_dataset_collections( $manifest );
		foreach ( $manifest['collections'] ?? array() as $collection ) {
			$collection_id = (int) ( $collection['id'] ?? 0 );
			if ( $collection_id > 0 ) {
				$index->rebuild_collection( $collection_id );
			}
		}
	}

	/**
	 * Runs each benchmark scenario.
	 *
	 * @param int                 $iterations Measured iterations.
	 * @param int                 $warmup     Warm-up iterations.
	 * @param array<string,mixed> $budget     Budget config.
	 * @param string              $budget_path Budget file path.
	 * @param string              $suite      Benchmark suite.
	 * @param string              $scenario_filter Scenario ID filter.
	 * @return array<string,mixed> Benchmark report.
	 * @throws RuntimeException When the dataset is missing or a scenario fails.
	 */
	public function run_benchmark( int $iterations, int $warmup, array $budget, string $budget_path = 'includes/CLI/perf-budgets.json', string $suite = 'default', string $scenario_filter = '' ): array {
		$started_at = hrtime( true );
		$manifest   = get_option( self::DATASET_OPTION );
		if ( ! is_array( $manifest ) || ! $this->manifest_is_usable( $manifest ) ) {
			throw new RuntimeException( 'Cortext benchmark dataset is missing. Run `wp cortext perf-seed --reset --force` first.' );
		}

		$this->ensure_post_types();
		$this->register_dataset_collections( $manifest );
		$this->ensure_rest_routes();
		wp_set_current_user( $this->default_seed_user_id() );

		if ( 'default' === $suite ) {
			if ( count( $manifest['primary_row_ids'] ?? array() ) < self::PAGE_50_ROWS ) {
				throw new RuntimeException( 'The benchmark needs at least 1250 primary rows for page 50.' );
			}
			if ( count( $manifest['migration_row_ids'] ?? array() ) < self::MIGRATION_CAP_ROWS ) {
				throw new RuntimeException( 'The benchmark needs at least 1000 primary rows for the migration scenario.' );
			}
			if ( (int) ( $manifest['wide_collection_id'] ?? 0 ) < 1 || count( $manifest['wide_row_ids'] ?? array() ) < self::PAGE_SIZE ) {
				throw new RuntimeException( 'The benchmark needs a third collection for the wide schema scenario.' );
			}
			$scenarios = $this->scenario_callbacks( $manifest );
		} elseif ( 'materialization' === $suite ) {
			if ( count( $manifest['primary_row_ids'] ?? array() ) < 10000 ) {
				throw new RuntimeException( 'The materialization suite needs at least 10000 primary rows. Seed with `wp cortext perf-seed --reset --force --collections=1 --rows=10000 --relations=0 --rollups=0` or larger.' );
			}
			$scenarios = $this->materialization_scenario_callbacks( $manifest );
		} else {
			throw new RuntimeException( esc_html( "Unknown benchmark suite: {$suite}." ) );
		}
		$scenarios = $this->filter_scenarios( $scenarios, $scenario_filter );
		$summaries = array();

		foreach ( $scenarios as $name => $scenario ) {
			if ( ! empty( $scenario['single'] ) ) {
				if ( isset( $scenario['prepare'] ) && is_callable( $scenario['prepare'] ) ) {
					$scenario['prepare']();
				}
				$summaries[ $name ] = array_merge(
					array( 'label' => (string) $scenario['label'] ),
					self::summarize_samples( array( $this->measure( $scenario['run'] ) ) )
				);
				continue;
			}

			if ( isset( $scenario['steps'] ) && is_array( $scenario['steps'] ) ) {
				$summaries[ $name ] = $this->run_stepped_scenario( $scenario, $warmup, $iterations );
				continue;
			}

			$samples = array();
			$total   = $warmup + $iterations;
			for ( $index = 0; $index < $total; $index++ ) {
				if ( isset( $scenario['prepare'] ) && is_callable( $scenario['prepare'] ) ) {
					$scenario['prepare']();
				}

				$sample = $this->measure( $scenario['run'] );
				if ( $index >= $warmup ) {
					$samples[] = $sample;
				}
			}

			$summaries[ $name ] = array_merge(
				array( 'label' => (string) $scenario['label'] ),
				self::summarize_samples( $samples )
			);
		}

		$budget_result = self::apply_budgets( $summaries, $budget );

		return array(
			'version'          => 1,
			'suite'            => $suite,
			'scenarioFilter'   => $scenario_filter,
			'seed_config_hash' => self::benchmark_config_hash( $manifest, $budget_path, $suite ),
			'elapsedMs'        => self::elapsed_ms( $started_at ),
			'dataset'          => self::public_dataset_summary( $manifest ),
			'iterations'       => array(
				'warmup'   => $warmup,
				'measured' => $iterations,
			),
			'passed'           => $budget_result['passed'],
			'failures'         => $budget_result['failures'],
			'scenarios'        => $budget_result['scenarios'],
		);
	}

	/**
	 * Limits a benchmark run to matching scenario IDs.
	 *
	 * @param array<string,array<string,mixed>> $scenarios Scenario callbacks.
	 * @param string                            $filter    Scenario ID substring.
	 * @return array<string,array<string,mixed>>
	 * @throws RuntimeException When no scenarios match.
	 */
	private function filter_scenarios( array $scenarios, string $filter ): array {
		$filter = trim( $filter );
		if ( '' === $filter ) {
			return $scenarios;
		}

		$matches = array();

		foreach ( $scenarios as $name => $scenario ) {
			if ( str_contains( $name, $filter ) ) {
				$matches[ $name ] = $scenario;
			}
		}

		if ( count( $matches ) === 0 ) {
			throw new RuntimeException( esc_html( "No benchmark scenarios matched: {$filter}." ) );
		}

		return $matches;
	}

	/**
	 * Builds seed configuration from WP-CLI args.
	 *
	 * @param array<string,mixed> $assoc_args WP-CLI associative args.
	 * @return array<string,int>
	 */
	private static function seed_config_from_args( array $assoc_args ): array {
		return array(
			'collections' => self::flag_int( $assoc_args, 'collections', self::DEFAULT_COLLECTIONS, 1 ),
			'rows'        => self::flag_int( $assoc_args, 'rows', self::DEFAULT_ROWS, 1 ),
			'fields'      => self::flag_int( $assoc_args, 'fields', self::DEFAULT_FIELDS, self::MIN_FIELDS ),
			'wide_fields' => self::flag_int( $assoc_args, 'wide-fields', self::DEFAULT_WIDE_FIELDS, 4 ),
			'relations'   => self::flag_int( $assoc_args, 'relations', self::DEFAULT_RELATIONS, 0 ),
			'rollups'     => self::flag_int( $assoc_args, 'rollups', self::DEFAULT_ROLLUPS, 0 ),
		);
	}

	private function validate_seed_config( array $config ): void {
		if ( (int) $config['fields'] < self::MIN_FIELDS ) {
			throw new RuntimeException( 'Benchmark scenarios require at least 7 scalar fields. Pass --fields=7 or higher.' );
		}
		if ( (int) $config['relations'] > 0 && (int) $config['collections'] < 2 ) {
			throw new RuntimeException( 'Relation scenarios require at least 2 collections, or pass --relations=0 --rollups=0.' );
		}
		if ( (int) $config['rollups'] > 0 && (int) $config['relations'] < 1 ) {
			throw new RuntimeException( 'Rollup scenarios require at least 1 relation, or pass --rollups=0.' );
		}
	}

	private function ensure_post_types(): void {
		if ( ! post_type_exists( Collection::POST_TYPE ) ) {
			( new Collection() )->register_post_type();
		}
		if ( ! post_type_exists( Field::POST_TYPE ) ) {
			( new Field() )->register_post_type();
		}
	}

	private function ensure_rest_routes(): void {
		if ( self::$rest_routes_initialized ) {
			return;
		}
		rest_get_server();
		self::$rest_routes_initialized = true;
	}

	private function default_seed_user_id(): int {
		$users = get_users(
			array(
				'role'   => 'administrator',
				'number' => 1,
				'fields' => array( 'ID' ),
			)
		);
		if ( count( $users ) > 0 ) {
			return (int) $users[0]->ID;
		}

		$user_id = wp_insert_user(
			array(
				'user_login'   => 'cortext_perf_admin',
				'user_pass'    => wp_generate_password( 24, true ),
				'user_email'   => 'cortext-perf@example.com',
				'display_name' => 'Cortext Perf',
				'role'         => 'administrator',
			)
		);

		return is_wp_error( $user_id ) ? 1 : (int) $user_id;
	}

	/**
	 * Creates the collections, fields, and rows used by the benchmark.
	 *
	 * @param array<string,int> $config       Seed config.
	 * @param int               $seed_user_id Author/editor user ID.
	 * @return array<string,mixed>
	 * @throws RuntimeException When a collection, field, or row cannot be created.
	 */
	private function create_dataset( array $config, int $seed_user_id ): array {
		$collections       = $this->create_collections( (int) $config['collections'] );
		$wide_collection   = $collections[2] ?? null;
		$wide_scalar_count = (int) ( $config['wide_fields'] ?? self::DEFAULT_WIDE_FIELDS );
		$field_map         = $this->create_fields( $collections, (int) $config['fields'], $wide_scalar_count, (int) $config['relations'], (int) $config['rollups'] );
		$row_map           = $this->create_rows( $collections, $field_map, (int) $config['rows'], $seed_user_id );
		$target_collection = $collections[1] ?? null;

		$manifest = array(
			'seed'                  => self::DATASET_SEED,
			'config'                => $config,
			'collections'           => $collections,
			'fields'                => $field_map,
			'rows'                  => $row_map,
			'primary_collection_id' => $collections[0]['id'],
			'primary_slug'          => $collections[0]['slug'],
			'primary_row_ids'       => $row_map[ $collections[0]['slug'] ],
			'target_row_ids'        => is_array( $target_collection ) ? ( $row_map[ $target_collection['slug'] ] ?? array() ) : array(),
			'wide_collection_id'    => is_array( $wide_collection ) ? (int) $wide_collection['id'] : 0,
			'wide_slug'             => is_array( $wide_collection ) ? (string) $wide_collection['slug'] : '',
			'wide_row_ids'          => is_array( $wide_collection ) ? ( $row_map[ $wide_collection['slug'] ] ?? array() ) : array(),
			'sort_field_id'         => $field_map['primary']['sort_field_id'],
			'relation_field_id'     => $field_map['primary']['relation_field_ids'][0] ?? 0,
			'migration_field_id'    => $field_map['primary']['migration_field_id'],
			'migration_row_ids'     => array_slice( $row_map[ $collections[0]['slug'] ], 0, min( self::MIGRATION_CAP_ROWS, (int) $config['rows'] ) ),
		);

		return $manifest;
	}

	/**
	 * Creates the benchmark collections.
	 *
	 * @param int $count Number of collections to create.
	 * @return array<int,array{id:int,slug:string,title:string}>
	 * @throws RuntimeException When a collection cannot be created.
	 */
	private function create_collections( int $count ): array {
		$collections = array();

		for ( $index = 0; $index < $count; $index++ ) {
			$slug  = 0 === $index ? 'perfmain' : 'perftgt' . $index;
			$title = 0 === $index ? 'Perf Primary' : 'Perf Target ' . $index;

			$collection_id = wp_insert_post(
				array(
					'post_type'   => Collection::POST_TYPE,
					'post_status' => 'private',
					'post_title'  => $title,
					'meta_input'  => array(
						'slug'                 => $slug,
						self::DATASET_META_KEY => self::DATASET_META_VALUE,
					),
				),
				true
			);
			if ( is_wp_error( $collection_id ) ) {
				throw new RuntimeException( esc_html( $collection_id->get_error_message() ) );
			}

			$collection = get_post( (int) $collection_id );
			if ( ! $collection instanceof WP_Post ) {
				throw new RuntimeException( 'Could not create the benchmark collection.' );
			}

			( new CollectionEntries() )->register_for_collection( $collection );

			$collections[] = array(
				'id'    => (int) $collection_id,
				'slug'  => $slug,
				'title' => $title,
			);
		}

		return $collections;
	}

	/**
	 * Creates scalar, relation, and rollup fields.
	 *
	 * @param array<int,array{id:int,slug:string,title:string}> $collections Collections.
	 * @param int                                               $scalar_count Number of scalar fields per collection.
	 * @param int                                               $wide_scalar_count Scalar fields on the wide collection.
	 * @param int                                               $relation_count Number of relation fields.
	 * @param int                                               $rollup_count Number of rollup fields.
	 * @return array<string,mixed>
	 */
	private function create_fields( array $collections, int $scalar_count, int $wide_scalar_count, int $relation_count, int $rollup_count ): array {
		$field_map = array(
			'primary'     => array(
				'scalar_field_ids'   => array(),
				'relation_field_ids' => array(),
				'rollup_field_ids'   => array(),
				'sort_field_id'      => 0,
				'migration_field_id' => 0,
			),
			'collections' => array(),
		);

		foreach ( $collections as $index => $collection ) {
			$collection_scalar_count = 2 === $index ? max( $scalar_count, $wide_scalar_count ) : $scalar_count;
			$fields                  = $this->create_scalar_fields_for_collection( $collection['id'], $index, $collection_scalar_count );
			$field_map['collections'][ $collection['slug'] ] = $fields;
			( new CollectionEntries() )->register_for_collection( get_post( $collection['id'] ) );

			if ( 0 === $index ) {
				$field_map['primary']['scalar_field_ids']   = array_column( $fields, 'id' );
				$field_map['primary']['sort_field_id']      = $fields[0]['id'];
				$field_map['primary']['migration_field_id'] = $fields[2]['id'];
			}
		}

		if ( $relation_count > 0 ) {
			for ( $index = 0; $index < $relation_count; $index++ ) {
				$target                                       = $collections[ 1 + ( $index % ( count( $collections ) - 1 ) ) ];
				$relation                                     = $this->create_relation_field_pair(
					$collections[0]['id'],
					$target['id'],
					'Perf Relation ' . ( $index + 1 ),
					'Perf Reverse ' . ( $index + 1 )
				);
				$field_map['primary']['relation_field_ids'][] = $relation['source_id'];
				$field_map['collections'][ $collections[0]['slug'] ][] = array(
					'id'    => $relation['source_id'],
					'type'  => 'relation',
					'title' => 'Perf Relation ' . ( $index + 1 ),
				);
				$field_map['collections'][ $target['slug'] ][]         = array(
					'id'    => $relation['reverse_id'],
					'type'  => 'relation',
					'title' => 'Perf Reverse ' . ( $index + 1 ),
				);
			}
		}

		if ( $rollup_count > 0 ) {
			$relation_field_id = $field_map['primary']['relation_field_ids'][0] ?? 0;
			$target_slug       = $collections[1]['slug'] ?? '';
			$target_field_id   = $field_map['collections'][ $target_slug ][1]['id'] ?? 0;

			for ( $index = 0; $index < $rollup_count; $index++ ) {
				$rollup_id                                  = $this->create_field(
					$collections[0]['id'],
					'Perf Rollup ' . ( $index + 1 ),
					array(
						'type'                     => 'rollup',
						'rollup_relation_field_id' => (string) $relation_field_id,
						'rollup_target_field_id'   => (string) $target_field_id,
						'rollup_aggregator'        => 'sum',
						'rollup_target_type'       => 'number',
					)
				);
				$field_map['primary']['rollup_field_ids'][] = $rollup_id;
				$field_map['collections'][ $collections[0]['slug'] ][] = array(
					'id'    => $rollup_id,
					'type'  => 'rollup',
					'title' => 'Perf Rollup ' . ( $index + 1 ),
				);
			}
		}

		foreach ( $collections as $collection ) {
			( new CollectionEntries() )->register_for_collection( get_post( $collection['id'] ) );
		}

		return $field_map;
	}

	/**
	 * Creates scalar fields for a collection.
	 *
	 * @param int $collection_id Collection post ID.
	 * @param int $collection_index Zero-based collection index.
	 * @param int $count Number of scalar fields.
	 * @return array<int,array{id:int,type:string,title:string}>
	 */
	private function create_scalar_fields_for_collection( int $collection_id, int $collection_index, int $count ): array {
		$base = 0 === $collection_index
			? array(
				array(
					'title' => 'Perf Sort',
					'type'  => 'text',
				),
				array(
					'title' => 'Perf Number',
					'type'  => 'number',
				),
				array(
					'title'   => 'Perf Migrate 1000',
					'type'    => 'select',
					'options' => $this->options_json( array( 'old-1000', 'new-1000', 'stable' ) ),
				),
				array(
					'title'   => 'Perf Tags',
					'type'    => 'multiselect',
					'options' => $this->options_json( array( 'alpha', 'beta', 'gamma', 'delta' ) ),
				),
				array(
					'title' => 'Perf Flag',
					'type'  => 'checkbox',
				),
				array(
					'title' => 'Perf Date',
					'type'  => 'date',
				),
				array(
					'title' => 'Perf Notes',
					'type'  => 'text',
				),
			)
			: array(
				array(
					'title' => 'Perf Target Sort',
					'type'  => 'text',
				),
				array(
					'title' => 'Perf Target Score',
					'type'  => 'number',
				),
				array(
					'title'   => 'Perf Target Status',
					'type'    => 'select',
					'options' => $this->options_json( array( 'active', 'paused', 'done' ) ),
				),
				array(
					'title' => 'Perf Target Notes',
					'type'  => 'text',
				),
			);

		$base_count = count( $base );
		while ( $base_count < $count ) {
			$next   = $base_count + 1;
			$base[] = array(
				'title' => 'Perf Extra ' . $next,
				'type'  => 0 === $next % 3 ? 'number' : 'text',
			);
			++$base_count;
		}

		$fields = array();
		foreach ( array_slice( $base, 0, $count ) as $definition ) {
			$meta = array( 'type' => $definition['type'] );
			if ( isset( $definition['options'] ) ) {
				$meta['options'] = $definition['options'];
			}

			$fields[] = array(
				'id'    => $this->create_field( $collection_id, $definition['title'], $meta ),
				'type'  => $definition['type'],
				'title' => $definition['title'],
			);
		}

		return $fields;
	}

	/**
	 * Creates a relation field pair.
	 *
	 * @param int    $source_collection_id Source collection post ID.
	 * @param int    $target_collection_id Target collection post ID.
	 * @param string $source_title Source field title.
	 * @param string $reverse_title Reverse field title.
	 * @return array{source_id:int,reverse_id:int}
	 */
	private function create_relation_field_pair( int $source_collection_id, int $target_collection_id, string $source_title, string $reverse_title ): array {
		$source_id  = $this->create_field(
			$source_collection_id,
			$source_title,
			array(
				'type'                  => 'relation',
				'related_collection_id' => (string) $target_collection_id,
				'relation_multiple'     => '1',
			)
		);
		$reverse_id = $this->create_field(
			$target_collection_id,
			$reverse_title,
			array(
				'type'                  => 'relation',
				'related_collection_id' => (string) $source_collection_id,
				'relation_multiple'     => '1',
			)
		);

		update_post_meta( $source_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $source_id );

		return array(
			'source_id'  => $source_id,
			'reverse_id' => $reverse_id,
		);
	}

	/**
	 * Creates a field and attaches it to a collection.
	 *
	 * @param int                  $collection_id Collection post ID.
	 * @param string               $title Field title.
	 * @param array<string,string> $meta Field meta.
	 * @return int Field post ID.
	 * @throws RuntimeException When the field cannot be created or attached.
	 */
	private function create_field( int $collection_id, string $title, array $meta ): int {
		$meta[ self::DATASET_META_KEY ] = self::DATASET_META_VALUE;
		$field_id                       = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => $meta,
			),
			true
		);

		if ( is_wp_error( $field_id ) ) {
			throw new RuntimeException( esc_html( $field_id->get_error_message() ) );
		}

		if ( false === add_post_meta( $collection_id, 'fields', (string) $field_id ) ) {
			wp_delete_post( (int) $field_id, true );
			throw new RuntimeException( 'Could not attach the benchmark field to its collection.' );
		}

		return (int) $field_id;
	}

	/**
	 * Creates rows for each benchmark collection.
	 *
	 * @param array<int,array{id:int,slug:string,title:string}> $collections Collections.
	 * @param array<string,mixed>                               $field_map   Field metadata.
	 * @param int                                               $rows_per_collection Rows per collection.
	 * @param int                                               $seed_user_id Author/editor user ID.
	 * @return array<string,int[]>
	 */
	private function create_rows( array $collections, array $field_map, int $rows_per_collection, int $seed_user_id ): array {
		$row_map = array();

		foreach ( $collections as $collection_index => $collection ) {
			$post_type = CollectionEntries::CPT_PREFIX . $collection['slug'];
			$row_ids   = array();
			$fields    = $field_map['collections'][ $collection['slug'] ] ?? array();

			for ( $row_index = 1; $row_index <= $rows_per_collection; $row_index++ ) {
				$row_ids[] = $this->insert_row(
					$post_type,
					$collection['title'] . ' Row ' . str_pad( (string) $row_index, 5, '0', STR_PAD_LEFT ),
					$seed_user_id,
					$this->row_meta( $collection_index, $row_index, $rows_per_collection, $fields )
				);
			}

			$row_map[ $collection['slug'] ] = $row_ids;
		}

		$this->seed_relation_values( $field_map, $row_map, $collections );

		return $row_map;
	}

	/**
	 * Builds row meta for one seeded row.
	 *
	 * @param int                                               $collection_index Zero-based collection index.
	 * @param int                                               $row_index One-based row index.
	 * @param int                                               $row_count Rows in the collection.
	 * @param array<int,array{id:int,type:string,title:string}> $fields Field definitions.
	 * @return array<string,mixed>
	 */
	private function row_meta( int $collection_index, int $row_index, int $row_count, array $fields ): array {
		$meta = array(
			self::DATASET_META_KEY => self::DATASET_META_VALUE,
		);

		foreach ( $fields as $position => $field ) {
			$field_id = (int) $field['id'];
			$type     = (string) $field['type'];
			$key      = Relations::meta_key( $field_id );

			if ( in_array( $type, array( 'relation', 'rollup' ), true ) ) {
				continue;
			}

			if ( 0 === $collection_index ) {
				$meta[ $key ] = $this->primary_row_value( $position, $type, $row_index, $row_count );
			} else {
				$meta[ $key ] = $this->target_row_value( $position, $type, $row_index );
			}
		}

		return $meta;
	}

	private function primary_row_value( int $position, string $type, int $row_index, int $row_count ): mixed {
		return match ( $position ) {
			0 => 'sort-' . str_pad( (string) ( $row_count - $row_index ), 6, '0', STR_PAD_LEFT ),
			1 => (string) $row_index,
			2 => $row_index <= self::MIGRATION_CAP_ROWS ? 'old-1000' : 'stable',
			3 => array( 'alpha', 0 === $row_index % 2 ? 'beta' : 'gamma' ),
			4 => 0 === $row_index % 2 ? '1' : '0',
			5 => gmdate( 'Y-m-d', strtotime( '2026-01-01 +' . $row_index . ' days' ) ),
			default => 'number' === $type ? (string) ( $row_index * ( $position + 1 ) ) : 'Value ' . $position . ' / ' . $row_index,
		};
	}

	private function target_row_value( int $position, string $type, int $row_index ): mixed {
		return match ( $position ) {
			0 => 'target-' . str_pad( (string) $row_index, 6, '0', STR_PAD_LEFT ),
			1 => (string) ( $row_index * 3 ),
			2 => 0 === $row_index % 3 ? 'done' : ( 0 === $row_index % 2 ? 'paused' : 'active' ),
			default => 'number' === $type ? (string) ( $row_index + $position ) : 'Target value ' . $position . ' / ' . $row_index,
		};
	}

	/**
	 * Seeds relation values on primary rows.
	 *
	 * @param array<string,mixed>                               $field_map   Field map.
	 * @param array<string,int[]>                               $row_map     Row IDs by collection slug.
	 * @param array<int,array{id:int,slug:string,title:string}> $collections Collections.
	 */
	private function seed_relation_values( array $field_map, array $row_map, array $collections ): void {
		$relation_field_ids = $field_map['primary']['relation_field_ids'] ?? array();
		if ( count( $relation_field_ids ) === 0 || count( $collections ) < 2 ) {
			return;
		}

		$primary_slug = $collections[0]['slug'];
		$target_slug  = $collections[1]['slug'];
		$primary_rows = $row_map[ $primary_slug ] ?? array();
		$target_rows  = $row_map[ $target_slug ] ?? array();
		if ( count( $primary_rows ) === 0 || count( $target_rows ) === 0 ) {
			return;
		}

		foreach ( $relation_field_ids as $field_id ) {
			$key          = Relations::meta_key( (int) $field_id );
			$target_count = count( $target_rows );
			foreach ( $primary_rows as $index => $row_id ) {
				$value_count = $this->seeded_relation_target_count( $index + 1, $target_count );
				for ( $offset = 0; $offset < $value_count; $offset++ ) {
					add_post_meta( (int) $row_id, $key, (string) $target_rows[ ( $index + $offset ) % $target_count ] );
				}
			}
		}
	}

	/**
	 * Seeds different relation fanout per page so the read tests do not all measure the same path.
	 *
	 * @param int $row_number  One-based primary row number.
	 * @param int $target_count Available target rows.
	 */
	private function seeded_relation_target_count( int $row_number, int $target_count ): int {
		$page = (int) ceil( $row_number / self::PAGE_SIZE );

		if ( 3 === $page ) {
			return min( self::ROLLUP_HEAVY_TARGETS, $target_count );
		}
		if ( 2 === $page ) {
			return min( self::RELATION_HYDRATION_TARGETS, $target_count );
		}

		return min( self::RELATION_BASE_TARGETS, $target_count );
	}

	/**
	 * Inserts one row post.
	 *
	 * @param string              $post_type Dynamic row post type.
	 * @param string              $title Row title.
	 * @param int                 $author_id Author user ID.
	 * @param array<string,mixed> $meta Row meta.
	 * @return int Row post ID.
	 * @throws RuntimeException When the row cannot be inserted.
	 */
	private function insert_row( string $post_type, string $title, int $author_id, array $meta ): int {
		global $wpdb;

		$now     = current_time( 'mysql' );
		$now_gmt = current_time( 'mysql', true );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Seeding creates many deterministic row posts; using wp_insert_post here is much slower.
		$inserted = $wpdb->insert(
			$wpdb->posts,
			array(
				'post_author'           => $author_id,
				'post_date'             => $now,
				'post_date_gmt'         => $now_gmt,
				'post_content'          => '',
				'post_title'            => $title,
				'post_excerpt'          => '',
				'post_status'           => 'private',
				'comment_status'        => 'closed',
				'ping_status'           => 'closed',
				'post_password'         => '',
				'post_name'             => sanitize_title( $title ),
				'to_ping'               => '',
				'pinged'                => '',
				'post_modified'         => $now,
				'post_modified_gmt'     => $now_gmt,
				'post_content_filtered' => '',
				'post_parent'           => 0,
				'guid'                  => '',
				'menu_order'            => 0,
				'post_type'             => $post_type,
				'post_mime_type'        => '',
				'comment_count'         => 0,
			)
		);

		if ( false === $inserted ) {
			throw new RuntimeException( 'Could not insert the benchmark row.' );
		}

		$row_id = (int) $wpdb->insert_id;
		foreach ( $meta as $key => $value ) {
			$values = is_array( $value ) ? $value : array( $value );
			foreach ( $values as $entry ) {
				add_post_meta( $row_id, (string) $key, (string) $entry );
			}
		}

		return $row_id;
	}

	private function delete_dataset(): void {
		global $wpdb;

		$this->register_existing_dataset_collections();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Some row CPTs may not be registered when reset runs.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s",
				self::DATASET_META_KEY,
				self::DATASET_META_VALUE
			)
		);

		$rows        = array();
		$fields      = array();
		$collections = array();

		foreach ( array_map( 'intval', $ids ) as $id ) {
			$post_type = get_post_type( $id );
			if ( Field::POST_TYPE === $post_type ) {
				$fields[] = $id;
			} elseif ( Collection::POST_TYPE === $post_type ) {
				$collections[] = $id;
			} else {
				$rows[] = $id;
			}
		}

		foreach ( array( $rows, $fields, $collections ) as $group ) {
			foreach ( $group as $post_id ) {
				wp_delete_post( (int) $post_id, true );
			}
		}

		FieldValueIndex::flush_runtime_caches();
		delete_option( self::DATASET_OPTION );
	}

	private function register_existing_dataset_collections(): void {
		$manifest = get_option( self::DATASET_OPTION );
		if ( is_array( $manifest ) ) {
			$this->register_dataset_collections( $manifest );
		}
	}

	/**
	 * Registers row CPTs from a saved manifest.
	 *
	 * @param array<string,mixed> $manifest Dataset manifest.
	 */
	private function register_dataset_collections( array $manifest ): void {
		foreach ( $manifest['collections'] ?? array() as $collection ) {
			$collection_post = get_post( (int) ( $collection['id'] ?? 0 ) );
			if ( $collection_post instanceof WP_Post ) {
				( new CollectionEntries() )->register_for_collection( $collection_post );
			}
		}
	}

	/**
	 * Builds the scenario callbacks.
	 *
	 * Labels stay short so the JSON is easy to scan. Put the reasoning in
	 * comments; budget reviews go stale fast without it. Each scenario uses
	 * either `run` for one measured callback or `steps` for named callbacks
	 * that are measured separately and then rolled up.
	 *
	 * @param array<string,mixed> $manifest Dataset manifest.
	 * @return array<string,array{label:string,prepare?:callable,run?:callable,steps?:array<string,callable>}>
	 * @throws RuntimeException When relation scenario data is missing.
	 */
	private function scenario_callbacks( array $manifest ): array {
		$primary_collection_id = (int) $manifest['primary_collection_id'];
		$wide_collection_id    = (int) $manifest['wide_collection_id'];
		$sort_field_id         = (int) $manifest['sort_field_id'];
		$relation_field_id     = (int) $manifest['relation_field_id'];
		$primary_row_ids       = array_map( 'intval', $manifest['primary_row_ids'] );
		$target_row_ids        = array_map( 'intval', $manifest['target_row_ids'] );
		$relation_count        = min( self::RELATION_TARGETS, intdiv( count( $target_row_ids ), 2 ) );
		$primary_field_ids     = array_map( 'intval', $manifest['fields']['primary']['scalar_field_ids'] ?? array() );
		$rollup_field_ids      = array_map( 'intval', $manifest['fields']['primary']['rollup_field_ids'] ?? array() );
		$number_field_id       = $primary_field_ids[1] ?? 0;
		$select_field_id       = $primary_field_ids[2] ?? 0;
		$tags_field_id         = $primary_field_ids[3] ?? 0;
		$date_field_id         = $primary_field_ids[5] ?? 0;
		$primary_rollup_id     = $rollup_field_ids[0] ?? 0;

		if ( $relation_field_id < 1 || $relation_count < 1 ) {
			throw new RuntimeException( 'The benchmark dataset does not include enough relation targets.' );
		}
		if ( min( $number_field_id, $select_field_id, $tags_field_id, $date_field_id, $wide_collection_id ) < 1 ) {
			throw new RuntimeException( 'The benchmark dataset is missing fields for filters or the wide schema scenario.' );
		}

		$relation_source_targets = array_slice( $target_row_ids, 0, $relation_count );
		$relation_target_targets = array_slice( $target_row_ids, $relation_count, $relation_count );
		$relation_delta_targets  = $relation_source_targets;
		$relation_delta_targets[ count( $relation_delta_targets ) - 1 ] = $relation_target_targets[0];
		// Keep writes off the pages read below. Otherwise a second benchmark run
		// would change the rows used by the read scenarios.
		$relation_row_id = $primary_row_ids[ self::PAGE_SIZE * 4 ] ?? $primary_row_ids[0];
		// Page 3 starts in the heavy-rollup zone. Opening that row covers
		// relation and rollup hydration while staying away from rows touched by
		// write scenarios.
		$row_detail_row_id = $primary_row_ids[ self::PAGE_SIZE * 2 ] ?? $primary_row_ids[0];
		$row_rest_base     = CollectionEntries::CPT_PREFIX . (string) $manifest['primary_slug'];

		return array(
			// This is the first thing users hit when opening a collection:
			// first-page query, field lookup, row formatting, relations, rollups,
			// and user names.
			'rows_page_1'             => array(
				'label' => 'Open the first rows page',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => self::PAGE_SIZE,
					)
				),
			),
			// Page 50 makes the default dataset large enough for pagination costs
			// to show up instead of hiding behind the first-page path.
			'rows_page_50'            => array(
				'label' => 'Open rows page 50',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 50,
						'per_page'   => self::PAGE_SIZE,
					)
				),
			),
			// A short page walk is closer to normal navigation than a single
			// request. It catches repeated field loading and relation/rollup
			// formatting while keeping the CI run cheap.
			'rows_page_walk'          => array(
				'label' => 'Visit rows pages 1, 2, 3, and 50',
				'run'   => fn() => array_map(
					fn( int $page ) => $this->rest_request(
						'GET',
						'/cortext/v1/rows',
						array(
							'collection' => $primary_collection_id,
							'page'       => $page,
							'per_page'   => self::PAGE_SIZE,
						)
					),
					array( 1, 2, 3, 50 )
				),
			),
			// Sorting by a custom field goes through the postmeta join and the
			// ORDER BY meta_value path.
			'rows_sort_meta_value'    => array(
				'label' => 'Sort rows by a custom field',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => self::PAGE_SIZE,
						'sort'       => array(
							'field'     => Relations::meta_key( $sort_field_id ),
							'direction' => 'asc',
						),
					)
				),
			),
			// Text search takes its own SQL path across titles and text fields.
			'rows_search_text'        => array(
				'label' => 'Search rows by text',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => self::PAGE_SIZE,
						'search'     => 'Value',
					)
				),
			),
			// Mixed filters exercise grouped filter SQL. Multi-value, number,
			// select, and date clauses each take different branches.
			'rows_filter_mixed'       => array(
				'label' => 'Filter rows across tags, number, select, and date',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => self::PAGE_SIZE,
						'filters'    => array(
							array(
								'relation' => 'AND',
								'filters'  => array(
									array(
										'field'    => Relations::meta_key( $tags_field_id ),
										'operator' => 'contains',
										'value'    => 'alpha',
									),
									array(
										'field'    => Relations::meta_key( $number_field_id ),
										'operator' => 'greaterThan',
										'value'    => '500',
									),
									array(
										'relation' => 'OR',
										'filters'  => array(
											array(
												'field'    => Relations::meta_key( $select_field_id ),
												'operator' => 'is',
												'value'    => 'stable',
											),
											array(
												'field'    => Relations::meta_key( $date_field_id ),
												'operator' => 'before',
												'value'    => '2028-01-01',
											),
										),
									),
								),
							),
						),
					)
				),
			),
			// Page 2 is seeded with many related rows per row, so relation
			// formatting has enough work to show up.
			'rows_relation_hydration' => array(
				'label' => 'Load rows with many related records',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 2,
						'per_page'   => self::PAGE_SIZE,
					)
				),
			),
			// Page 3 sits in the heavy-rollup slice. Keep the normal response
			// and the rollup-only projection side by side so regressions show up
			// in either path.
			'rows_rollup_heavy_full'  => array(
				'label' => 'Load heavy rollup rows (all fields)',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 3,
						'per_page'   => self::PAGE_SIZE,
					)
				),
			),
			'rows_rollup_heavy'       => array(
				'label' => 'Load heavy rollup rows (rollup field)',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 3,
						'per_page'   => self::PAGE_SIZE,
						'fields'     => $primary_rollup_id > 0
							? array( "field-{$primary_rollup_id}" )
							: array(),
					)
				),
			),
			// Opening a single row takes two REST calls: the locator maps an id
			// to a rest_base, then core REST returns the record with
			// cortext_hydrated_meta. Keep both timings so resolver cost does
			// not hide inside hydrate if it grows.
			'row_detail_open'         => array(
				'label' => 'Open a row detail (resolve and hydrate)',
				'steps' => array(
					'resolve' => fn() => $this->rest_request(
						'GET',
						"/cortext/v1/documents/{$row_detail_row_id}",
						array()
					),
					'hydrate' => fn() => $this->rest_request(
						'GET',
						"/wp/v2/{$row_rest_base}/{$row_detail_row_id}",
						array(
							'context' => 'edit',
							'_fields' => 'id,slug,parent,type,created_at,created_by,modified_at,modified_by,cortext_hydrated_meta',
						)
					),
				),
			),
			// The third collection is wide on purpose. It measures field loading
			// and per-row meta formatting with many columns.
			'rows_wide_schema'        => array(
				'label' => 'Load rows with a wide schema',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $wide_collection_id,
						'page'       => 1,
						'per_page'   => self::PAGE_SIZE,
					)
				),
			),
			// Replacing a large relation list has to sync many reverse pointers.
			// This is the expensive relation picker write case.
			'relation_many_targets'   => array(
				'label'   => 'Replace 250 related records',
				'prepare' => fn() => Relations::set_relation_values( $relation_row_id, $relation_field_id, $relation_source_targets, true ),
				'run'     => fn() => $this->rest_request(
					'POST',
					"/cortext/v1/collections/{$primary_collection_id}/rows/{$relation_row_id}",
					array(
						'collection_id' => $primary_collection_id,
						'row_id'        => $relation_row_id,
						'field'         => Relations::meta_key( $relation_field_id ),
						'value'         => $relation_target_targets,
					)
				),
			),
			// Changing one target in a large relation list should stay much
			// cheaper than replacing the whole list.
			'relation_small_delta'    => array(
				'label'   => 'Change one related record',
				'prepare' => fn() => Relations::set_relation_values( $relation_row_id, $relation_field_id, $relation_source_targets, true ),
				'run'     => fn() => $this->rest_request(
					'POST',
					"/cortext/v1/collections/{$primary_collection_id}/rows/{$relation_row_id}",
					array(
						'collection_id' => $primary_collection_id,
						'row_id'        => $relation_row_id,
						'field'         => Relations::meta_key( $relation_field_id ),
						'value'         => $relation_delta_targets,
					)
				),
			),
			// The issue calls out a 1000-row migration line. There is no runtime
			// branch on either side of 1000 today, so one exact-cap scenario keeps
			// the signal focused without paying for duplicate boundary runs.
			'migrate_1000_rows'       => array(
				'label'   => 'Migrate 1000 select values',
				'prepare' => fn() => $this->prepare_migration(
					(int) $manifest['migration_field_id'],
					array_map( 'intval', $manifest['migration_row_ids'] ),
					'old-1000',
					'new-1000'
				),
				'run'     => fn() => $this->migrate_options( (int) $manifest['migration_field_id'], 'old-1000', 'new-1000' ),
			),
			// This is the migration number to watch right now: the whole primary
			// collection on the code path we have today.
			'migrate_many_rows'       => array(
				'label'   => 'Migrate every primary row',
				'prepare' => fn() => $this->prepare_migration(
					(int) $manifest['migration_field_id'],
					$primary_row_ids,
					'old-many',
					'new-many'
				),
				'run'     => fn() => $this->migrate_options( (int) $manifest['migration_field_id'], 'old-many', 'new-many' ),
			),
		);
	}

	/**
	 * Builds the field-value materialization benchmarks.
	 *
	 * The default suite measures full REST workflows. This suite times the
	 * SQL/ID phase first, because hydration can hide the index cost. The
	 * sidecar response check still hydrates through the existing REST include
	 * path; it is not a production read path.
	 *
	 * @param array<string,mixed> $manifest Dataset manifest.
	 * @return array<string,array{label:string,prepare?:callable,run:callable,single?:bool}>
	 * @throws RuntimeException When the sidecar table cannot be prepared or verified.
	 */
	private function materialization_scenario_callbacks( array $manifest ): array {
		$primary_collection_id = (int) $manifest['primary_collection_id'];
		$primary_slug          = (string) $manifest['primary_slug'];
		$primary_row_ids       = array_map( 'intval', $manifest['primary_row_ids'] );
		$target_row_ids        = array_map( 'intval', $manifest['target_row_ids'] ?? array() );
		$primary_field_ids     = array_map( 'intval', $manifest['fields']['primary']['scalar_field_ids'] ?? array() );
		$relation_field_id     = (int) ( $manifest['relation_field_id'] ?? 0 );
		$number_field_id       = $primary_field_ids[1] ?? 0;
		$select_field_id       = $primary_field_ids[2] ?? 0;
		$date_field_id         = $primary_field_ids[5] ?? 0;
		$text_field_ids        = $this->materialization_text_field_ids( $manifest, $primary_slug );
		$relation_target_id    = count( $target_row_ids ) > 0 ? $target_row_ids[ min( 59, count( $target_row_ids ) - 1 ) ] : 0;
		$search_term           = 'Value 6 / 99';
		$filter_minimum        = 9500.0;

		if ( min( $primary_collection_id, $number_field_id, $select_field_id, $date_field_id ) < 1 || count( $text_field_ids ) === 0 ) {
			throw new RuntimeException( 'The materialization suite needs number, select, and date fields on the primary collection.' );
		}

		$index = new FieldValueIndex();
		if ( ! $index->install() ) {
			throw new RuntimeException( 'This host cannot use the field-value index table, so the materialization suite cannot run.' );
		}
		$index->rebuild_collection( $primary_collection_id );

		$this->assert_materialization_parity(
			$index,
			$primary_collection_id,
			$primary_slug,
			$number_field_id,
			$select_field_id,
			$date_field_id,
			$filter_minimum
		);
		$this->assert_materialization_search_parity(
			$index,
			$primary_collection_id,
			$primary_slug,
			$text_field_ids,
			$search_term,
			$number_field_id,
			$select_field_id,
			$filter_minimum
		);
		if ( $relation_field_id > 0 && $relation_target_id > 0 ) {
			$this->assert_materialization_relation_parity(
				$index,
				$primary_collection_id,
				$primary_slug,
				$relation_field_id,
				$relation_target_id
			);
		}
		$this->assert_materialization_rest_read_parity(
			$primary_collection_id,
			$number_field_id,
			$select_field_id,
			$date_field_id,
			$filter_minimum
		);

		$write_row_ids       = array_slice( $primary_row_ids, 0, min( self::MIGRATION_CAP_ROWS, count( $primary_row_ids ) ) );
		$single_write_row_id = $write_row_ids[0] ?? $primary_row_ids[0];

		$scenarios = array(
			'mat_filter_two_fields_postmeta'         => array(
				'label' => 'Field values: postmeta two-field filter IDs',
				'run'   => fn() => $this->postmeta_filter_ids(
					$primary_collection_id,
					$primary_slug,
					$number_field_id,
					$filter_minimum,
					$select_field_id,
					'stable',
					50
				),
			),
			'mat_filter_two_fields_sidecar'          => array(
				'label' => 'Field values: sidecar two-field filter IDs',
				'run'   => fn() => $index->query_two_field_filter_ids(
					$primary_collection_id,
					$number_field_id,
					$filter_minimum,
					$select_field_id,
					'stable',
					50
				),
			),
			'mat_sort_date_postmeta'                 => array(
				'label' => 'Field values: postmeta date sort IDs',
				'run'   => fn() => $this->postmeta_date_sort_ids( $primary_slug, $date_field_id, 50 ),
			),
			'mat_sort_date_sidecar'                  => array(
				'label' => 'Field values: sidecar date sort IDs',
				'run'   => fn() => $index->query_date_sort_ids( $primary_collection_id, $date_field_id, 50 ),
			),
			'mat_sort_date_filtered_postmeta'        => array(
				'label' => 'Field values: postmeta filtered date sort IDs',
				'run'   => fn() => $this->postmeta_date_sort_filtered_ids(
					$primary_slug,
					$date_field_id,
					$number_field_id,
					$filter_minimum,
					$select_field_id,
					'stable',
					50
				),
			),
			'mat_sort_date_filtered_sidecar'         => array(
				'label' => 'Field values: sidecar filtered date sort IDs',
				'run'   => fn() => $index->query_date_sort_filtered_ids(
					$primary_collection_id,
					$date_field_id,
					$number_field_id,
					$filter_minimum,
					$select_field_id,
					'stable',
					50
				),
			),
			'mat_search_text_postmeta'               => array(
				'label' => 'Field values: postmeta text search IDs',
				'run'   => fn() => $this->postmeta_text_search_ids( $primary_slug, $text_field_ids, $search_term, 50 ),
			),
			'mat_search_text_sidecar'                => array(
				'label' => 'Field values: sidecar text search IDs',
				'run'   => fn() => $index->query_text_search_ids( $primary_collection_id, $text_field_ids, $search_term, 50 ),
			),
			'mat_search_text_filtered_postmeta'      => array(
				'label' => 'Field values: postmeta filtered text search IDs',
				'run'   => fn() => $this->postmeta_text_search_filtered_ids(
					$primary_slug,
					$text_field_ids,
					$search_term,
					$number_field_id,
					$filter_minimum,
					$select_field_id,
					'stable',
					50
				),
			),
			'mat_search_text_filtered_sidecar'       => array(
				'label' => 'Field values: sidecar filtered text search IDs',
				'run'   => fn() => $index->query_text_search_filtered_ids(
					$primary_collection_id,
					$text_field_ids,
					$search_term,
					$number_field_id,
					$filter_minimum,
					$select_field_id,
					'stable',
					50
				),
			),
			'mat_rollup_sum_postmeta'                => array(
				'label' => 'Field values: postmeta whole-collection sum',
				'run'   => fn() => $this->postmeta_sum_number( $primary_slug, $number_field_id ),
			),
			'mat_rollup_sum_sidecar'                 => array(
				'label' => 'Field values: sidecar whole-collection sum',
				'run'   => fn() => $index->aggregate_number( $primary_collection_id, $number_field_id, 'sum' ),
			),
			'mat_rollup_count_postmeta'              => array(
				'label' => 'Field values: postmeta whole-collection count',
				'run'   => fn() => $this->postmeta_count_text( $primary_slug, $select_field_id, 'stable' ),
			),
			'mat_rollup_count_sidecar'               => array(
				'label' => 'Field values: sidecar whole-collection count',
				'run'   => fn() => $index->count_text_value( $primary_collection_id, $select_field_id, 'stable' ),
			),
			'mat_filter_response_postmeta'           => array(
				'label' => 'Field values: REST filter response, sidecar off',
				'run'   => fn() => $this->rest_request_with_field_value_index(
					false,
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => 50,
						'filters'    => $this->materialization_filter_tree( $number_field_id, $select_field_id, $filter_minimum ),
					)
				),
			),
			'mat_filter_response_sidecar'            => array(
				'label' => 'Field values: REST filter response, sidecar on',
				'run'   => fn() => $this->rest_request_with_field_value_index(
					true,
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => 50,
						'filters'    => $this->materialization_filter_tree( $number_field_id, $select_field_id, $filter_minimum ),
					)
				),
			),
			'mat_sort_response_postmeta'             => array(
				'label' => 'Field values: REST date sort response, sidecar off',
				'run'   => fn() => $this->rest_request_with_field_value_index(
					false,
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => 50,
						'sort'       => array(
							'field'     => Relations::meta_key( $date_field_id ),
							'direction' => 'asc',
						),
					)
				),
			),
			'mat_sort_response_sidecar'              => array(
				'label' => 'Field values: REST date sort response, sidecar on',
				'run'   => fn() => $this->rest_request_with_field_value_index(
					true,
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => 50,
						'sort'       => array(
							'field'     => Relations::meta_key( $date_field_id ),
							'direction' => 'asc',
						),
					)
				),
			),
			'mat_sort_filtered_response_postmeta'    => array(
				'label' => 'Field values: REST filtered date sort response, sidecar off',
				'run'   => fn() => $this->rest_request_with_field_value_index(
					false,
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => 50,
						'filters'    => $this->materialization_filter_tree( $number_field_id, $select_field_id, $filter_minimum ),
						'sort'       => array(
							'field'     => Relations::meta_key( $date_field_id ),
							'direction' => 'asc',
						),
					)
				),
			),
			'mat_sort_filtered_response_sidecar'     => array(
				'label' => 'Field values: REST filtered date sort response, sidecar on',
				'run'   => fn() => $this->rest_request_with_field_value_index(
					true,
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'page'       => 1,
						'per_page'   => 50,
						'filters'    => $this->materialization_filter_tree( $number_field_id, $select_field_id, $filter_minimum ),
						'sort'       => array(
							'field'     => Relations::meta_key( $date_field_id ),
							'direction' => 'asc',
						),
					)
				),
			),
			'mat_filter_response_include_sidecar'    => array(
				'label' => 'Field values: sidecar ID lookup followed by REST include response',
				'run'   => fn() => $this->rest_request(
					'GET',
					'/cortext/v1/rows',
					array(
						'collection' => $primary_collection_id,
						'include'    => $index->query_two_field_filter_ids(
							$primary_collection_id,
							$number_field_id,
							$filter_minimum,
							$select_field_id,
							'stable',
							50
						),
						'per_page'   => 50,
					)
				),
			),
			'mat_write_incremental_postmeta'         => array(
				'label'   => 'Field values: postmeta 1000 sequential updates',
				'prepare' => fn() => $this->prepare_materialization_writes( $write_row_ids, $number_field_id, 1000.0, $index, false ),
				'run'     => fn() => $this->run_materialization_writes( $write_row_ids, $number_field_id, 2000.0, $index, false ),
			),
			'mat_write_incremental_sidecar'          => array(
				'label'   => 'Field values: postmeta and sidecar 1000 sequential updates',
				'prepare' => fn() => $this->prepare_materialization_writes( $write_row_ids, $number_field_id, 1000.0, $index, true ),
				'run'     => fn() => $this->run_materialization_writes( $write_row_ids, $number_field_id, 2000.0, $index, true ),
			),
			'mat_write_sidecar_only'                 => array(
				'label'   => 'Field values: sidecar reindex for 1000 updates',
				'prepare' => fn() => $this->prepare_materialization_writes( $write_row_ids, $number_field_id, 2000.0, $index, false ),
				'run'     => fn() => $this->run_materialization_sidecar_writes( $write_row_ids, $number_field_id, $index ),
			),
			'mat_write_sidecar_known_value'          => array(
				'label'   => 'Field values: sidecar known-value 1000 updates',
				'prepare' => fn() => $this->prepare_materialization_writes( $write_row_ids, $number_field_id, 3000.0, $index, false ),
				'run'     => fn() => $this->run_materialization_sidecar_known_writes( $write_row_ids, $number_field_id, 4000.0, $primary_collection_id, $index ),
			),
			'mat_write_store_sidecar'                => array(
				'label'   => 'Field values: FieldValueStore 1000 updates',
				'prepare' => fn() => $this->prepare_materialization_writes( $write_row_ids, $number_field_id, 4000.0, $index, true ),
				'run'     => fn() => $this->run_materialization_store_writes( $write_row_ids, $number_field_id, 5000.0, $primary_collection_id, $index ),
			),
			'mat_single_write_postmeta'              => array(
				'label'   => 'Field values: single postmeta scalar update',
				'prepare' => fn() => $this->prepare_materialization_writes( array( $single_write_row_id ), $number_field_id, 6000.0, $index, false ),
				'run'     => fn() => $this->run_materialization_single_postmeta_write( $single_write_row_id, $number_field_id, 7000.0 ),
			),
			'mat_single_write_store_sidecar'         => array(
				'label'   => 'Field values: single FieldValueStore scalar update',
				'prepare' => fn() => $this->prepare_materialization_writes( array( $single_write_row_id ), $number_field_id, 7000.0, $index, true ),
				'run'     => fn() => $this->run_materialization_store_writes( array( $single_write_row_id ), $number_field_id, 8000.0, $primary_collection_id, $index ),
			),
			'mat_single_rest_write_sidecar_disabled' => array(
				'label'   => 'Field values: REST scalar update with sidecar off',
				'prepare' => fn() => $this->prepare_materialization_writes( array( $single_write_row_id ), $number_field_id, 8000.0, $index, true ),
				'run'     => fn() => $this->run_materialization_rest_write( $primary_collection_id, $single_write_row_id, $number_field_id, 9000.0, false ),
			),
			'mat_single_rest_write_sidecar_enabled'  => array(
				'label'   => 'Field values: REST scalar update with sidecar on',
				'prepare' => fn() => $this->prepare_materialization_writes( array( $single_write_row_id ), $number_field_id, 9000.0, $index, true ),
				'run'     => fn() => $this->run_materialization_rest_write( $primary_collection_id, $single_write_row_id, $number_field_id, 10000.0, true ),
			),
			'mat_rebuild_full'                       => array(
				'label'  => 'Field values: full sidecar rebuild',
				'single' => true,
				'run'    => fn() => $index->rebuild_collection( $primary_collection_id ),
			),
		);

		if ( $relation_field_id > 0 && $relation_target_id > 0 ) {
			$scenarios['mat_relation_contains_postmeta'] = array(
				'label' => 'Field values: postmeta relation lookup IDs',
				'run'   => fn() => $this->postmeta_relation_contains_ids( $primary_slug, $relation_field_id, $relation_target_id, 50 ),
			);
			$scenarios['mat_relation_contains_sidecar']  = array(
				'label' => 'Field values: sidecar relation lookup IDs',
				'run'   => fn() => $index->query_relation_contains_ids( $primary_collection_id, $relation_field_id, $relation_target_id, 50 ),
			);
		}

		return $scenarios;
	}

	private function assert_materialization_parity(
		FieldValueIndex $index,
		int $collection_id,
		string $slug,
		int $number_field_id,
		int $select_field_id,
		int $date_field_id,
		float $filter_minimum
	): void {
		$postmeta_filter = $this->postmeta_filter_ids( $collection_id, $slug, $number_field_id, $filter_minimum, $select_field_id, 'stable', 50 );
		$sidecar_filter  = $index->query_two_field_filter_ids( $collection_id, $number_field_id, $filter_minimum, $select_field_id, 'stable', 50 );
		if ( $postmeta_filter !== $sidecar_filter ) {
			throw new RuntimeException( 'Postmeta and sidecar returned different IDs for the two-field filter scenario.' );
		}

		$postmeta_sort = $this->postmeta_date_sort_ids( $slug, $date_field_id, 50 );
		$sidecar_sort  = $index->query_date_sort_ids( $collection_id, $date_field_id, 50 );
		if ( $postmeta_sort !== $sidecar_sort ) {
			throw new RuntimeException( 'Postmeta and sidecar returned different IDs for the date sort scenario.' );
		}

		$postmeta_filtered_sort = $this->postmeta_date_sort_filtered_ids( $slug, $date_field_id, $number_field_id, $filter_minimum, $select_field_id, 'stable', 50 );
		$sidecar_filtered_sort  = $index->query_date_sort_filtered_ids( $collection_id, $date_field_id, $number_field_id, $filter_minimum, $select_field_id, 'stable', 50 );
		if ( $postmeta_filtered_sort !== $sidecar_filtered_sort ) {
			throw new RuntimeException( 'Postmeta and sidecar returned different IDs for the filtered date sort scenario.' );
		}

		$postmeta_sum = $this->postmeta_sum_number( $slug, $number_field_id );
		$sidecar_sum  = $index->aggregate_number( $collection_id, $number_field_id, 'sum' );
		if ( abs( (float) $postmeta_sum - (float) $sidecar_sum ) > 0.001 ) {
			throw new RuntimeException( 'Postmeta and sidecar returned different sums.' );
		}

		$postmeta_count = $this->postmeta_count_text( $slug, $select_field_id, 'stable' );
		$sidecar_count  = $index->count_text_value( $collection_id, $select_field_id, 'stable' );
		if ( $postmeta_count !== $sidecar_count ) {
			throw new RuntimeException( 'Postmeta and sidecar returned different counts.' );
		}
	}

	private function assert_materialization_search_parity(
		FieldValueIndex $index,
		int $collection_id,
		string $slug,
		array $field_ids,
		string $term,
		int $number_field_id,
		int $select_field_id,
		float $filter_minimum
	): void {
		$postmeta_search = $this->postmeta_text_search_ids( $slug, $field_ids, $term, 50 );
		$sidecar_search  = $index->query_text_search_ids( $collection_id, $field_ids, $term, 50 );
		if ( $postmeta_search !== $sidecar_search ) {
			throw new RuntimeException( 'Postmeta and sidecar returned different IDs for the text search scenario.' );
		}

		$postmeta_filtered_search = $this->postmeta_text_search_filtered_ids( $slug, $field_ids, $term, $number_field_id, $filter_minimum, $select_field_id, 'stable', 50 );
		$sidecar_filtered_search  = $index->query_text_search_filtered_ids( $collection_id, $field_ids, $term, $number_field_id, $filter_minimum, $select_field_id, 'stable', 50 );
		if ( $postmeta_filtered_search !== $sidecar_filtered_search ) {
			throw new RuntimeException( 'Postmeta and sidecar returned different IDs for the filtered text search scenario.' );
		}
	}

	private function assert_materialization_relation_parity(
		FieldValueIndex $index,
		int $collection_id,
		string $slug,
		int $field_id,
		int $target_row_id
	): void {
		$postmeta_relation = $this->postmeta_relation_contains_ids( $slug, $field_id, $target_row_id, 50 );
		$sidecar_relation  = $index->query_relation_contains_ids( $collection_id, $field_id, $target_row_id, 50 );
		if ( $postmeta_relation !== $sidecar_relation ) {
			throw new RuntimeException( 'Postmeta and sidecar returned different IDs for the relation lookup scenario.' );
		}
	}

	private function assert_materialization_rest_read_parity(
		int $collection_id,
		int $number_field_id,
		int $select_field_id,
		int $date_field_id,
		float $filter_minimum
	): void {
		$filter_params = array(
			'collection' => $collection_id,
			'page'       => 1,
			'per_page'   => 50,
			'filters'    => $this->materialization_filter_tree( $number_field_id, $select_field_id, $filter_minimum ),
		);
		$this->assert_rest_rows_parity( $filter_params, 'REST filter response' );

		$sort_params = array(
			'collection' => $collection_id,
			'page'       => 1,
			'per_page'   => 50,
			'sort'       => array(
				'field'     => Relations::meta_key( $date_field_id ),
				'direction' => 'asc',
			),
		);
		$this->assert_rest_rows_parity( $sort_params, 'REST date sort response' );

		$filtered_sort_params         = $filter_params;
		$filtered_sort_params['sort'] = $sort_params['sort'];
		$this->assert_rest_rows_parity( $filtered_sort_params, 'REST filtered date sort response' );
	}

	/**
	 * Checks that the postmeta and sidecar REST paths return the same page.
	 *
	 * @param array<string,mixed> $params REST request params.
	 * @param string              $label  Scenario label for errors.
	 * @throws RuntimeException When the responses differ.
	 */
	private function assert_rest_rows_parity( array $params, string $label ): void {
		$postmeta = $this->rest_request_with_field_value_index( false, 'GET', '/cortext/v1/rows', $params );
		$sidecar  = $this->rest_request_with_field_value_index( true, 'GET', '/cortext/v1/rows', $params );

		if ( ! is_array( $postmeta ) || ! is_array( $sidecar ) ) {
			throw new RuntimeException( esc_html( "{$label} parity check did not return response arrays." ) );
		}

		$postmeta_ids = $this->rest_row_ids( $postmeta );
		$sidecar_ids  = $this->rest_row_ids( $sidecar );
		if (
			$postmeta_ids !== $sidecar_ids
			|| (int) ( $postmeta['total'] ?? -1 ) !== (int) ( $sidecar['total'] ?? -2 )
			|| (int) ( $postmeta['totalPages'] ?? -1 ) !== (int) ( $sidecar['totalPages'] ?? -2 )
		) {
			throw new RuntimeException( esc_html( "Postmeta and sidecar returned different rows for {$label}." ) );
		}
	}

	/**
	 * Gets row IDs from a rows REST response.
	 *
	 * @param array<string,mixed> $response Rows REST response payload.
	 * @return int[]
	 */
	private function rest_row_ids( array $response ): array {
		$rows = isset( $response['rows'] ) && is_array( $response['rows'] ) ? $response['rows'] : array();
		return array_map(
			static fn( mixed $row ): int => is_array( $row ) ? (int) ( $row['id'] ?? 0 ) : 0,
			$rows
		);
	}

	private function materialization_text_field_ids( array $manifest, string $slug ): array {
		$fields = $manifest['fields']['collections'][ $slug ] ?? array();
		if ( ! is_array( $fields ) ) {
			return array();
		}

		$field_ids = array();
		foreach ( $fields as $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}
			if ( in_array( (string) ( $field['type'] ?? '' ), array( 'text', 'email', 'url' ), true ) ) {
				$field_ids[] = (int) ( $field['id'] ?? 0 );
			}
		}

		return array_values( array_filter( $field_ids ) );
	}

	private function postmeta_filter_ids(
		int $collection_id,
		string $slug,
		int $number_field_id,
		float $minimum,
		int $select_field_id,
		string $select_value,
		int $limit
	): array {
		unset( $collection_id );
		global $wpdb;

		$post_type  = CollectionEntries::CPT_PREFIX . $slug;
		$number_key = Relations::meta_key( $number_field_id );
		$select_key = Relations::meta_key( $select_field_id );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark times the raw postmeta ID lookup.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT p.ID
				FROM {$wpdb->posts} AS p
				INNER JOIN {$wpdb->postmeta} AS n ON n.post_id = p.ID AND n.meta_key = %s
				INNER JOIN {$wpdb->postmeta} AS s ON s.post_id = p.ID AND s.meta_key = %s
				WHERE p.post_type = %s
				AND p.post_status IN ('draft', 'private', 'publish')
				AND CAST(n.meta_value AS DECIMAL(20,6)) > %f
				AND s.meta_value = %s
				ORDER BY p.ID ASC
				LIMIT %d",
				$number_key,
				$select_key,
				$post_type,
				$minimum,
				$select_value,
				$limit
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map( 'intval', $ids );
	}

	private function postmeta_text_search_ids( string $slug, array $field_ids, string $term, int $limit ): array {
		$field_keys = array_map(
			static fn( int $field_id ): string => Relations::meta_key( $field_id ),
			array_values( array_filter( array_map( 'intval', $field_ids ) ) )
		);
		if ( count( $field_keys ) === 0 ) {
			return array();
		}

		global $wpdb;

		$post_type    = CollectionEntries::CPT_PREFIX . $slug;
		$placeholders = implode( ', ', array_fill( 0, count( $field_keys ), '%s' ) );
		$like         = '%' . $wpdb->esc_like( $term ) . '%';
		$args         = array_merge( $field_keys, array( $post_type, $like, $limit ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark times the raw postmeta text search lookup.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT p.ID
				FROM {$wpdb->posts} AS p
				INNER JOIN {$wpdb->postmeta} AS pm ON pm.post_id = p.ID AND pm.meta_key IN ({$placeholders})
				WHERE p.post_type = %s
				AND p.post_status IN ('draft', 'private', 'publish')
				AND pm.meta_value LIKE %s
				ORDER BY p.ID ASC
				LIMIT %d",
				...$args
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return array_map( 'intval', $ids );
	}

	private function postmeta_text_search_filtered_ids(
		string $slug,
		array $field_ids,
		string $term,
		int $number_field_id,
		float $minimum,
		int $select_field_id,
		string $select_value,
		int $limit
	): array {
		$field_keys = array_map(
			static fn( int $field_id ): string => Relations::meta_key( $field_id ),
			array_values( array_filter( array_map( 'intval', $field_ids ) ) )
		);
		if ( count( $field_keys ) === 0 ) {
			return array();
		}

		global $wpdb;

		$post_type    = CollectionEntries::CPT_PREFIX . $slug;
		$number_key   = Relations::meta_key( $number_field_id );
		$select_key   = Relations::meta_key( $select_field_id );
		$placeholders = implode( ', ', array_fill( 0, count( $field_keys ), '%s' ) );
		$like         = '%' . $wpdb->esc_like( $term ) . '%';
		$args         = array_merge( $field_keys, array( $number_key, $select_key, $post_type, $like, $minimum, $select_value, $limit ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark times the raw postmeta filtered text search lookup.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT p.ID
				FROM {$wpdb->posts} AS p
				INNER JOIN {$wpdb->postmeta} AS pm ON pm.post_id = p.ID AND pm.meta_key IN ({$placeholders})
				INNER JOIN {$wpdb->postmeta} AS n ON n.post_id = p.ID AND n.meta_key = %s
				INNER JOIN {$wpdb->postmeta} AS s ON s.post_id = p.ID AND s.meta_key = %s
				WHERE p.post_type = %s
				AND p.post_status IN ('draft', 'private', 'publish')
				AND pm.meta_value LIKE %s
				AND CAST(n.meta_value AS DECIMAL(20,6)) > %f
				AND s.meta_value = %s
				ORDER BY p.ID ASC
				LIMIT %d",
				...$args
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return array_map( 'intval', $ids );
	}

	private function postmeta_date_sort_ids( string $slug, int $date_field_id, int $limit ): array {
		global $wpdb;

		$post_type = CollectionEntries::CPT_PREFIX . $slug;
		$date_key  = Relations::meta_key( $date_field_id );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark times the raw postmeta sort lookup.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT p.ID
				FROM {$wpdb->posts} AS p
				INNER JOIN {$wpdb->postmeta} AS d ON d.post_id = p.ID AND d.meta_key = %s
				WHERE p.post_type = %s
				AND p.post_status IN ('draft', 'private', 'publish')
				AND d.meta_value != ''
				ORDER BY d.meta_value ASC, p.ID ASC
				LIMIT %d",
				$date_key,
				$post_type,
				$limit
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map( 'intval', $ids );
	}

	private function postmeta_date_sort_filtered_ids(
		string $slug,
		int $date_field_id,
		int $number_field_id,
		float $minimum,
		int $select_field_id,
		string $select_value,
		int $limit
	): array {
		global $wpdb;

		$post_type  = CollectionEntries::CPT_PREFIX . $slug;
		$date_key   = Relations::meta_key( $date_field_id );
		$number_key = Relations::meta_key( $number_field_id );
		$select_key = Relations::meta_key( $select_field_id );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark times the raw postmeta filtered sort lookup.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT p.ID
				FROM {$wpdb->posts} AS p
				INNER JOIN {$wpdb->postmeta} AS d ON d.post_id = p.ID AND d.meta_key = %s
				INNER JOIN {$wpdb->postmeta} AS n ON n.post_id = p.ID AND n.meta_key = %s
				INNER JOIN {$wpdb->postmeta} AS s ON s.post_id = p.ID AND s.meta_key = %s
				WHERE p.post_type = %s
				AND p.post_status IN ('draft', 'private', 'publish')
				AND d.meta_value != ''
				AND CAST(n.meta_value AS DECIMAL(20,6)) > %f
				AND s.meta_value = %s
				ORDER BY d.meta_value ASC, p.ID ASC
				LIMIT %d",
				$date_key,
				$number_key,
				$select_key,
				$post_type,
				$minimum,
				$select_value,
				$limit
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map( 'intval', $ids );
	}

	private function postmeta_relation_contains_ids( string $slug, int $relation_field_id, int $target_row_id, int $limit ): array {
		global $wpdb;

		$post_type = CollectionEntries::CPT_PREFIX . $slug;
		$key       = Relations::meta_key( $relation_field_id );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark times the raw postmeta relation lookup.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT p.ID
				FROM {$wpdb->posts} AS p
				INNER JOIN {$wpdb->postmeta} AS r ON r.post_id = p.ID AND r.meta_key = %s
				WHERE p.post_type = %s
				AND p.post_status IN ('draft', 'private', 'publish')
				AND r.meta_value = %s
				ORDER BY p.ID ASC
				LIMIT %d",
				$key,
				$post_type,
				(string) $target_row_id,
				$limit
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map( 'intval', $ids );
	}

	private function postmeta_sum_number( string $slug, int $field_id ): float {
		global $wpdb;

		$post_type = CollectionEntries::CPT_PREFIX . $slug;
		$key       = Relations::meta_key( $field_id );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark times the raw postmeta aggregate lookup.
		return (float) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE(SUM(CAST(pm.meta_value AS DECIMAL(20,4))), 0)
				FROM {$wpdb->posts} AS p
				INNER JOIN {$wpdb->postmeta} AS pm ON pm.post_id = p.ID AND pm.meta_key = %s
				WHERE p.post_type = %s
				AND p.post_status IN ('draft', 'private', 'publish')",
				$key,
				$post_type
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	private function postmeta_count_text( string $slug, int $field_id, string $value ): int {
		global $wpdb;

		$post_type = CollectionEntries::CPT_PREFIX . $slug;
		$key       = Relations::meta_key( $field_id );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark times the raw postmeta aggregate lookup.
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID)
				FROM {$wpdb->posts} AS p
				INNER JOIN {$wpdb->postmeta} AS pm ON pm.post_id = p.ID AND pm.meta_key = %s
				WHERE p.post_type = %s
				AND p.post_status IN ('draft', 'private', 'publish')
				AND pm.meta_value = %s",
				$key,
				$post_type,
				$value
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	private function materialization_filter_tree( int $number_field_id, int $select_field_id, float $minimum ): array {
		return array(
			array(
				'relation' => 'AND',
				'filters'  => array(
					array(
						'field'    => Relations::meta_key( $number_field_id ),
						'operator' => 'greaterThan',
						'value'    => (string) $minimum,
					),
					array(
						'field'    => Relations::meta_key( $select_field_id ),
						'operator' => 'is',
						'value'    => 'stable',
					),
				),
			),
		);
	}

	private function prepare_materialization_writes( array $row_ids, int $field_id, float $base_value, FieldValueIndex $index, bool $sync_index ): void {
		FieldValueIndex::suspend_sync();
		try {
			foreach ( array_values( $row_ids ) as $offset => $row_id ) {
				update_post_meta( (int) $row_id, Relations::meta_key( $field_id ), (string) ( $base_value + $offset ) );
			}
		} finally {
			FieldValueIndex::resume_sync();
		}

		if ( $sync_index ) {
			foreach ( $row_ids as $row_id ) {
				$index->index_row_field( (int) $row_id, $field_id );
			}
		}
	}

	private function run_materialization_writes( array $row_ids, int $field_id, float $base_value, FieldValueIndex $index, bool $sync_index ): int {
		FieldValueIndex::suspend_sync();
		try {
			foreach ( array_values( $row_ids ) as $offset => $row_id ) {
				update_post_meta( (int) $row_id, Relations::meta_key( $field_id ), (string) ( $base_value + $offset ) );
			}
		} finally {
			FieldValueIndex::resume_sync();
		}

		if ( $sync_index ) {
			foreach ( $row_ids as $row_id ) {
				$index->index_row_field( (int) $row_id, $field_id );
			}
		}

		return count( $row_ids );
	}

	private function run_materialization_sidecar_writes( array $row_ids, int $field_id, FieldValueIndex $index ): int {
		foreach ( $row_ids as $row_id ) {
			$index->index_row_field( (int) $row_id, $field_id );
		}

		return count( $row_ids );
	}

	private function run_materialization_single_postmeta_write( int $row_id, int $field_id, float $value ): int {
		FieldValueIndex::suspend_sync();
		try {
			update_post_meta( $row_id, Relations::meta_key( $field_id ), (string) $value );
		} finally {
			FieldValueIndex::resume_sync();
		}

		return 1;
	}

	private function run_materialization_sidecar_known_writes( array $row_ids, int $field_id, float $base_value, int $collection_id, FieldValueIndex $index ): int {
		foreach ( array_values( $row_ids ) as $offset => $row_id ) {
			$index->index_known_value( (int) $row_id, $field_id, 'number', (string) ( $base_value + $offset ), $collection_id, 'private' );
		}

		return count( $row_ids );
	}

	private function run_materialization_rest_write( int $collection_id, int $row_id, int $field_id, float $value, bool $sidecar_enabled ): mixed {
		$disable_sidecar = static fn(): bool => false;
		if ( ! $sidecar_enabled ) {
			add_filter( 'cortext_field_values_index_enabled', $disable_sidecar );
		}

		try {
			return $this->rest_request(
				'POST',
				"/cortext/v1/collections/{$collection_id}/rows/{$row_id}",
				array(
					'collection_id' => $collection_id,
					'row_id'        => $row_id,
					'field'         => Relations::meta_key( $field_id ),
					'value'         => (string) $value,
				)
			);
		} finally {
			if ( ! $sidecar_enabled ) {
				remove_filter( 'cortext_field_values_index_enabled', $disable_sidecar );
			}
		}
	}

	private function run_materialization_store_writes( array $row_ids, int $field_id, float $base_value, int $collection_id, FieldValueIndex $index ): int {
		$store = new FieldValueStore( $index );
		foreach ( array_values( $row_ids ) as $offset => $row_id ) {
			$store->write_value( (int) $row_id, $field_id, 'number', (string) ( $base_value + $offset ), $collection_id, 'private' );
		}

		return count( $row_ids );
	}

	/**
	 * Builds the summary for a scenario split into steps. User-facing latency
	 * is the sum of step latencies, SQL queries are summed, and memory uses the
	 * highest step peak. Per-step fields only expose latency; SQL and memory
	 * would make the report noisy without adding much.
	 *
	 * @param string                                                                            $label         Scenario label.
	 * @param array<int,array{latency_ms:float,sql_queries:int,memory_bytes:int}>               $total_samples Aggregate samples per iteration.
	 * @param array<string,array<int,array{latency_ms:float,sql_queries:int,memory_bytes:int}>> $step_samples Per-step samples per iteration, keyed by step name.
	 * @return array<string,mixed>
	 */
	public static function summarize_stepped_samples( string $label, array $total_samples, array $step_samples ): array {
		$aggregate = self::summarize_samples( $total_samples );

		$summary = array_merge(
			array( 'label' => $label ),
			$aggregate,
			array(
				'total_p50_ms' => $aggregate['p50_ms'],
				'total_p95_ms' => $aggregate['p95_ms'],
				'total_mad_ms' => $aggregate['mad_ms'],
			)
		);

		foreach ( $step_samples as $step_name => $samples ) {
			$step_summary                     = self::summarize_samples( $samples );
			$summary[ "{$step_name}_p50_ms" ] = $step_summary['p50_ms'];
			$summary[ "{$step_name}_p95_ms" ] = $step_summary['p95_ms'];
			$summary[ "{$step_name}_mad_ms" ] = $step_summary['mad_ms'];
		}

		return $summary;
	}

	/**
	 * Runs a scenario split into named steps.
	 *
	 * @param array{label:string,steps:array<string,callable>,prepare?:callable} $scenario   Scenario config.
	 * @param int                                                                $warmup     Warm-up iterations.
	 * @param int                                                                $iterations Measured iterations.
	 * @return array<string,mixed>
	 */
	private function run_stepped_scenario( array $scenario, int $warmup, int $iterations ): array {
		$steps         = $scenario['steps'];
		$step_samples  = array_fill_keys( array_keys( $steps ), array() );
		$total_samples = array();

		$total = $warmup + $iterations;
		for ( $index = 0; $index < $total; $index++ ) {
			if ( isset( $scenario['prepare'] ) && is_callable( $scenario['prepare'] ) ) {
				$scenario['prepare']();
			}

			$iteration_latency = 0.0;
			$iteration_sql     = 0;
			$iteration_memory  = 0;
			$per_step          = array();

			foreach ( $steps as $step_name => $step_callback ) {
				$sample                 = $this->measure( $step_callback );
				$per_step[ $step_name ] = $sample;
				$iteration_latency     += $sample['latency_ms'];
				$iteration_sql         += $sample['sql_queries'];
				$iteration_memory       = max( $iteration_memory, $sample['memory_bytes'] );
			}

			if ( $index >= $warmup ) {
				foreach ( $per_step as $step_name => $sample ) {
					$step_samples[ $step_name ][] = $sample;
				}
				$total_samples[] = array(
					'latency_ms'   => $iteration_latency,
					'sql_queries'  => $iteration_sql,
					'memory_bytes' => $iteration_memory,
				);
			}
		}

		return self::summarize_stepped_samples( (string) $scenario['label'], $total_samples, $step_samples );
	}

	/**
	 * Measures one callback.
	 *
	 * @param callable $callback Scenario callback.
	 * @return array{latency_ms:float,sql_queries:int,memory_bytes:int}
	 */
	private function measure( callable $callback ): array {
		global $wpdb;

		wp_cache_flush();
		gc_collect_cycles();
		$queries_before = (int) $wpdb->num_queries;
		$memory_before  = memory_get_usage();
		$started_at     = hrtime( true );

		$result       = $callback();
		$memory_after = memory_get_usage();
		unset( $result );

		return array(
			'latency_ms'   => self::elapsed_ms( $started_at ),
			'sql_queries'  => (int) $wpdb->num_queries - $queries_before,
			'memory_bytes' => max( 0, $memory_after - $memory_before ),
		);
	}

	/**
	 * Dispatches a REST request and fails on non-2xx responses.
	 *
	 * @param string              $method HTTP method.
	 * @param string              $route REST route.
	 * @param array<string,mixed> $params REST params.
	 * @return mixed
	 * @throws RuntimeException When REST dispatch fails.
	 */
	private function rest_request( string $method, string $route, array $params ): mixed {
		$request = new WP_REST_Request( $method, $route );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		$response = rest_do_request( $request );
		if ( ! $response instanceof WP_REST_Response ) {
			throw new RuntimeException( esc_html( "REST request {$method} {$route} did not return a response." ) );
		}

		$status = $response->get_status();
		if ( $status >= 400 ) {
			$data = $response->get_data();
			$code = is_array( $data ) && isset( $data['code'] ) ? (string) $data['code'] : (string) $status;
			throw new RuntimeException( esc_html( "REST request {$method} {$route} failed with {$code}." ) );
		}

		return $response->get_data();
	}

	/**
	 * Runs a REST request with the field-value index forced on or off.
	 *
	 * @param bool                $enabled Whether this request can use the field-value index.
	 * @param string              $method  HTTP method.
	 * @param string              $route   REST route.
	 * @param array<string,mixed> $params  REST params.
	 * @return mixed
	 */
	private function rest_request_with_field_value_index( bool $enabled, string $method, string $route, array $params ): mixed {
		$disable_sidecar = static fn(): bool => false;
		if ( ! $enabled ) {
			add_filter( 'cortext_field_values_index_enabled', $disable_sidecar );
		}

		try {
			return $this->rest_request( $method, $route, $params );
		} finally {
			if ( ! $enabled ) {
				remove_filter( 'cortext_field_values_index_enabled', $disable_sidecar );
			}
		}
	}

	/**
	 * Puts migration rows back on the old option before a measured run.
	 *
	 * @param int    $field_id Field post ID.
	 * @param int[]  $row_ids Row IDs to reset to the old option.
	 * @param string $old_value Old option value.
	 * @param string $new_value New option value.
	 */
	private function prepare_migration( int $field_id, array $row_ids, string $old_value, string $new_value ): void {
		update_post_meta( $field_id, 'options', $this->options_json( array( $old_value, $new_value, 'stable' ) ) );
		$key = Relations::meta_key( $field_id );

		foreach ( $row_ids as $row_id ) {
			delete_post_meta( (int) $row_id, $key );
			add_post_meta( (int) $row_id, $key, $old_value );
		}
	}

	private function migrate_options( int $field_id, string $old_value, string $new_value ): mixed {
		return $this->rest_request(
			'POST',
			"/cortext/v1/fields/{$field_id}/options",
			array(
				'field_id'   => $field_id,
				'options'    => array(
					array(
						'value' => $new_value,
						'label' => $new_value,
					),
					array(
						'value' => 'stable',
						'label' => 'stable',
					),
				),
				'migrations' => array(
					array(
						'from'   => $old_value,
						'action' => 'replace',
						'to'     => $new_value,
					),
				),
			)
		);
	}

	/**
	 * Encodes option records.
	 *
	 * @param array<int,string> $values Option values.
	 */
	private function options_json( array $values ): string {
		$options = array();
		foreach ( $values as $value ) {
			$options[] = array(
				'value' => $value,
				'label' => $value,
			);
		}
		return (string) wp_json_encode( $options );
	}

	/**
	 * Loads the budget file.
	 *
	 * @param string $path Budget file path.
	 * @return array<string,mixed>
	 * @throws RuntimeException When the budget file cannot be loaded.
	 */
	private function load_budget( string $path ): array {
		$path = self::normalize_local_path( $path );
		if ( ! file_exists( $path ) ) {
			throw new RuntimeException( esc_html( "Budget file not found: {$path}" ) );
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Local budget file.
		$decoded = json_decode( (string) file_get_contents( $path ), true );
		if ( ! is_array( $decoded ) ) {
			throw new RuntimeException( esc_html( "Budget file is not valid JSON: {$path}" ) );
		}

		return $decoded;
	}

	/**
	 * Checks whether a manifest matches the requested seed config.
	 *
	 * @param array<string,mixed> $manifest Dataset manifest.
	 * @param array<string,int>   $config   Seed config.
	 */
	private static function manifest_matches_config( array $manifest, array $config ): bool {
		return ( $manifest['seed'] ?? '' ) === self::DATASET_SEED
			&& isset( $manifest['config'] )
			&& is_array( $manifest['config'] )
			&& self::normalize_int_map( $manifest['config'] ) === self::normalize_int_map( $config );
	}

	/**
	 * Checks whether the manifest still points at a real collection.
	 *
	 * @param array<string,mixed> $manifest Dataset manifest.
	 */
	private function manifest_is_usable( array $manifest ): bool {
		$collection_id = (int) ( $manifest['primary_collection_id'] ?? 0 );
		return $collection_id > 0 && Collection::POST_TYPE === get_post_type( $collection_id );
	}

	/**
	 * Returns the dataset summary printed in benchmark output.
	 *
	 * @param array<string,mixed> $manifest Dataset manifest.
	 * @return array<string,mixed>
	 */
	private static function public_dataset_summary( array $manifest ): array {
		$config      = isset( $manifest['config'] ) && is_array( $manifest['config'] )
			? self::normalize_int_map( $manifest['config'] )
			: array();
		$collections = array();
		foreach ( $manifest['collections'] ?? array() as $collection ) {
			$collections[] = array(
				'slug' => (string) ( $collection['slug'] ?? '' ),
				'rows' => isset( $manifest['rows'][ $collection['slug'] ] ) && is_array( $manifest['rows'][ $collection['slug'] ] )
					? count( $manifest['rows'][ $collection['slug'] ] )
					: 0,
			);
		}

		return array(
			'seed'                => (string) ( $manifest['seed'] ?? self::DATASET_SEED ),
			'collections'         => (int) ( $config['collections'] ?? count( $collections ) ),
			'rowsPerCollection'   => (int) ( $config['rows'] ?? 0 ),
			'fieldsPerCollection' => (int) ( $config['fields'] ?? 0 ),
			'wideFields'          => (int) ( $config['wide_fields'] ?? 0 ),
			'relations'           => (int) ( $config['relations'] ?? 0 ),
			'rollups'             => (int) ( $config['rollups'] ?? 0 ),
			'collectionRows'      => $collections,
		);
	}

	/**
	 * Hashes the benchmark config that has to match before comparing runs.
	 *
	 * @param array<string,mixed> $manifest    Dataset manifest.
	 * @param string              $budget_path Budget file path.
	 * @param string              $suite       Benchmark suite.
	 */
	private static function benchmark_config_hash( array $manifest, string $budget_path, string $suite = 'default' ): string {
		$config = isset( $manifest['config'] ) && is_array( $manifest['config'] )
			? self::normalize_int_map( $manifest['config'] )
			: array();

		return sha1(
			(string) wp_json_encode(
				array(
					'seed'        => (string) ( $manifest['seed'] ?? self::DATASET_SEED ),
					'suite'       => $suite,
					'seed_args'   => $config,
					'budget_path' => self::relative_local_path( $budget_path ),
				),
				JSON_UNESCAPED_SLASHES
			)
		);
	}

	private static function normalize_local_path( string $path ): string {
		if ( str_starts_with( $path, '/' ) ) {
			return $path;
		}

		return CORTEXT_PATH . ltrim( $path, '/' );
	}

	private static function relative_local_path( string $path ): string {
		$path = self::normalize_local_path( $path );
		if ( str_starts_with( $path, CORTEXT_PATH ) ) {
			return ltrim( substr( $path, strlen( CORTEXT_PATH ) ), '/' );
		}

		return $path;
	}

	/**
	 * Normalizes array values to sorted integers.
	 *
	 * @param array<string,mixed> $values Values.
	 * @return array<string,int>
	 */
	private static function normalize_int_map( array $values ): array {
		$normalized = array();
		foreach ( $values as $key => $value ) {
			$normalized[ (string) $key ] = (int) $value;
		}
		ksort( $normalized );
		return $normalized;
	}

	/**
	 * Returns a nearest-rank percentile.
	 *
	 * @param array<int,int|float> $values Values.
	 * @param int                  $percentile Percentile, 0-100.
	 */
	private static function percentile( array $values, int $percentile ): int|float {
		if ( count( $values ) === 0 ) {
			return 0;
		}

		sort( $values, SORT_NUMERIC );
		$index = (int) ceil( ( $percentile / 100 ) * count( $values ) ) - 1;
		$index = max( 0, min( count( $values ) - 1, $index ) );
		return $values[ $index ];
	}

	/**
	 * Returns the median absolute deviation, used as a robust noise floor for
	 * timing comparisons. With small n the percentile-based p95 is dominated by
	 * a single outlier; MAD against the median stays stable.
	 *
	 * @param array<int,int|float> $values Values.
	 */
	private static function mad( array $values ): float {
		if ( count( $values ) === 0 ) {
			return 0.0;
		}

		$median     = (float) self::percentile( $values, 50 );
		$deviations = array();
		foreach ( $values as $value ) {
			$deviations[] = abs( (float) $value - $median );
		}

		return (float) self::percentile( $deviations, 50 );
	}

	private static function flag_int( array $assoc_args, string $key, int $fallback, int $min ): int {
		if ( ! isset( $assoc_args[ $key ] ) ) {
			return $fallback;
		}

		$value = (int) $assoc_args[ $key ];
		return max( $min, $value );
	}

	private static function flag_bool( array $assoc_args, string $key, bool $fallback ): bool {
		if ( ! isset( $assoc_args[ $key ] ) ) {
			return $fallback;
		}

		$value = $assoc_args[ $key ];
		if ( is_bool( $value ) ) {
			return $value;
		}

		return in_array( strtolower( (string) $value ), array( '1', 'true', 'yes', 'on' ), true );
	}

	private static function elapsed_ms( int $started_at ): float {
		return round( ( hrtime( true ) - $started_at ) / 1_000_000, 3 );
	}
}
