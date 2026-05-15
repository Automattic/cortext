<?php
/**
 * Tests for Cortext\CLI\PerfBench.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\CLI\PerfBench;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use RuntimeException;
use WorDBless\BaseTestCase;

final class Test_CLI_Perf_Bench extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );
		$this->unregister_dynamic_collection_post_types();

		parent::tear_down();
	}

	public function test_summarize_samples_keeps_stable_shape(): void {
		$summary = PerfBench::summarize_samples(
			array(
				array(
					'latency_ms'   => 30.1234,
					'sql_queries'  => 12,
					'memory_bytes' => 1000,
				),
				array(
					'latency_ms'   => 10.1111,
					'sql_queries'  => 8,
					'memory_bytes' => 800,
				),
				array(
					'latency_ms'   => 20.9876,
					'sql_queries'  => 10,
					'memory_bytes' => 900,
				),
			)
		);

		$this->assertSame(
			array(
				'runs',
				'p50_ms',
				'p95_ms',
				'sql_queries_p50',
				'sql_queries_p95',
				'memory_bytes_p50',
				'memory_bytes_p95',
			),
			array_keys( $summary )
		);
		$this->assertSame( 3, $summary['runs'] );
		$this->assertSame( 20.988, $summary['p50_ms'] );
		$this->assertSame( 30.123, $summary['p95_ms'] );
		$this->assertSame( 10, $summary['sql_queries_p50'] );
		$this->assertSame( 12, $summary['sql_queries_p95'] );
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
		$this->assertTrue( post_type_exists( 'crtxt_perfmain' ) );
		$this->assertTrue( post_type_exists( 'crtxt_perftgt1' ) );
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

	private function unregister_dynamic_collection_post_types(): void {
		foreach ( get_post_types() as $post_type ) {
			if (
				str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) &&
				! in_array( $post_type, array( Collection::POST_TYPE, Field::POST_TYPE ), true )
			) {
				unregister_post_type( $post_type );
			}
		}
	}
}
