<?php
/**
 * Tests for Cortext\Rest\RowsController.
 *
 * The universal-document refactor cut down the rows surface: there's now a
 * single read endpoint (`GET /cortext/v1/rows?trait=<id>`) which returns
 * rows of a collection identified by trait id. Creation, update,
 * permanent-delete, restore, and duplicate moved either to core
 * `/wp/v2/crtxt_documents/*` (CRUD) or `/cortext/v1/documents/{id}/*`
 * (duplicate, reorder). Legacy tests for those routes live in
 * test-rest-documents-controller-mutations.php and
 * test-rest-rows-reorder.php; this file owns the read surface and a few
 * helpers (filter projection, sanitize_include_param, field definitions).
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\FieldValues\FieldValueIndex;
use Cortext\Formula\Compiler as FormulaCompiler;
use Cortext\Formula\Functions as FormulaFunctions;
use Cortext\Formula\Materializer as FormulaMaterializer;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Rest\RowsController;
use Cortext\Rest\RowsFilterQuery;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Rows_Controller extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new DocumentIdentity() )->register();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RowsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/cortext/v1/rows', $routes );
	}

	public function test_edit_context_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$fixture = $this->create_collection_fixture( 'sub-edit' );

		$response = $this->query_rows(
			array(
				'trait'   => $fixture['collection_id'],
				'context' => 'edit',
			)
		);

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_view_context_allows_anonymous_for_published_collection(): void {
		wp_set_current_user( 0 );

		$fixture = $this->create_collection_fixture( 'pub-rows', 'text', 'publish' );

		$response = $this->query_rows(
			array(
				'trait'   => $fixture['collection_id'],
				'context' => 'view',
			)
		);

		$this->assertSame( 200, $response->get_status() );
	}

	public function test_view_context_returns_collection_rows_for_published_collection(): void {
		wp_set_current_user( 0 );

		$fixture = $this->create_collection_fixture( 'pub-visible-rows', 'text', 'publish' );

		$this->create_row_fixture( $fixture['collection_id'], 'Visible row', 'publish' );
		$this->create_row_fixture( $fixture['collection_id'], 'Private row', 'private' );
		$this->create_row_fixture( $fixture['collection_id'], 'Draft row', 'draft' );

		$response = $this->query_rows(
			array(
				'trait'   => $fixture['collection_id'],
				'context' => 'view',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data   = $response->get_data();
		$titles = array_map(
			static fn( array $row ): string => $row['title']['raw'],
			$data['rows']
		);
		sort( $titles );

		$this->assertSame( 3, $data['total'] );
		$this->assertSame(
			array( 'Draft row', 'Private row', 'Visible row' ),
			$titles
		);
	}

	public function test_default_context_uses_editor_row_statuses(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'edit-visible-rows' );

		$this->create_row_fixture( $fixture['collection_id'], 'Visible row', 'publish' );
		$this->create_row_fixture( $fixture['collection_id'], 'Private row', 'private' );
		$this->create_row_fixture( $fixture['collection_id'], 'Draft row', 'draft' );

		$response = $this->query_rows(
			array(
				'trait' => $fixture['collection_id'],
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data   = $response->get_data();
		$titles = array_map(
			static fn( array $row ): string => $row['title']['raw'],
			$data['rows']
		);
		sort( $titles );

		$this->assertSame( 3, $data['total'] );
		$this->assertSame(
			array( 'Draft row', 'Private row', 'Visible row' ),
			$titles
		);
	}

	public function test_view_context_rejects_unpublished_collection(): void {
		wp_set_current_user( 0 );

		$fixture = $this->create_collection_fixture( 'private-rows', 'text', 'private' );

		$response = $this->query_rows(
			array(
				'trait'   => $fixture['collection_id'],
				'context' => 'view',
			)
		);

		// `private` collection rejects anonymous read with 401/403 depending on
		// `rest_authorization_required_code`.
		$this->assertGreaterThanOrEqual( 400, $response->get_status() );
	}

	public function test_rejects_nonexistent_collection(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->query_rows( array( 'trait' => 99999 ) );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_rejects_non_collection_post(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Regular post',
			)
		);

		$response = $this->query_rows( array( 'trait' => $post_id ) );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_response_shape(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'shape' );

		$response = $this->query_rows( array( 'trait' => $fixture['collection_id'] ) );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertArrayHasKey( 'rows', $data );
		$this->assertArrayHasKey( 'total', $data );
		$this->assertArrayHasKey( 'totalPages', $data );
		$this->assertArrayHasKey( 'collection', $data );
		$this->assertArrayHasKey( 'fields', $data );
		$this->assertArrayNotHasKey( 'calculations', $data );
	}

	public function test_query_rows_returns_calculations_for_full_result_set_with_paged_rows(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture   = $this->create_collection_fixture( 'calculations', 'number' );
		$score_id  = $fixture['field_id'];
		$status_id = $this->create_collection_field( $fixture['collection_id'], 'Status', 'text' );
		$notes_id  = $this->create_collection_field( $fixture['collection_id'], 'Notes', 'text' );
		$due_id    = $this->create_collection_field( $fixture['collection_id'], 'Due', 'date' );

		$this->create_row_fixture(
			$fixture['collection_id'],
			'Alpha row',
			'private',
			array(
				"field-{$score_id}"  => 10,
				"field-{$status_id}" => 'Alpha',
				"field-{$due_id}"    => '2026-02-01',
			)
		);
		$this->create_row_fixture(
			$fixture['collection_id'],
			'Beta row',
			'private',
			array(
				"field-{$score_id}"  => 20,
				"field-{$status_id}" => 'Beta',
				"field-{$notes_id}"  => 'Filled',
				"field-{$due_id}"    => '2026-01-01',
			)
		);
		$this->create_row_fixture(
			$fixture['collection_id'],
			'Gamma row',
			'private',
			array(
				"field-{$score_id}"  => 30,
				"field-{$status_id}" => 'Alpha',
				"field-{$due_id}"    => '2026-03-01',
			)
		);

		$response = $this->query_rows(
			array(
				'trait'        => $fixture['collection_id'],
				'per_page'     => 1,
				'calculations' => array(
					"field-{$score_id}"  => 'sum',
					"field-{$status_id}" => 'countUnique',
					"field-{$notes_id}"  => 'percentEmpty',
					"field-{$due_id}"    => 'min',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertCount( 1, $data['rows'] );
		$this->assertSame( 3, $data['total'] );
		$this->assertSame( 60.0, $data['calculations'][ "field-{$score_id}" ]['value'] );
		$this->assertSame( 2, $data['calculations'][ "field-{$status_id}" ]['value'] );
		$this->assertEqualsWithDelta( 2 / 3, $data['calculations'][ "field-{$notes_id}" ]['value'], 0.00001 );
		$this->assertSame( '2026-01-01', $data['calculations'][ "field-{$due_id}" ]['value'] );
	}

	public function test_query_rows_rejects_invalid_calculation_for_field_type(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'badcalc', 'text' );

		$response = $this->query_rows(
			array(
				'trait'        => $fixture['collection_id'],
				'calculations' => array(
					"field-{$fixture['field_id']}" => 'sum',
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_invalid_calculation', $response->as_error()->get_error_code() );
	}

	public function test_ids_shape_returns_paginated_ids_and_totals(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'ids-shape' );

		$first  = $this->create_row_fixture( $fixture['collection_id'], 'Private row', 'private' );
		$second = $this->create_row_fixture( $fixture['collection_id'], 'Draft row', 'draft' );
		$this->create_row_fixture( $fixture['collection_id'], 'Published row', 'publish' );

		$response = $this->query_rows(
			array(
				'trait'    => $fixture['collection_id'],
				'shape'    => 'ids',
				'per_page' => 2,
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( array( $first, $second ), $data['ids'] );
		$this->assertSame( 3, $data['total'] );
		$this->assertSame( 2, $data['totalPages'] );
		$this->assertArrayNotHasKey( 'rows', $data );
		$this->assertArrayNotHasKey( 'fields', $data );
	}

	public function test_ids_shape_requires_edit_context(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'ids-context', 'text', 'publish' );

		$response = $this->query_rows(
			array(
				'trait'   => $fixture['collection_id'],
				'shape'   => 'ids',
				'context' => 'view',
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_ids_shape_allows_larger_pages_than_full_rows(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'ids-large-page' );

		$ids_response = $this->query_rows(
			array(
				'trait'    => $fixture['collection_id'],
				'shape'    => 'ids',
				'per_page' => 101,
			)
		);
		$this->assertSame( 200, $ids_response->get_status() );

		$full_response = $this->query_rows(
			array(
				'trait'    => $fixture['collection_id'],
				'per_page' => 101,
			)
		);
		$this->assertSame( 400, $full_response->get_status() );
	}

	public function test_ids_shape_reads_from_field_value_index_when_available(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'ids-index' );
		$this->create_row_fixture( $fixture['collection_id'], 'Row one', 'private' );
		$this->create_row_fixture( $fixture['collection_id'], 'Row two', 'private' );

		// build_plan() only selects the index path when the sort uses an indexed
		// field.
		$params = array(
			'trait' => $fixture['collection_id'],
			'shape' => 'ids',
			'sort'  => array(
				'field'     => 'field-' . $fixture['field_id'],
				'direction' => 'asc',
			),
		);

		$fallback = $this->query_rows( $params );
		$this->assertSame( 200, $fallback->get_status() );
		$this->assertCount( 2, $fallback->get_data()['ids'] );

		// WorDBless cannot run the sidecar aggregate SQL, so the indexed path
		// returns no rows here. This distinguishes it from the two-row fallback.
		$this->with_readable_index(
			function () use ( $params ): void {
				$response = $this->query_rows( $params );
				$this->assertSame( 200, $response->get_status() );
				$data = $response->get_data();
				$this->assertSame( array(), $data['ids'] );
				$this->assertSame( 0, $data['total'] );
				$this->assertSame( 0, $data['totalPages'] );
			}
		);
	}

	public function test_wp_v2_row_records_include_cover_and_normalized_hydrated_meta(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'wpv2-hydrated', 'number' );
		$select  = $this->add_field_to_collection(
			$fixture['collection_id'],
			'select',
			array(
				'options' => wp_json_encode(
					array(
						array( 'value' => 'Alpha' ),
						array( 'value' => 'Beta' ),
					)
				),
			)
		);
		$multi   = $this->add_field_to_collection(
			$fixture['collection_id'],
			'multiselect',
			array(
				'options' => wp_json_encode(
					array(
						array( 'value' => 'Alpha' ),
						array( 'value' => 'Gamma' ),
					)
				),
			)
		);
		$row_id  = $this->create_row_fixture( $fixture['collection_id'], 'Hydrated row', 'private' );

		add_post_meta( $row_id, 'field-' . $fixture['field_id'], '7.5' );
		add_post_meta( $row_id, 'field-' . $select, 'Beta, Alpha' );
		add_post_meta( $row_id, 'field-' . $multi, 'Alpha; Missing; Gamma' );

		$attachment_id = $this->create_attachment_fixture();
		update_post_meta( $row_id, '_thumbnail_id', $attachment_id );
		update_post_meta( $attachment_id, '_wp_attachment_image_alt', 'Cover alt' );

		$image_filter = static function ( $downsize, int $image_id ) use ( $attachment_id ) {
			if ( $image_id !== $attachment_id ) {
				return $downsize;
			}
			return array( 'https://example.test/cover.jpg', 1200, 800, false );
		};

		add_filter( 'image_downsize', $image_filter, 10, 2 );
		try {
			$single = $this->get_document_record( $row_id );
			$list   = $this->get_document_record_from_list( $row_id );
		} finally {
			remove_filter( 'image_downsize', $image_filter, 10 );
		}

		foreach ( array( $single, $list ) as $record ) {
			$this->assertSame( 7.5, $record['cortext_hydrated_meta'][ 'field-' . $fixture['field_id'] ] );
			$this->assertSame( 'Beta', $record['cortext_hydrated_meta'][ 'field-' . $select ] );
			$this->assertSame( array( 'Alpha', 'Gamma' ), $record['cortext_hydrated_meta'][ 'field-' . $multi ] );
			$this->assertSame(
				array(
					'id'  => $attachment_id,
					'url' => 'https://example.test/cover.jpg',
					'alt' => 'Cover alt',
				),
				$record['cover']
			);
		}
	}

	public function test_wp_v2_fields_projection_skips_unrequested_row_enrichment(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'wpv2-projected', 'number' );
		$row_id  = $this->create_row_fixture( $fixture['collection_id'], 'Projected row', 'private' );

		add_post_meta( $row_id, 'field-' . $fixture['field_id'], '7.5' );
		update_post_meta( $row_id, '_modified_by', get_current_user_id() );
		update_post_meta( $row_id, '_thumbnail_id', $this->create_attachment_fixture() );

		$observed_keys = array();
		$meta_filter   = static function ( $value, int $object_id, string $meta_key ) use ( &$observed_keys, $row_id ) {
			if ( $row_id === $object_id ) {
				$observed_keys[] = $meta_key;
			}
			return $value;
		};

		add_filter( 'get_post_metadata', $meta_filter, 10, 3 );
		try {
			$record = $this->get_document_record( $row_id, 'id,link,title' );
		} finally {
			remove_filter( 'get_post_metadata', $meta_filter, 10 );
		}

		$this->assertSame( array( 'id', 'link', 'title' ), array_keys( $record ) );
		$this->assertNotContains( 'field-' . $fixture['field_id'], $observed_keys );
		$this->assertNotContains( '_modified_by', $observed_keys );
		$this->assertNotContains( '_thumbnail_id', $observed_keys );
	}

	public function test_wp_v2_row_format_context_is_fresh_for_each_request(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'wpv2-fresh-context', 'number' );
		$row_id  = $this->create_row_fixture( $fixture['collection_id'], 'Converted row', 'private' );
		$key     = 'field-' . $fixture['field_id'];

		add_post_meta( $row_id, $key, '7.5' );
		$first = $this->get_document_record( $row_id, 'cortext_hydrated_meta' );
		$this->assertSame( 7.5, $first['cortext_hydrated_meta'][ $key ] );

		update_post_meta( $fixture['field_id'], 'type', 'text' );

		$second = $this->get_document_record( $row_id, 'cortext_hydrated_meta' );
		$this->assertSame( '7.5', $second['cortext_hydrated_meta'][ $key ] );
	}

	public function test_field_definitions_in_response(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture  = $this->create_collection_fixture( 'fielddef', 'number' );
		$response = $this->query_rows( array( 'trait' => $fixture['collection_id'] ) );

		$fields = $response->get_data()['fields'];
		$this->assertNotEmpty( $fields );
		$by_id = array_column( $fields, null, 'id' );
		$this->assertArrayHasKey( $fixture['field_id'], $by_id );
		$this->assertSame( 'number', $by_id[ $fixture['field_id'] ]['type'] );
	}

	public function test_query_rows_materializes_formula_values(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture    = $this->create_collection_fixture( 'formulaval', 'number' );
		$row_id     = $this->create_row_for_collection( $fixture['collection_id'], 'Invoice A' );
		$formula_id = $this->create_formula_field( $fixture['collection_id'], 'Total', 'field("Score") * 2' );

		update_post_meta( $row_id, "field-{$fixture['field_id']}", '10' );
		update_post_meta( $row_id, "field-{$formula_id}", '-999' );

		$response = $this->query_rows( array( 'trait' => $fixture['collection_id'] ) );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 20.0, $data['rows'][0]['meta'][ "field-{$formula_id}" ] );
		$this->assertSame( 20.0, (float) get_post_meta( $row_id, "field-{$formula_id}", true ) );
	}

	public function test_core_rest_row_updates_recompute_formula_values(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$fixture    = $this->create_collection_fixture( 'formularest', 'number' );
		$row_id     = $this->create_row_for_collection( $fixture['collection_id'], 'Invoice A' );
		$formula_id = $this->create_formula_field( $fixture['collection_id'], 'Total', 'field("Score") * 2' );

		$document = new Document();
		$document->register_field_meta();
		add_filter( 'rest_pre_insert_' . Document::POST_TYPE, array( $document, 'prepare_meta_updates' ), 10, 2 );
		add_action( 'rest_after_insert_' . Document::POST_TYPE, array( $document, 'apply_meta_updates' ), 20, 3 );

		$request = new WP_REST_Request( 'PUT', "/wp/v2/crtxt_documents/{$row_id}" );
		$request->set_param( 'id', $row_id );
		$request->set_param(
			'meta',
			array(
				"field-{$fixture['field_id']}" => '15',
				"field-{$formula_id}"          => '999',
			)
		);
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 30.0, (float) get_post_meta( $row_id, "field-{$formula_id}", true ) );
	}

	public function test_rest_prepare_row_hydrates_formula_values(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$fixture    = $this->create_collection_fixture( 'formulahydrate', 'number' );
		$row_id     = $this->create_row_for_collection( $fixture['collection_id'], 'Invoice A' );
		$formula_id = $this->create_formula_field( $fixture['collection_id'], 'Total', 'field("Score") + 5' );

		update_post_meta( $row_id, "field-{$fixture['field_id']}", '10' );

		$request = new WP_REST_Request( 'GET', "/wp/v2/crtxt_documents/{$row_id}" );
		$request->set_param( 'id', $row_id );
		$request->set_param( 'context', 'edit' );
		$response = rest_do_request( $request );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 15.0, $data['cortext_hydrated_meta'][ "field-{$formula_id}" ] );
	}

	public function test_formula_result_type_controls_sort_and_filter_schema(): void {
		$fixture    = $this->create_collection_fixture( 'formulaquery', 'number' );
		$formula_id = $this->create_formula_field( $fixture['collection_id'], 'Total', 'field("Score") + 5' );
		$key        = "field-{$formula_id}";

		$query  = new RowsFilterQuery();
		$schema = $query->field_schema_for( $fixture['collection_id'] );

		$this->assertSame( 'number', $schema[ $key ]['type'] );
		$this->assertTrue( $query->validate_sort( array( 'field' => $key, 'direction' => 'asc' ), $schema, $fixture['collection_id'] ) );
		$this->assertIsArray(
			$query->compile_filters(
				array(
					array(
						'field'    => $key,
						'operator' => 'greaterThan',
						'value'    => 10,
					),
				),
				$schema,
				$fixture['collection_id']
			)
		);
	}

	public function test_volatile_formula_refresh_only_runs_when_query_needs_it(): void {
		$fixture    = $this->create_collection_fixture( 'formulanow', 'number' );
		$formula_id = $this->create_formula_field( $fixture['collection_id'], 'Age', 'dateBetween(now(), prop("Created"), "days")' );
		$method     = new \ReflectionMethod( RowsController::class, 'query_needs_volatile_formula_materialization' );
		$method->setAccessible( true );
		$controller = new RowsController();

		$plain_request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$this->assertFalse( $method->invoke( $controller, $fixture['collection_id'], $plain_request ) );

		$sort_request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$sort_request->set_param( 'sort', array( 'field' => "field-{$formula_id}", 'direction' => 'asc' ) );
		$this->assertTrue( $method->invoke( $controller, $fixture['collection_id'], $sort_request ) );
	}

	public function test_date_between_uses_calendar_months(): void {
		$method = new \ReflectionMethod( FormulaFunctions::class, 'date_between' );
		$method->setAccessible( true );

		$this->assertSame(
			2.0,
			$method->invoke(
				null,
				array(
					array( 'value' => '2024-03-01' ),
					array( 'value' => '2024-01-01' ),
					array( 'value' => 'months' ),
				)
			)
		);
	}

	public function test_sanitize_include_param_dedupes_drops_zero_and_normalizes(): void {
		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'sanitize_include_param' );
		$method->setAccessible( true );

		$this->assertSame(
			array( 1, 2, 3 ),
			$method->invoke( $controller, array( '1', 0, 2, '3', 2, '0', null, false ) )
		);
	}

	public function test_validate_include_param_rejects_more_than_100_ids(): void {
		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'validate_include_param' );
		$method->setAccessible( true );

		$this->assertNotTrue( $method->invoke( $controller, range( 1, 101 ), new WP_REST_Request(), 'include' ) );
		$this->assertTrue( $method->invoke( $controller, range( 1, 100 ), new WP_REST_Request(), 'include' ) );
	}

	public function test_query_rows_short_circuits_when_include_is_empty_after_sanitize(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'includezero' );

		$response = $this->query_rows(
			array(
				'trait'   => $fixture['collection_id'],
				'include' => array( '0', '' ),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 0, $data['total'] );
		$this->assertSame( array(), $data['rows'] );
	}

	public function test_query_rows_rejects_include_with_more_than_100_ids(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'includehundred' );

		$response = $this->query_rows(
			array(
				'trait'   => $fixture['collection_id'],
				'include' => range( 1, 101 ),
			)
		);

		$this->assertGreaterThanOrEqual( 400, $response->get_status() );
	}

	private function query_rows( array $params ): \WP_REST_Response {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
		return rest_do_request( $request );
	}

	/**
	 * Forces FieldValueIndex::can_read() to return true for the callback, then
	 * restores the postmeta-only default. WorDBless has no index table, so this
	 * checks path selection without running the indexed SQL.
	 *
	 * @param callable $callback Callback to run while the index reports readable.
	 */
	private function with_readable_index( callable $callback ): void {
		$reflection  = new \ReflectionClass( FieldValueIndex::class );
		$table_cache = $reflection->getProperty( 'table_exists_cache' );
		$table_cache->setAccessible( true );

		update_option( 'cortext_field_values_index_status', FieldValueIndex::STATUS_READY, false );
		update_option( 'cortext_field_values_schema_version', 2, false );
		$table_cache->setValue( null, array( ( new FieldValueIndex() )->table_name() => true ) );

		try {
			$callback();
		} finally {
			$table_cache->setValue( null, array() );
			FieldValueIndex::flush_runtime_caches();
			delete_option( 'cortext_field_values_index_status' );
			delete_option( 'cortext_field_values_schema_version' );
		}
	}

	private function get_document_record( int $document_id, ?string $fields = null ): array {
		$request = new WP_REST_Request( 'GET', "/wp/v2/crtxt_documents/{$document_id}" );
		$request->set_param( 'context', 'edit' );
		if ( null !== $fields ) {
			$request->set_param( '_fields', $fields );
		}
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		return $response->get_data();
	}

	private function get_document_record_from_list( int $document_id ): array {
		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'context', 'edit' );
		$request->set_param( 'status', array( 'draft', 'private', 'publish' ) );
		$request->set_param( 'include', array( $document_id ) );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		foreach ( $response->get_data() as $record ) {
			if ( isset( $record['id'] ) && (int) $record['id'] === $document_id ) {
				return $record;
			}
		}

		$this->fail( 'Expected the list response to contain the document.' );
	}

	/**
	 * Creates a collection document and one scalar field.
	 *
	 * @param string $slug        Cosmetic slug stored as `post_name`.
	 * @param string $field_type  Type of the seeded field.
	 * @param string $post_status Collection post status.
	 * @return array{collection_id:int,field_id:int}
	 */
	private function create_collection_fixture(
		string $slug,
		string $field_type = 'number',
		string $post_status = 'private'
	): array {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => $post_status,
				'post_title'  => ucfirst( $slug ),
				'post_name'   => $slug,
			)
		);

		$field_id = $this->create_collection_field( $collection_id, 'Score', $field_type );

		return array(
			'collection_id' => $collection_id,
			'field_id'      => $field_id,
		);
	}

	private function create_collection_field( int $collection_id, string $title, string $field_type ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => $field_type ),
			)
		);

		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		return $field_id;
	}

	private function add_field_to_collection( int $collection_id, string $field_type, array $meta = array() ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => ucfirst( $field_type ),
				'meta_input'  => array_merge( array( 'type' => $field_type ), $meta ),
			)
		);

		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		return $field_id;
	}

	private function create_row_fixture( int $collection_id, string $title, string $post_status, array $meta = array() ): int {
		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => $post_status,
				'post_title'  => $title,
			)
		);

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		if ( $term_id > 0 ) {
			wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		}

		foreach ( $meta as $key => $value ) {
			update_post_meta( $row_id, $key, $value );
		}

		return $row_id;
	}

	private function create_row_for_collection( int $collection_id, string $title ): int {
		return $this->create_row_fixture( $collection_id, $title, 'publish' );
	}

	private function create_formula_field( int $collection_id, string $title, string $expression ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => 'formula' ),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		$compiled = ( new FormulaCompiler() )->compile( $expression, $collection_id, $field_id );
		update_post_meta( $field_id, 'expression', $expression );
		update_post_meta( $field_id, 'formula_result_type', $compiled['result_type'] );
		update_post_meta( $field_id, 'formula_ast', wp_json_encode( $compiled['ast'] ) );
		update_post_meta( $field_id, 'formula_dep_field_ids', wp_json_encode( $compiled['deps'] ) );
		update_post_meta( $field_id, 'formula_resolved_refs', wp_json_encode( $compiled['refs'] ) );
		update_post_meta( $field_id, 'formula_is_volatile', ! empty( $compiled['volatile'] ) ? '1' : '0' );
		FormulaMaterializer::recompute_collection( $collection_id );

		return $field_id;
	}

	private function create_attachment_fixture(): int {
		return (int) wp_insert_post(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'Cover',
			)
		);
	}

	private function create_user( string $role ): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_', false ),
				'user_pass'  => 'password',
				'role'       => $role,
			)
		);
	}
}
