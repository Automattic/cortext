<?php
/**
 * Tests for Cortext\Rest\RowsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\Rest\RowsController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Rows_Controller extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RowsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	// -- Route & permission tests (via REST) ----------------------------

	public function test_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/cortext/v1/rows', $routes );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->query_rows( array( 'collection' => 1 ) );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_rejects_nonexistent_collection(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->query_rows( array( 'collection' => 999999 ) );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_rejects_non_collection_post(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Not a collection',
			)
		);

		$response = $this->query_rows( array( 'collection' => $field_id ) );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_rejects_collection_without_registered_cpt(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		// Create collection but don't register its entry CPT.
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Orphan',
				'meta_input'  => array( 'slug' => 'orphan' ),
			)
		);

		$response = $this->query_rows( array( 'collection' => $collection_id ) );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_rejects_field_not_on_collection(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'valid' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => 'field-999999',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertStringContainsString( 'field-999999', $response->get_data()['message'] );
	}

	public function test_rejects_filter_with_invalid_field(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'filt' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'filters'    => array(
					array(
						'field'    => 'field-888888',
						'operator' => 'is',
						'value'    => 'x',
					),
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertStringContainsString( 'field-888888', $response->get_data()['message'] );
	}

	public function test_accepts_title_sort_without_field_validation(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'titlesort' );

		// Title sort should not fail field validation.
		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => 'title',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
	}

	public function test_accepts_valid_field_in_sort(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture  = $this->create_collection_fixture( 'vsort' );
		$field_id = $fixture['field_id'];

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => "field-{$field_id}",
					'direction' => 'desc',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
	}

	public function test_response_shape(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'shape' );

		$response = $this->query_rows( array( 'collection' => $fixture['collection_id'] ) );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertArrayHasKey( 'rows', $data );
		$this->assertArrayHasKey( 'total', $data );
		$this->assertArrayHasKey( 'totalPages', $data );
		$this->assertArrayHasKey( 'fields', $data );
		$this->assertIsArray( $data['rows'] );
		$this->assertIsInt( $data['total'] );
		$this->assertIsInt( $data['totalPages'] );
		$this->assertIsArray( $data['fields'] );
	}

	public function test_field_definitions_in_response(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'fdefs', 'number' );

		$response = $this->query_rows( array( 'collection' => $fixture['collection_id'] ) );

		$data   = $response->get_data();
		$fields = $data['fields'];
		$this->assertCount( 1, $fields );
		$this->assertSame( $fixture['field_id'], $fields[0]['id'] );
		$this->assertSame( 'number', $fields[0]['type'] );
		$this->assertSame( 'Score', $fields[0]['label'] );
	}

	// -- Unit tests for format_row and build_query_args -----------------

	public function test_format_row_returns_expected_shape(): void {
		$fixture  = $this->create_collection_fixture( 'fmt', 'text' );
		$field_id = $fixture['field_id'];

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_fmt',
				'post_status' => 'publish',
				'post_title'  => 'My Entry',
			)
		);
		update_post_meta( $post_id, "field-{$field_id}", 'hello' );

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'format_row' );
		$method->setAccessible( true );

		$row = $method->invoke( $controller, get_post( $post_id ), array( $field_id ), array() );

		$this->assertSame( $post_id, $row['id'] );
		$this->assertSame( 'My Entry', $row['title']['raw'] );
		$this->assertSame( 'publish', $row['status'] );
		$this->assertSame( 'hello', $row['meta']["field-{$field_id}"] );
	}

	public function test_format_row_returns_array_for_multiselect(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Multi',
				'meta_input'  => array( 'slug' => 'multi' ),
			)
		);

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Tags',
				'meta_input'  => array( 'type' => 'multiselect' ),
			)
		);

		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_multi',
				'post_status' => 'publish',
				'post_title'  => 'Tagged',
			)
		);
		add_post_meta( $post_id, "field-{$field_id}", 'alpha' );
		add_post_meta( $post_id, "field-{$field_id}", 'beta' );

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'format_row' );
		$method->setAccessible( true );

		$row = $method->invoke( $controller, get_post( $post_id ), array( $field_id ), array( $field_id => true ) );

		$this->assertIsArray( $row['meta']["field-{$field_id}"] );
		$this->assertContains( 'alpha', $row['meta']["field-{$field_id}"] );
		$this->assertContains( 'beta', $row['meta']["field-{$field_id}"] );
	}

	public function test_build_query_args_basic(): void {
		$fixture = $this->create_collection_fixture( 'bqa' );

		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params(
			array(
				'collection' => $fixture['collection_id'],
				'per_page'   => 10,
				'page'       => 2,
			)
		);
		$request->set_default_params(
			array(
				'per_page' => 25,
				'page'     => 1,
				'search'   => '',
				'sort'     => null,
				'filters'  => array(),
			)
		);

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'build_query_args' );
		$method->setAccessible( true );

		$args = $method->invoke( $controller, $request, 'bqa' );

		$this->assertSame( 'crtxt_bqa', $args['post_type'] );
		$this->assertSame( 10, $args['posts_per_page'] );
		$this->assertSame( 2, $args['paged'] );
		$this->assertArrayNotHasKey( 's', $args );
	}

	public function test_build_query_args_with_search(): void {
		$fixture = $this->create_collection_fixture( 'bqas' );

		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params(
			array(
				'collection' => $fixture['collection_id'],
				'search'     => 'hello',
			)
		);
		$request->set_default_params(
			array(
				'per_page' => 25,
				'page'     => 1,
				'search'   => '',
				'sort'     => null,
				'filters'  => array(),
			)
		);

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'build_query_args' );
		$method->setAccessible( true );

		$args = $method->invoke( $controller, $request, 'bqas' );

		$this->assertSame( 'hello', $args['s'] );
	}

	public function test_build_query_args_with_title_sort(): void {
		$fixture = $this->create_collection_fixture( 'bqat' );

		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => 'title',
					'direction' => 'desc',
				),
			)
		);
		$request->set_default_params(
			array(
				'per_page' => 25,
				'page'     => 1,
				'search'   => '',
				'sort'     => null,
				'filters'  => array(),
			)
		);

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'build_query_args' );
		$method->setAccessible( true );

		$args = $method->invoke( $controller, $request, 'bqat' );

		$this->assertSame( 'title', $args['orderby'] );
		$this->assertSame( 'DESC', $args['order'] );
	}

	public function test_build_query_args_with_number_field_sort(): void {
		$fixture = $this->create_collection_fixture( 'bqan', 'number' );

		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => "field-{$fixture['field_id']}",
					'direction' => 'asc',
				),
			)
		);
		$request->set_default_params(
			array(
				'per_page' => 25,
				'page'     => 1,
				'search'   => '',
				'sort'     => null,
				'filters'  => array(),
			)
		);

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'build_query_args' );
		$method->setAccessible( true );

		$args = $method->invoke( $controller, $request, 'bqan' );

		$this->assertSame( "field-{$fixture['field_id']}", $args['meta_key'] );
		$this->assertSame( 'meta_value_num', $args['orderby'] );
		$this->assertSame( 'ASC', $args['order'] );
	}

	public function test_build_query_args_with_filters(): void {
		$fixture = $this->create_collection_fixture( 'bqaf', 'text' );

		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params(
			array(
				'collection' => $fixture['collection_id'],
				'filters'    => array(
					array(
						'field'    => "field-{$fixture['field_id']}",
						'operator' => 'is',
						'value'    => 'red',
					),
					array(
						'field'    => "field-{$fixture['field_id']}",
						'operator' => 'isAny',
						'value'    => array( 'blue', 'green' ),
					),
				),
			)
		);
		$request->set_default_params(
			array(
				'per_page' => 25,
				'page'     => 1,
				'search'   => '',
				'sort'     => null,
				'filters'  => array(),
			)
		);

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'build_query_args' );
		$method->setAccessible( true );

		$args = $method->invoke( $controller, $request, 'bqaf' );

		$this->assertArrayHasKey( 'meta_query', $args );
		$this->assertCount( 2, $args['meta_query'] );

		$this->assertSame( "field-{$fixture['field_id']}", $args['meta_query'][0]['key'] );
		$this->assertSame( '=', $args['meta_query'][0]['compare'] );
		$this->assertSame( 'red', $args['meta_query'][0]['value'] );

		$this->assertSame( 'IN', $args['meta_query'][1]['compare'] );
		$this->assertSame( array( 'blue', 'green' ), $args['meta_query'][1]['value'] );
	}

	// -- Helpers --------------------------------------------------------

	private function query_rows( array $params ): \WP_REST_Response {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params( $params );

		return rest_do_request( $request );
	}

	/**
	 * Creates a collection with one field and registers its entry CPT.
	 *
	 * @return array{collection_id: int, field_id: int}
	 */
	private function create_collection_fixture( string $slug, string $field_type = 'number' ): array {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => ucfirst( $slug ),
				'meta_input'  => array( 'slug' => $slug ),
			)
		);

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Score',
				'meta_input'  => array( 'type' => $field_type ),
			)
		);

		add_post_meta( $collection_id, 'fields', (string) $field_id );

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		return array(
			'collection_id' => $collection_id,
			'field_id'      => $field_id,
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
