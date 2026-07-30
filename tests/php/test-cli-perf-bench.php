<?php
/**
 * Tests for Cortext\CLI\PerfBench.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\CLI\PerfBench;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Taxonomy\TraitTaxonomy;
use RuntimeException;
use WorDBless\BaseTestCase;

final class Test_CLI_Perf_Bench extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		( new Field() )->register_post_type();
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_summarize_samples_keeps_stable_shape(): void {
		$summary = PerfBench::summarize_samples(
			array(
				array(
					'latency_ms'    => 30.1234,
					'sql_queries'   => 12,
					'memory_bytes'  => 1000,
					'payload_bytes' => 100,
				),
				array(
					'latency_ms'    => 10.1111,
					'sql_queries'   => 8,
					'memory_bytes'  => 800,
					'payload_bytes' => 80,
				),
				array(
					'latency_ms'    => 20.9876,
					'sql_queries'   => 10,
					'memory_bytes'  => 900,
					'payload_bytes' => 90,
				),
			)
		);

		$this->assertSame(
			array(
				'runs',
				'p50_ms',
				'p95_ms',
				'mad_ms',
				'sql_queries_p50',
				'sql_queries_p95',
				'memory_bytes_p50',
				'memory_bytes_p95',
				'payload_bytes_p50',
				'payload_bytes_p95',
			),
			array_keys( $summary )
		);
		$this->assertSame( 3, $summary['runs'] );
		$this->assertSame( 20.988, $summary['p50_ms'] );
		$this->assertSame( 30.123, $summary['p95_ms'] );
		$this->assertSame( 9.136, $summary['mad_ms'] );
		$this->assertSame( 10, $summary['sql_queries_p50'] );
		$this->assertSame( 12, $summary['sql_queries_p95'] );
		$this->assertSame( 90, $summary['payload_bytes_p50'] );
		$this->assertSame( 100, $summary['payload_bytes_p95'] );
	}

	public function test_summarize_stepped_samples_exposes_total_and_per_step_metrics(): void {
		$total_samples = array(
			array(
				'latency_ms'    => 12.0,
				'sql_queries'   => 8,
				'memory_bytes'  => 2000,
				'payload_bytes' => 300,
			),
			array(
				'latency_ms'    => 18.0,
				'sql_queries'   => 12,
				'memory_bytes'  => 2400,
				'payload_bytes' => 500,
			),
			array(
				'latency_ms'    => 15.0,
				'sql_queries'   => 10,
				'memory_bytes'  => 2200,
				'payload_bytes' => 400,
			),
		);

		$step_samples = array(
			'resolve' => array(
				array(
					'latency_ms'    => 2.0,
					'sql_queries'   => 1,
					'memory_bytes'  => 500,
					'payload_bytes' => 50,
				),
				array(
					'latency_ms'    => 3.0,
					'sql_queries'   => 2,
					'memory_bytes'  => 600,
					'payload_bytes' => 60,
				),
				array(
					'latency_ms'    => 2.5,
					'sql_queries'   => 1,
					'memory_bytes'  => 550,
					'payload_bytes' => 55,
				),
			),
			'hydrate' => array(
				array(
					'latency_ms'    => 10.0,
					'sql_queries'   => 7,
					'memory_bytes'  => 2000,
					'payload_bytes' => 250,
				),
				array(
					'latency_ms'    => 15.0,
					'sql_queries'   => 10,
					'memory_bytes'  => 2400,
					'payload_bytes' => 440,
				),
				array(
					'latency_ms'    => 12.5,
					'sql_queries'   => 9,
					'memory_bytes'  => 2200,
					'payload_bytes' => 345,
				),
			),
		);

		$summary = PerfBench::summarize_stepped_samples( 'Open a row detail', $total_samples, $step_samples );

		$this->assertSame( 'Open a row detail', $summary['label'] );
		$this->assertSame(
			array(
				'label',
				'runs',
				'p50_ms',
				'p95_ms',
				'mad_ms',
				'sql_queries_p50',
				'sql_queries_p95',
				'memory_bytes_p50',
				'memory_bytes_p95',
				'payload_bytes_p50',
				'payload_bytes_p95',
				'total_p50_ms',
				'total_p95_ms',
				'total_mad_ms',
				'resolve_p50_ms',
				'resolve_p95_ms',
				'resolve_mad_ms',
				'hydrate_p50_ms',
				'hydrate_p95_ms',
				'hydrate_mad_ms',
			),
			array_keys( $summary )
		);
		$this->assertSame( $summary['p50_ms'], $summary['total_p50_ms'] );
		$this->assertSame( $summary['p95_ms'], $summary['total_p95_ms'] );
		$this->assertGreaterThan( $summary['resolve_p50_ms'], $summary['hydrate_p50_ms'] );
		$this->assertSame( 400, $summary['payload_bytes_p50'] );
		$this->assertSame( 500, $summary['payload_bytes_p95'] );
	}

	public function test_compare_row_shape_summaries_reports_resource_reductions(): void {
		$comparisons = PerfBench::compare_row_shape_summaries(
			array(
				'row_shape_page_1_full' => array(
					'label'             => 'First page (full)',
					'p50_ms'            => 20.0,
					'p95_ms'            => 40.0,
					'sql_queries_p95'   => 12,
					'memory_bytes_p95'  => 1000,
					'payload_bytes_p95' => 10000,
				),
				'row_shape_page_1_ids'  => array(
					'label'             => 'First page (IDs)',
					'p50_ms'            => 10.0,
					'p95_ms'            => 20.0,
					'sql_queries_p95'   => 4,
					'memory_bytes_p95'  => 250,
					'payload_bytes_p95' => 1000,
				),
			)
		);

		$this->assertArrayHasKey( 'page_1', $comparisons );
		$comparison = $comparisons['page_1'];
		$this->assertSame( 'First page', $comparison['label'] );
		$this->assertSame( 50.0, $comparison['p50_reduction_pct'] );
		$this->assertSame( 50.0, $comparison['p95_reduction_pct'] );
		$this->assertSame( 8, $comparison['sql_queries_p95_reduction'] );
		$this->assertSame( 75.0, $comparison['memory_p95_reduction_pct'] );
		$this->assertSame( 90.0, $comparison['payload_p95_reduction_pct'] );
	}

	public function test_compare_link_suggestion_summaries_reports_projected_reductions(): void {
		$comparisons = PerfBench::compare_link_suggestion_summaries(
			array(
				'link_suggestions_initial_3_forced'    => array(
					'label'             => 'Initial link suggestions (forced enrichment)',
					'p50_ms'            => 10.0,
					'p95_ms'            => 12.0,
					'sql_queries_p95'   => 30,
					'memory_bytes_p95'  => 1000,
					'payload_bytes_p95' => 500,
				),
				'link_suggestions_initial_3_projected' => array(
					'label'             => 'Initial link suggestions (projected)',
					'p50_ms'            => 2.0,
					'p95_ms'            => 3.0,
					'sql_queries_p95'   => 8,
					'memory_bytes_p95'  => 200,
					'payload_bytes_p95' => 500,
				),
			)
		);

		$this->assertArrayHasKey( 'initial_3', $comparisons );
		$comparison = $comparisons['initial_3'];
		$this->assertSame( 'Initial link suggestions', $comparison['label'] );
		$this->assertSame( 80.0, $comparison['p50_reduction_pct'] );
		$this->assertSame( 75.0, $comparison['p95_reduction_pct'] );
		$this->assertSame( 22, $comparison['sql_queries_p95_reduction'] );
		$this->assertSame( 80.0, $comparison['memory_p95_reduction_pct'] );
		$this->assertSame( 0.0, $comparison['payload_p95_reduction_pct'] );
	}

	public function test_apply_budgets_marks_failures(): void {
		$result = PerfBench::apply_budgets(
			array(
				'rows_page_1' => array(
					'label'            => 'Rows page 1',
					'runs'             => 3,
					'p50_ms'           => 10.0,
					'p95_ms'           => 25.0,
					'sql_queries_p50'  => 5,
					'sql_queries_p95'  => 8,
					'memory_bytes_p50' => 1024,
					'memory_bytes_p95' => 2048,
				),
			),
			array(
				'version'   => 1,
				'scenarios' => array(
					'rows_page_1' => array(
						'p95_ms'           => 20,
						'sql_queries_p95'  => 10,
						'memory_bytes_p95' => 4096,
					),
				),
			)
		);

		$this->assertFalse( $result['passed'] );
		$this->assertFalse( $result['scenarios']['rows_page_1']['passed'] );
		$this->assertSame( 'rows_page_1', $result['failures'][0]['scenario'] );
		$this->assertSame( 'p95_ms', $result['failures'][0]['metric'] );
	}

	public function test_apply_budgets_supports_payload_limits(): void {
		$result = PerfBench::apply_budgets(
			array(
				'row_shape_page_1_ids' => array(
					'payload_bytes_p95' => 2048,
				),
			),
			array(
				'scenarios' => array(
					'row_shape_page_1_ids' => array(
						'payload_bytes_p95' => 1024,
					),
				),
			)
		);

		$this->assertFalse( $result['passed'] );
		$this->assertSame( 'payload_bytes_p95', $result['failures'][0]['metric'] );
	}

	public function test_scenario_filter_limits_run_to_matching_ids(): void {
		$method = ( new \ReflectionClass( PerfBench::class ) )->getMethod( 'filter_scenarios' );
		$method->setAccessible( true );

		$scenarios = array(
			'rows_page_1'                   => array(
				'label' => 'Rows page 1',
				'run'   => static fn() => null,
			),
			'mat_single_write_postmeta'     => array(
				'label' => 'Single postmeta write',
				'run'   => static fn() => null,
			),
			'mat_single_write_sidecar'      => array(
				'label' => 'Single sidecar write',
				'run'   => static fn() => null,
			),
			'mat_filter_two_fields_sidecar' => array(
				'label' => 'Sidecar filter',
				'run'   => static fn() => null,
			),
		);

		$filtered = $method->invoke( new PerfBench(), $scenarios, 'mat_single' );

		$this->assertSame(
			array(
				'mat_single_write_postmeta',
				'mat_single_write_sidecar',
			),
			array_keys( $filtered )
		);
	}

	public function test_row_shape_suite_registers_equivalent_full_and_ids_cases(): void {
		$method = ( new \ReflectionClass( PerfBench::class ) )->getMethod( 'row_shape_cases' );
		$method->setAccessible( true );

		$cases = $method->invoke(
			new PerfBench(),
			array(
				'primary_collection_id' => 10,
				'wide_collection_id'    => 20,
				'sort_field_id'         => 101,
				'fields'                => array(
					'primary' => array(
						'scalar_field_ids' => range( 100, 106 ),
					),
				),
			)
		);

		$this->assertSame(
			array(
				'page_1_fallback',
				'page_50_fallback',
				'page_100_fallback',
				'first_1000_fallback',
				'search_fallback',
				'sort_fallback',
				'sort_sidecar',
				'filter_fallback',
				'filter_sidecar',
				'relation_heavy_fallback',
				'rollup_heavy_fallback',
				'wide_schema_fallback',
			),
			array_keys( $cases )
		);
		foreach ( $cases as $case ) {
			$this->assertIsCallable( $case['full'] );
			$this->assertIsCallable( $case['ids'] );
		}

		foreach ( $cases as $case_id => $case ) {
			if ( 'first_1000_fallback' === $case_id ) {
				$this->assertCount( 10, $case['full_params'] );
				$this->assertCount( 10, $case['full_requests'] );
				foreach ( $case['full_requests'] as $request ) {
					$this->assertIsCallable( $request );
				}
				$this->assertSame( 1000, $case['ids_params']['per_page'] );
				$this->assertSame( 1000, $case['expected_rows'] );
				continue;
			}
			$this->assertSame( $case['full_params'], $case['ids_params'] );
			$this->assertSame( 1, $case['expected_rows'] );
		}
	}

	public function test_request_batch_aggregates_totals_without_retaining_every_response(): void {
		$method = ( new \ReflectionClass( PerfBench::class ) )->getMethod( 'measure_request_batch' );
		$method->setAccessible( true );

		$result = $method->invoke(
			new PerfBench(),
			array(
				static fn() => str_repeat( 'a', 10 ),
				static fn() => str_repeat( 'b', 20 ),
			)
		);

		$this->assertIsFloat( $result['latency_ms'] );
		$this->assertGreaterThanOrEqual( 0.0, $result['latency_ms'] );
		$this->assertIsInt( $result['sql_queries'] );
		$this->assertGreaterThanOrEqual( 0, $result['memory_bytes'] );
		$this->assertSame( 34, $result['payload_bytes'] );
	}

	public function test_row_shape_suite_registers_real_link_suggestion_requests(): void {
		$method = ( new \ReflectionClass( PerfBench::class ) )->getMethod( 'link_suggestion_cases' );
		$method->setAccessible( true );
		$cases = $method->invoke( new PerfBench() );

		$this->assertSame( array( 'initial_3', 'search_20' ), array_keys( $cases ) );
		$this->assertSame( 3, $cases['initial_3']['params']['per_page'] );
		$this->assertSame( 20, $cases['search_20']['params']['per_page'] );
		$this->assertSame( 'id,link,title', $cases['search_20']['params']['_fields'] );
		foreach ( $cases as $case ) {
			$this->assertIsCallable( $case['forced'] );
			$this->assertIsCallable( $case['projected'] );
		}
	}

	public function test_seed_dataset_creates_small_deterministic_fixture(): void {
		wp_set_current_user( $this->create_admin_user() );

		$manifest = ( new PerfBench() )->seed_dataset(
			array(
				'collections' => 2,
				'rows'        => 12,
				'fields'      => 7,
				'wide_fields' => 8,
				'relations'   => 1,
				'rollups'     => 1,
			),
			true
		);

		$this->assertSame( 'collection-perf-v1', $manifest['seed'] );
		$this->assertCount( 2, $manifest['collections'] );
		$this->assertCount( 12, $manifest['primary_row_ids'] );
		$this->assertGreaterThan( 0, $manifest['sort_field_id'] );
		$this->assertGreaterThan( 0, $manifest['relation_field_id'] );
		$this->assertGreaterThan( 0, $manifest['migration_field_id'] );
		$this->assertTrue( post_type_exists( Document::POST_TYPE ) );
		$this->assertGreaterThan( 0, $manifest['primary_collection_id'] );
		$this->assertSame( 'perfmain', $manifest['primary_slug'] );
	}

	public function test_seed_dataset_rejects_too_few_fields(): void {
		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( 'at least 7 scalar fields' );

		( new PerfBench() )->seed_dataset(
			array(
				'collections' => 2,
				'rows'        => 12,
				'fields'      => 6,
				'wide_fields' => 8,
				'relations'   => 1,
				'rollups'     => 1,
			),
			true
		);
	}

	private function create_admin_user(): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_perf_', false ),
				'user_pass'  => 'password',
				'role'       => 'administrator',
			)
		);
	}
}
