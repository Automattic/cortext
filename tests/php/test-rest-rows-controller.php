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

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Rest\RowsController;
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
