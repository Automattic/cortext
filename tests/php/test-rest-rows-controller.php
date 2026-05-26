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
use Cortext\Relations;
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
		$this->assertArrayHasKey(
			'/cortext/v1/collections/(?P<collection_id>\d+)/rows',
			$routes
		);
		$this->assertArrayHasKey(
			'/cortext/v1/collections/(?P<collection_id>\d+)/rows/(?P<row_id>\d+)',
			$routes
		);
		$this->assertArrayHasKey(
			'/cortext/v1/collections/(?P<collection_id>\d+)/rows/(?P<row_id>\d+)/duplicate',
			$routes
		);
	}

	public function test_create_row_creates_formatted_collection_entry(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'newrelrow', 'text' );

		$response = $this->create_row( $fixture['collection_id'], 'New related page' );

		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'New related page', $data['title']['raw'] );
		$this->assertSame( 'private', get_post_status( $data['id'] ) );
		$this->assertSame( 'crtxt_newrelrow', get_post_type( $data['id'] ) );
		$this->assertArrayHasKey( "field-{$fixture['field_id']}", $data['meta'] );
	}

	public function test_create_row_applies_field_defaults(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection_with_slug( 'Defaults', 'defaults' );

		$text_id = $this->create_collection_field( $collection_id, 'Notes', 'text' );
		update_post_meta( $text_id, 'default_value', '{"mode":"value","value":"Draft"}' );

		$number_id = $this->create_collection_field( $collection_id, 'Score', 'number' );
		update_post_meta( $number_id, 'default_value', '{"mode":"value","value":12.5}' );

		$date_id = $this->create_collection_field( $collection_id, 'Due', 'date' );
		update_post_meta( $date_id, 'default_value', '{"mode":"today"}' );

		$datetime_id = $this->create_collection_field( $collection_id, 'Start', 'datetime' );
		update_post_meta( $datetime_id, 'default_value', '{"mode":"today"}' );

		$checkbox_id = $this->create_collection_field( $collection_id, 'Done', 'checkbox' );
		update_post_meta( $checkbox_id, 'default_value', '{"mode":"value","value":true}' );

		$select_id = $this->create_collection_field(
			$collection_id,
			'Status',
			'select',
			array(
				'options' => wp_json_encode(
					array(
						array(
							'value' => 'todo',
							'label' => 'To do',
						),
					)
				),
			)
		);
		update_post_meta( $select_id, 'default_value', '{"mode":"value","value":"todo"}' );

		$tags_id = $this->create_collection_field(
			$collection_id,
			'Tags',
			'multiselect',
			array(
				'options' => wp_json_encode(
					array(
						array(
							'value' => 'a',
							'label' => 'A',
						),
						array(
							'value' => 'b',
							'label' => 'B',
						),
					)
				),
			)
		);
		update_post_meta( $tags_id, 'default_value', '{"mode":"value","value":["a","b"]}' );

		$response = $this->create_row( $collection_id, 'With defaults' );
		$row_id   = (int) $response->get_data()['id'];

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'Draft', get_post_meta( $row_id, "field-{$text_id}", true ) );
		$this->assertEquals( 12.5, (float) get_post_meta( $row_id, "field-{$number_id}", true ) );
		$this->assertSame( wp_date( 'Y-m-d' ), get_post_meta( $row_id, "field-{$date_id}", true ) );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d{2}-\d{2}T/', (string) get_post_meta( $row_id, "field-{$datetime_id}", true ) );
		$this->assertTrue( Relations::is_truthy( get_post_meta( $row_id, "field-{$checkbox_id}", true ) ) );
		$this->assertSame( 'todo', get_post_meta( $row_id, "field-{$select_id}", true ) );
		$this->assertSame( array( 'a', 'b' ), get_post_meta( $row_id, "field-{$tags_id}", false ) );
	}

	public function test_setting_default_does_not_change_existing_rows(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection_with_slug( 'Existing Defaults', 'exdefs' );
		$field_id      = $this->create_collection_field( $collection_id, 'Notes', 'text' );
		$existing_id   = (int) wp_insert_post(
			array(
				'post_type'   => 'crtxt_exdefs',
				'post_status' => 'private',
				'post_title'  => 'Existing row',
			)
		);

		update_post_meta( $field_id, 'default_value', '{"mode":"value","value":"Draft"}' );
		$new_response = $this->create_row( $collection_id, 'New row' );
		$new_id       = (int) $new_response->get_data()['id'];

		$this->assertSame( array(), get_post_meta( $existing_id, "field-{$field_id}", false ) );
		$this->assertSame( 'Draft', get_post_meta( $new_id, "field-{$field_id}", true ) );
	}

	public function test_explicit_creation_meta_wins_over_field_default(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection_with_slug( 'Explicit Defaults', 'expdefs' );
		$field_id      = $this->create_collection_field( $collection_id, 'Notes', 'text' );
		update_post_meta( $field_id, 'default_value', '{"mode":"value","value":"Default"}' );

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RowsController() )->register();
		do_action( 'rest_api_init' );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_expdefs' );
		$request->set_body_params(
			array(
				'status' => 'private',
				'title'  => 'Explicit row',
				'meta'   => array(
					"field-{$field_id}" => 'Provided',
				),
			)
		);
		$response = rest_do_request( $request );
		$row_id   = (int) $response->get_data()['id'];

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'Provided', get_post_meta( $row_id, "field-{$field_id}", true ) );
	}

	public function test_explicit_empty_multiselect_meta_wins_over_field_default(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection_with_slug( 'Empty Multi Defaults', 'emptymultidefs' );
		$field_id      = $this->create_collection_field(
			$collection_id,
			'Tags',
			'multiselect',
			array(
				'options' => wp_json_encode(
					array(
						array(
							'value' => 'a',
							'label' => 'A',
						),
					)
				),
			)
		);
		update_post_meta( $field_id, 'default_value', '{"mode":"value","value":["a"]}' );

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RowsController() )->register();
		do_action( 'rest_api_init' );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_emptymultidefs' );
		$request->set_body_params(
			array(
				'status' => 'private',
				'title'  => 'Empty tags row',
				'meta'   => array(
					"field-{$field_id}" => array(),
				),
			)
		);
		$response = rest_do_request( $request );
		$this->assertSame( 201, $response->get_status() );

		$row_id = (int) $response->get_data()['id'];
		$this->assertSame( array(), get_post_meta( $row_id, "field-{$field_id}", false ) );
	}

	public function test_query_rows_includes_collection_metadata(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'rowmeta', 'text' );

		$response = $this->query_rows( array( 'collection' => $fixture['collection_id'] ) );

		$this->assertSame( 200, $response->get_status() );
		$collection = $response->get_data()['collection'];
		$this->assertSame( $fixture['collection_id'], $collection['id'] );
		$this->assertSame( 'Rowmeta', $collection['title']['raw'] );
		$this->assertSame( 'rowmeta', $collection['slug'] );
	}

	public function test_edit_context_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->query_rows( array( 'collection' => 1, 'context' => 'edit' ) );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_view_context_allows_anonymous_for_published_collection(): void {
		wp_set_current_user( 0 );

		$fixture = $this->create_collection_fixture( 'pub', 'text', 'publish' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'context'    => 'view',
			)
		);

		$this->assertSame( 200, $response->get_status() );
	}

	public function test_view_context_rejects_unpublished_collection(): void {
		wp_set_current_user( 0 );

		$fixture = $this->create_collection_fixture( 'priv' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'context'    => 'view',
			)
		);

		// rest_authorization_required_code() returns 401 for anonymous users.
		$this->assertSame( 401, $response->get_status() );
	}

	public function test_view_context_returns_404_for_nonexistent_collection(): void {
		wp_set_current_user( 0 );

		$response = $this->query_rows(
			array(
				'collection' => 999999,
				'context'    => 'view',
			)
		);

		$this->assertSame( 404, $response->get_status() );
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

	public function test_rejects_legacy_all_rows_per_page_sentinel(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'allrows' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'per_page'   => -1,
			)
		);

		$this->assertSame( 400, $response->get_status() );
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
		$this->assertSame( '', $fields[0]['description'] );
	}

	public function test_field_definitions_include_descriptions(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'fdesc', 'text' );
		update_post_meta( $fixture['field_id'], 'description', 'Use this for editor notes.' );

		$response = $this->query_rows( array( 'collection' => $fixture['collection_id'] ) );

		$data   = $response->get_data();
		$fields = $data['fields'];
		$this->assertCount( 1, $fields );
		$this->assertSame( 'Use this for editor notes.', $fields[0]['description'] );
	}

	public function test_field_definitions_include_options(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Opts',
				'meta_input'  => array( 'slug' => 'opts' ),
			)
		);

		$options_json = wp_json_encode( array(
			array( 'value' => 'a', 'label' => 'Alpha' ),
			array( 'value' => 'b', 'label' => 'Beta' ),
		) );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Status',
				'meta_input'  => array(
					'type'    => 'select',
					'options' => $options_json,
				),
			)
		);

		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		$response = $this->query_rows( array( 'collection' => $collection_id ) );

		$data   = $response->get_data();
		$fields = $data['fields'];
		$this->assertCount( 1, $fields );
		$this->assertSame( $options_json, $fields[0]['options'] );
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
		$this->assertSame( 'row', $row['kind'] );
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
		$this->assertSame(
			array(
				'menu_order' => 'ASC',
				'ID'         => 'ASC',
			),
			$args['orderby']
		);
		$this->assertArrayNotHasKey( 'order', $args );
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

		$this->assertArrayNotHasKey( 'meta_key', $args );
		$this->assertSame( 'none', $args['orderby'] );
		$this->assertSame( 'ASC', $args['order'] );
	}

	public function test_build_query_args_ignores_raw_filters(): void {
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

		$this->assertArrayNotHasKey( 'meta_query', $args );
	}

	public function test_query_rows_rejects_rollup_sort_and_filter(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'bqaroll', 'rollup' );

		$sort_response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => "field-{$fixture['field_id']}",
					'direction' => 'desc',
				),
			)
		);
		$filter_response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'filters'    => array(
					array(
						'field'    => "field-{$fixture['field_id']}",
						'operator' => 'is',
						'value'    => '2',
					),
				),
			)
		);

		$this->assertSame( 400, $sort_response->get_status() );
		$this->assertSame( 400, $filter_response->get_status() );
	}

	// -- include[] tests ------------------------------------------------

	public function test_sanitize_include_param_dedupes_drops_zero_and_normalizes(): void {
		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'sanitize_include_param' );

		$this->assertSame(
			array( 5, 10 ),
			$method->invoke( $controller, array( 0, 5, 5, 10, '10', '0' ) )
		);
		$this->assertSame( array(), $method->invoke( $controller, array() ) );
		$this->assertSame( array(), $method->invoke( $controller, array( 0, '0', 0 ) ) );
		$this->assertSame( array(), $method->invoke( $controller, 'not-an-array' ) );
	}

	public function test_validate_include_param_rejects_more_than_100_ids(): void {
		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'validate_include_param' );

		$this->assertTrue( $method->invoke( $controller, range( 1, 100 ) ) );

		$result = $method->invoke( $controller, range( 1, 101 ) );
		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 400, $result->get_error_data()['status'] );
	}

	public function test_build_query_args_sets_post_in_when_include_provided(): void {
		$fixture = $this->create_collection_fixture( 'bqainc', 'text' );

		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params(
			array(
				'collection' => $fixture['collection_id'],
				'include'    => array( 11, 22, 33 ),
			)
		);
		$request->set_default_params(
			array(
				'per_page' => 25,
				'page'     => 1,
				'search'   => '',
				'sort'     => null,
				'filters'  => array(),
				'include'  => array(),
			)
		);

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'build_query_args' );

		$args = $method->invoke( $controller, $request, 'bqainc' );

		$this->assertArrayHasKey( 'post__in', $args );
		$this->assertSame( array( 11, 22, 33 ), $args['post__in'] );
	}

	public function test_build_query_args_omits_post_in_when_include_absent(): void {
		$fixture = $this->create_collection_fixture( 'bqanoinc', 'text' );

		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params(
			array(
				'collection' => $fixture['collection_id'],
			)
		);
		$request->set_default_params(
			array(
				'per_page' => 25,
				'page'     => 1,
				'search'   => '',
				'sort'     => null,
				'filters'  => array(),
				'include'  => array(),
			)
		);

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'build_query_args' );

		$args = $method->invoke( $controller, $request, 'bqanoinc' );

		$this->assertArrayNotHasKey( 'post__in', $args );
	}

	public function test_query_rows_short_circuits_when_include_is_empty_after_sanitize(): void {
		// A caller that passes only zeros should get no rows, not page 1 of the
		// collection after the sanitizer strips the values.
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'inczero', 'text' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'include'    => array( 0, 0, '0' ),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( array(), $data['rows'] );
		$this->assertSame( 0, $data['total'] );
		$this->assertSame( 0, $data['totalPages'] );
		$this->assertArrayHasKey( 'collection', $data );
		$this->assertArrayHasKey( 'fields', $data );
	}

	public function test_query_rows_rejects_include_with_more_than_100_ids(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'inccap', 'text' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'include'    => range( 1, 101 ),
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_query_rows_edit_context_with_include_requires_edit_posts(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->query_rows(
			array(
				'collection' => 1,
				'include'    => array( 1, 2 ),
				'context'    => 'edit',
			)
		);

		$this->assertSame( 403, $response->get_status() );
	}

	// -- Relation and rollup tests --------------------------------------

	public function test_update_row_field_syncs_relation_from_source_and_reverse(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$tasks_id  = $this->create_collection_with_slug( 'Tasks', 'tasks-sync' );
		$people_id = $this->create_collection_with_slug( 'People', 'people-sync' );

		$relation = $this->create_relation_pair( $tasks_id, $people_id );
		$task_id  = $this->create_entry( 'crtxt_tasks-sync', 'Write tests' );
		$person_id = $this->create_entry( 'crtxt_people-sync', 'Ada Lovelace' );

		$response = $this->update_row_field(
			$tasks_id,
			$task_id,
			"field-{$relation['source_id']}",
			array( $person_id )
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( (string) $person_id ),
			get_post_meta( $task_id, "field-{$relation['source_id']}", false )
		);
		$this->assertSame(
			array( (string) $task_id ),
			get_post_meta( $person_id, "field-{$relation['reverse_id']}", false )
		);

		$data = $response->get_data();
		$ref  = $data['meta']["field-{$relation['source_id']}"][0];
		$this->assertSame( $person_id, $ref['id'] );
		$this->assertSame( get_post( $person_id )->post_name, $ref['slug'] );
		$this->assertSame( 'Ada Lovelace', $ref['title']['raw'] );
		$this->assertSame( $people_id, $ref['collectionId'] );
		$this->assertSame( 'people-sync', $ref['collectionSlug'] );

		$reverse_response = $this->update_row_field(
			$people_id,
			$person_id,
			"field-{$relation['reverse_id']}",
			array()
		);

		$this->assertSame( 200, $reverse_response->get_status() );
		$this->assertSame(
			array(),
			get_post_meta( $task_id, "field-{$relation['source_id']}", false )
		);
		$this->assertSame(
			array(),
			get_post_meta( $person_id, "field-{$relation['reverse_id']}", false )
		);
	}

	public function test_relation_sync_removes_conflicts_when_reverse_is_single(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$tasks_id  = $this->create_collection_with_slug( 'Tasks', 'tasks-card' );
		$people_id = $this->create_collection_with_slug( 'People', 'people-card' );

		$relation = $this->create_relation_pair( $tasks_id, $people_id, true, false );
		$first_id = $this->create_entry( 'crtxt_tasks-card', 'First' );
		$second_id = $this->create_entry( 'crtxt_tasks-card', 'Second' );
		$person_id = $this->create_entry( 'crtxt_people-card', 'Grace Hopper' );

		$this->update_row_field(
			$tasks_id,
			$first_id,
			"field-{$relation['source_id']}",
			array( $person_id )
		);
		$this->update_row_field(
			$tasks_id,
			$second_id,
			"field-{$relation['source_id']}",
			array( $person_id )
		);

		$this->assertSame(
			array(),
			get_post_meta( $first_id, "field-{$relation['source_id']}", false )
		);
		$this->assertSame(
			array( (string) $person_id ),
			get_post_meta( $second_id, "field-{$relation['source_id']}", false )
		);
		$this->assertSame(
			array( (string) $second_id ),
			get_post_meta( $person_id, "field-{$relation['reverse_id']}", false )
		);
	}

	public function test_relation_sync_handles_self_relations(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Tasks', 'tasks-self' );

		$relation = $this->create_relation_pair( $collection_id, $collection_id );
		$parent_id = $this->create_entry( 'crtxt_tasks-self', 'Parent' );
		$child_id  = $this->create_entry( 'crtxt_tasks-self', 'Child' );

		$response = $this->update_row_field(
			$collection_id,
			$parent_id,
			"field-{$relation['source_id']}",
			array( $child_id )
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( (string) $child_id ),
			get_post_meta( $parent_id, "field-{$relation['source_id']}", false )
		);
		$this->assertSame(
			array( (string) $parent_id ),
			get_post_meta( $child_id, "field-{$relation['reverse_id']}", false )
		);

		$data = $response->get_data();
		$this->assertSame(
			'tasks-self',
			$data['meta']["field-{$relation['source_id']}"][0]['collectionSlug']
		);
	}

	public function test_rollups_compute_from_related_rows_and_update_on_read(): void {
		$projects_id = $this->create_collection_with_slug( 'Projects', 'projects-calc' );
		$invoices_id = $this->create_collection_with_slug( 'Invoices', 'invoices-calc' );

		$relation = $this->create_relation_pair( $projects_id, $invoices_id );
		$amount_id = $this->create_collection_field( $invoices_id, 'Amount', 'number' );
		$date_id = $this->create_collection_field( $invoices_id, 'Due', 'date' );
		$status_id = $this->create_collection_field(
			$invoices_id,
			'Status',
			'select',
			array(
				'options' => wp_json_encode(
					array(
						array(
							'value' => 'paid',
							'label' => 'Paid',
						),
					)
				),
			)
		);
		$count_id = $this->create_rollup_field( $projects_id, 'Invoice count', $relation['source_id'], 0, 'count' );
		$sum_id = $this->create_rollup_field( $projects_id, 'Total', $relation['source_id'], $amount_id, 'sum' );
		$avg_id = $this->create_rollup_field( $projects_id, 'Average', $relation['source_id'], $amount_id, 'avg' );
		$median_id = $this->create_rollup_field( $projects_id, 'Median', $relation['source_id'], $amount_id, 'median' );
		$min_id = $this->create_rollup_field( $projects_id, 'Minimum', $relation['source_id'], $amount_id, 'min' );
		$max_id = $this->create_rollup_field( $projects_id, 'Maximum', $relation['source_id'], $amount_id, 'max' );
		$range_id = $this->create_rollup_field( $projects_id, 'Range', $relation['source_id'], $amount_id, 'range' );
		$earliest_id = $this->create_rollup_field( $projects_id, 'Earliest due', $relation['source_id'], $date_id, 'earliest' );
		$latest_id = $this->create_rollup_field( $projects_id, 'Latest due', $relation['source_id'], $date_id, 'latest' );
		$date_range_id = $this->create_rollup_field( $projects_id, 'Due range', $relation['source_id'], $date_id, 'date_range' );
		$original_status_id = $this->create_rollup_field( $projects_id, 'Statuses', $relation['source_id'], $status_id, 'show_original' );
		$unique_status_id = $this->create_rollup_field( $projects_id, 'Unique statuses', $relation['source_id'], $status_id, 'show_unique' );
		$count_values_id = $this->create_rollup_field( $projects_id, 'Status values', $relation['source_id'], $status_id, 'count_values' );
		$count_unique_id = $this->create_rollup_field( $projects_id, 'Unique status count', $relation['source_id'], $status_id, 'count_unique' );
		$empty_id = $this->create_rollup_field( $projects_id, 'Empty statuses', $relation['source_id'], $status_id, 'empty' );
		$not_empty_id = $this->create_rollup_field( $projects_id, 'Filled statuses', $relation['source_id'], $status_id, 'not_empty' );
		$percent_empty_id = $this->create_rollup_field( $projects_id, 'Empty percent', $relation['source_id'], $status_id, 'percent_empty' );

		$project_id = $this->create_entry( 'crtxt_projects-calc', 'Liberation' );
		$invoice_a = $this->create_entry( 'crtxt_invoices-calc', 'Invoice A' );
		$invoice_b = $this->create_entry( 'crtxt_invoices-calc', 'Invoice B' );
		$invoice_c = $this->create_entry( 'crtxt_invoices-calc', 'Invoice C' );
		update_post_meta( $invoice_a, "field-{$amount_id}", '10' );
		update_post_meta( $invoice_a, "field-{$date_id}", '2026-05-01' );
		update_post_meta( $invoice_a, "field-{$status_id}", 'paid' );
		update_post_meta( $invoice_b, "field-{$amount_id}", '5' );
		update_post_meta( $invoice_b, "field-{$date_id}", '2026-05-03' );
		update_post_meta( $invoice_b, "field-{$status_id}", 'paid' );

		Relations::sync_relation_value( $project_id, $relation['source_id'], array( $invoice_a, $invoice_b, $invoice_c ) );

		$field_ids = array(
			$relation['source_id'],
			$count_id,
			$sum_id,
			$avg_id,
			$median_id,
			$min_id,
			$max_id,
			$range_id,
			$earliest_id,
			$latest_id,
			$date_range_id,
			$original_status_id,
			$unique_status_id,
			$count_values_id,
			$count_unique_id,
			$empty_id,
			$not_empty_id,
			$percent_empty_id,
		);
		$row       = $this->invoke_format_row_with_fields( $project_id, $field_ids );

		$this->assertSame( 3, $row['meta']["field-{$count_id}"] );
		$this->assertSame( 15.0, $row['meta']["field-{$sum_id}"] );
		$this->assertSame( 7.5, $row['meta']["field-{$avg_id}"] );
		$this->assertSame( 7.5, $row['meta']["field-{$median_id}"] );
		$this->assertSame( 5.0, $row['meta']["field-{$min_id}"] );
		$this->assertSame( 10.0, $row['meta']["field-{$max_id}"] );
		$this->assertSame( 5.0, $row['meta']["field-{$range_id}"] );
		$this->assertSame( '2026-05-01', $row['meta']["field-{$earliest_id}"] );
		$this->assertSame( '2026-05-03', $row['meta']["field-{$latest_id}"] );
		$this->assertSame(
			array(
				'start' => '2026-05-01',
				'end'   => '2026-05-03',
			),
			$row['meta']["field-{$date_range_id}"]
		);
		$this->assertSame( array( 'paid', 'paid' ), $row['meta']["field-{$original_status_id}"] );
		$this->assertSame( array( 'paid' ), $row['meta']["field-{$unique_status_id}"] );
		$this->assertSame( 2, $row['meta']["field-{$count_values_id}"] );
		$this->assertSame( 1, $row['meta']["field-{$count_unique_id}"] );
		$this->assertSame( 1, $row['meta']["field-{$empty_id}"] );
		$this->assertSame( 2, $row['meta']["field-{$not_empty_id}"] );
		$this->assertEqualsWithDelta( 1 / 3, $row['meta']["field-{$percent_empty_id}"], 0.000001 );
		$this->assertSame( 'Invoice A', $row['meta']["field-{$relation['source_id']}"][0]['title']['raw'] );

		update_post_meta( $invoice_b, "field-{$amount_id}", '20' );
		update_post_meta( $invoice_a, "field-{$date_id}", '2026-05-04' );

		$updated = $this->invoke_format_row_with_fields( $project_id, $field_ids );

		$this->assertSame( 30.0, $updated['meta']["field-{$sum_id}"] );
		$this->assertSame( '2026-05-04', $updated['meta']["field-{$latest_id}"] );
	}

	public function test_trashed_relation_targets_are_hidden_without_clearing_meta(): void {
		$projects_id = $this->create_collection_with_slug( 'Projects', 'projtr' );
		$invoices_id = $this->create_collection_with_slug( 'Invoices', 'invtr' );

		$relation = $this->create_relation_pair( $projects_id, $invoices_id );
		$amount_id = $this->create_collection_field( $invoices_id, 'Amount', 'number' );
		$count_id = $this->create_rollup_field( $projects_id, 'Invoice count', $relation['source_id'], 0, 'count' );
		$sum_id = $this->create_rollup_field( $projects_id, 'Total', $relation['source_id'], $amount_id, 'sum' );

		$project_id = $this->create_entry( 'crtxt_projtr', 'Project' );
		$kept_id = $this->create_entry( 'crtxt_invtr', 'Kept invoice' );
		$trashed_id = $this->create_entry( 'crtxt_invtr', 'Trashed invoice' );
		update_post_meta( $kept_id, "field-{$amount_id}", '10' );
		update_post_meta( $trashed_id, "field-{$amount_id}", '20' );
		Relations::sync_relation_value( $project_id, $relation['source_id'], array( $kept_id, $trashed_id ) );

		wp_trash_post( $trashed_id );

		$row = $this->invoke_format_row_with_fields(
			$project_id,
			array( $relation['source_id'], $count_id, $sum_id )
		);

		$this->assertSame( array( (string) $kept_id, (string) $trashed_id ), get_post_meta( $project_id, "field-{$relation['source_id']}", false ) );
		$this->assertSame( array( (string) $project_id ), get_post_meta( $trashed_id, "field-{$relation['reverse_id']}", false ) );
		$this->assertCount( 1, $row['meta']["field-{$relation['source_id']}"] );
		$this->assertSame( $kept_id, $row['meta']["field-{$relation['source_id']}"][0]['id'] );
		$this->assertSame( 1, $row['meta']["field-{$count_id}"] );
		$this->assertSame( 10.0, $row['meta']["field-{$sum_id}"] );

		wp_untrash_post( $trashed_id );

		$restored = $this->invoke_format_row_with_fields(
			$project_id,
			array( $relation['source_id'], $count_id, $sum_id )
		);

		$this->assertCount( 2, $restored['meta']["field-{$relation['source_id']}"] );
		$this->assertSame( 2, $restored['meta']["field-{$count_id}"] );
		$this->assertSame( 30.0, $restored['meta']["field-{$sum_id}"] );
	}

	public function test_format_row_with_context_matches_fallback_for_relations_and_rollups(): void {
		$projects_id = $this->create_collection_with_slug( 'Projects', 'projectseq' );
		$invoices_id = $this->create_collection_with_slug( 'Invoices', 'invoiceseq' );

		$relation  = $this->create_relation_pair( $projects_id, $invoices_id );
		$amount_id = $this->create_collection_field( $invoices_id, 'Amount', 'number' );
		$count_id  = $this->create_rollup_field( $projects_id, 'Invoice count', $relation['source_id'], 0, 'count' );
		$sum_id    = $this->create_rollup_field( $projects_id, 'Total', $relation['source_id'], $amount_id, 'sum' );

		$project_id = $this->create_entry( 'crtxt_projectseq', 'Liberation' );
		$invoice_a  = $this->create_entry( 'crtxt_invoiceseq', 'Invoice A' );
		$invoice_b  = $this->create_entry( 'crtxt_invoiceseq', 'Invoice B' );
		update_post_meta( $invoice_a, "field-{$amount_id}", '10' );
		update_post_meta( $invoice_b, "field-{$amount_id}", '5' );
		Relations::sync_relation_value( $project_id, $relation['source_id'], array( $invoice_a, $invoice_b ) );

		$field_ids = array( $relation['source_id'], $count_id, $sum_id );

		// Fallback path used by single-row responses.
		$fallback_row = $this->invoke_format_row_with_fields( $project_id, $field_ids );

		// Context path used by `/rows`.
		$controller = new RowsController();
		$ctx = new \Cortext\Rest\RowFormatContext();
		$types_map = new \ReflectionMethod( $controller, 'field_types_map' );
		$types_map->setAccessible( true );
		$ctx->field_types = $types_map->invoke( $controller, $field_ids );

		$multi_from = new \ReflectionMethod( $controller, 'multi_value_field_ids_from' );
		$multi_from->setAccessible( true );
		$multi_field_ids = $multi_from->invoke( $controller, $ctx->field_types );

		$format = new \ReflectionMethod( $controller, 'format_row' );
		$format->setAccessible( true );
		$cached_row = $format->invoke(
			$controller,
			get_post( $project_id ),
			$field_ids,
			$multi_field_ids,
			$ctx
		);

		$this->assertSame( 2, $cached_row['meta']["field-{$count_id}"] );
		$this->assertSame( 15.0, $cached_row['meta']["field-{$sum_id}"] );
		$this->assertSame( $fallback_row['meta'], $cached_row['meta'] );
		$this->assertSame( $fallback_row['title'], $cached_row['title'] );

		// Reuse the context once to catch accidental mutation during formatting.
		$cached_again = $format->invoke(
			$controller,
			get_post( $project_id ),
			$field_ids,
			$multi_field_ids,
			$ctx
		);
		$this->assertSame( $cached_row['meta'], $cached_again['meta'] );
	}

	// -- System field tests ---------------------------------------------

	public function test_format_row_includes_system_fields(): void {
		$author_id = $this->create_user( 'author' );
		$fixture   = $this->create_collection_fixture( 'sysfmt' );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_sysfmt',
				'post_status' => 'publish',
				'post_title'  => 'Entry',
				'post_author' => $author_id,
			)
		);

		$row = $this->invoke_format_row( $post_id, $fixture['field_id'] );

		$this->assertArrayHasKey( 'created_at', $row );
		$this->assertArrayHasKey( 'modified_at', $row );
		$this->assertArrayHasKey( 'created_by', $row );
		$this->assertArrayHasKey( 'modified_by', $row );
	}

	public function test_format_row_dates_are_rfc3339(): void {
		$fixture = $this->create_collection_fixture( 'sysdates' );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_sysdates',
				'post_status' => 'publish',
				'post_title'  => 'Dated',
			)
		);

		$row = $this->invoke_format_row( $post_id, $fixture['field_id'] );

		// RFC3339 with offset: YYYY-MM-DDTHH:MM:SS+00:00 (or with timezone offset).
		$this->assertMatchesRegularExpression(
			'/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/',
			$row['created_at']
		);
		$this->assertMatchesRegularExpression(
			'/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/',
			$row['modified_at']
		);
	}

	public function test_format_row_resolves_author_display_name(): void {
		$author_id = wp_insert_user(
			array(
				'user_login'   => 'sys_author',
				'user_pass'    => 'password',
				'display_name' => 'Ada Lovelace',
				'role'         => 'author',
			)
		);
		$fixture   = $this->create_collection_fixture( 'sysauthor' );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_sysauthor',
				'post_status' => 'publish',
				'post_title'  => 'Entry',
				'post_author' => $author_id,
			)
		);

		$row = $this->invoke_format_row( $post_id, $fixture['field_id'] );

		$this->assertSame( 'Ada Lovelace', $row['created_by'] );
	}

	public function test_format_row_modified_by_falls_back_to_created_by(): void {
		$author_id = wp_insert_user(
			array(
				'user_login'   => 'sys_fallback',
				'user_pass'    => 'password',
				'display_name' => 'Author Only',
				'role'         => 'author',
			)
		);
		$fixture   = $this->create_collection_fixture( 'sysfallback' );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_sysfallback',
				'post_status' => 'publish',
				'post_title'  => 'No edit history',
				'post_author' => $author_id,
			)
		);
		// Note: no _modified_by meta is set.

		$row = $this->invoke_format_row( $post_id, $fixture['field_id'] );

		$this->assertSame( 'Author Only', $row['created_by'] );
		$this->assertSame( 'Author Only', $row['modified_by'] );
	}

	public function test_format_row_resolves_distinct_modified_by(): void {
		$author_id = wp_insert_user(
			array(
				'user_login'   => 'sys_creator',
				'user_pass'    => 'password',
				'display_name' => 'Creator',
				'role'         => 'author',
			)
		);
		$editor_id = wp_insert_user(
			array(
				'user_login'   => 'sys_editor',
				'user_pass'    => 'password',
				'display_name' => 'Editor',
				'role'         => 'editor',
			)
		);
		$fixture   = $this->create_collection_fixture( 'sysdistinct' );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_sysdistinct',
				'post_status' => 'publish',
				'post_title'  => 'Edited',
				'post_author' => $author_id,
			)
		);
		update_post_meta( $post_id, '_modified_by', $editor_id );

		$row = $this->invoke_format_row( $post_id, $fixture['field_id'] );

		$this->assertSame( 'Creator', $row['created_by'] );
		$this->assertSame( 'Editor', $row['modified_by'] );
	}

	// Multi-author flow through the REST endpoint isn't testable in
	// WorDBless: `wp_insert_post` works via the object cache but
	// `WP_Query` SQL returns zero results (tech-debt.md#9). The
	// `test_format_row_resolves_distinct_modified_by` test above
	// already covers display-name resolution for distinct users at the
	// `format_row` layer; the full REST flow is exercised in e2e.

	public function test_sort_accepts_created_at(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'syssortc' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => 'created_at',
					'direction' => 'desc',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
	}

	public function test_sort_accepts_modified_at(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'syssortm' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => 'modified_at',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
	}

	public function test_sort_rejects_created_by(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'sysrjcb' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => 'created_by',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_sort_rejects_modified_by(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'sysrjmb' );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'sort'       => array(
					'field'     => 'modified_by',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_filter_rejects_all_system_fields(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$fixture = $this->create_collection_fixture( 'sysfilt' );

		foreach ( array( 'created_at', 'modified_at', 'created_by', 'modified_by' ) as $key ) {
			$response = $this->query_rows(
				array(
					'collection' => $fixture['collection_id'],
					'filters'    => array(
						array(
							'field'    => $key,
							'operator' => 'is',
							'value'    => 'whatever',
						),
					),
				)
			);

			$this->assertSame( 400, $response->get_status(), "Filter on {$key} must return 400." );
		}
	}

	public function test_fields_param_is_registered_on_rows_route(): void {
		$routes = rest_get_server()->get_routes();
		$args   = $routes['/cortext/v1/rows'][0]['args'];

		$this->assertArrayHasKey( 'fields', $args );
		$this->assertSame( 'array', $args['fields']['type'] );
		$this->assertNull( $args['fields']['default'] );
	}

	// tech-debt.md#9: WorDBless cannot run the full rows query, so these
	// projection checks stay at the route/schema and formatter layers.
	public function test_filter_requested_field_ids_keeps_collection_field_keys(): void {
		$result = $this->invoke_filter_requested_field_ids(
			array( 'field-11', 'field-33', 'title', 'created_at', 'field-99', 'garbage', '', 42, null ),
			array( 11, 22, 33 )
		);

		$this->assertSame( array( 11, 33 ), $result );
	}

	public function test_filter_requested_field_ids_returns_empty_for_unknown_keys(): void {
		$result = $this->invoke_filter_requested_field_ids(
			array( 'field-99', 'garbage', 'title' ),
			array( 11, 22 )
		);

		$this->assertSame( array(), $result );
	}

	public function test_filter_requested_field_ids_deduplicates_repeated_keys(): void {
		$result = $this->invoke_filter_requested_field_ids(
			array( 'field-11', 'field-22', 'field-11' ),
			array( 11, 22 )
		);

		$this->assertSame( array( 11, 22 ), $result );
	}

	public function test_format_row_omits_fields_outside_projection(): void {
		$collection_id = $this->create_collection_with_slug( 'Subset', 'subset' );
		$field_a       = $this->create_collection_field( $collection_id, 'A', 'text' );
		$field_b       = $this->create_collection_field( $collection_id, 'B', 'number' );

		$row_id = $this->create_entry( 'crtxt_subset', 'Row' );
		update_post_meta( $row_id, "field-{$field_a}", 'hello' );
		update_post_meta( $row_id, "field-{$field_b}", '42' );

		// No projection: both fields are present.
		$full = $this->invoke_format_row_with_fields( $row_id, array( $field_a, $field_b ) );
		$this->assertArrayHasKey( "field-{$field_a}", $full['meta'] );
		$this->assertArrayHasKey( "field-{$field_b}", $full['meta'] );

		// Projected rows include the requested meta and still keep system fields.
		$subset = $this->invoke_format_row_with_fields( $row_id, array( $field_b ) );
		$this->assertArrayNotHasKey( "field-{$field_a}", $subset['meta'] );
		$this->assertArrayHasKey( "field-{$field_b}", $subset['meta'] );
		$this->assertArrayHasKey( 'cortext_document_icon', $subset['meta'] );
		$this->assertArrayHasKey( 'title', $subset );
		$this->assertArrayHasKey( 'created_at', $subset );
		$this->assertArrayHasKey( 'modified_at', $subset );
		$this->assertArrayHasKey( 'created_by', $subset );
		$this->assertArrayHasKey( 'modified_by', $subset );
	}

	public function test_rollup_projection_does_not_include_source_fields(): void {
		$projects_id = $this->create_collection_with_slug( 'Projects', 'proj-fp' );
		$invoices_id = $this->create_collection_with_slug( 'Invoices', 'inv-fp' );

		$relation  = $this->create_relation_pair( $projects_id, $invoices_id );
		$amount_id = $this->create_collection_field( $invoices_id, 'Amount', 'number' );
		$sum_id    = $this->create_rollup_field( $projects_id, 'Total', $relation['source_id'], $amount_id, 'sum' );

		$project_id = $this->create_entry( 'crtxt_proj-fp', 'Project' );
		$invoice_a  = $this->create_entry( 'crtxt_inv-fp', 'A' );
		$invoice_b  = $this->create_entry( 'crtxt_inv-fp', 'B' );
		update_post_meta( $invoice_a, "field-{$amount_id}", '10' );
		update_post_meta( $invoice_b, "field-{$amount_id}", '5' );
		Relations::sync_relation_value( $project_id, $relation['source_id'], array( $invoice_a, $invoice_b ) );

		$row = $this->invoke_format_row_with_fields( $project_id, array( $sum_id ) );

		$this->assertSame( 15.0, $row['meta']["field-{$sum_id}"] );
		$this->assertArrayNotHasKey( "field-{$relation['source_id']}", $row['meta'] );
		$this->assertArrayNotHasKey( "field-{$amount_id}", $row['meta'] );
	}

	public function test_build_query_args_with_created_at_sort(): void {
		$fixture = $this->create_collection_fixture( 'bqact' );

		$args = $this->invoke_build_query_args(
			$fixture['collection_id'],
			'bqact',
			array(
				'field'     => 'created_at',
				'direction' => 'desc',
			)
		);

		$this->assertSame( 'date', $args['orderby'] );
		$this->assertSame( 'DESC', $args['order'] );
	}

	public function test_build_query_args_with_modified_at_sort(): void {
		$fixture = $this->create_collection_fixture( 'bqamod' );

		$args = $this->invoke_build_query_args(
			$fixture['collection_id'],
			'bqamod',
			array(
				'field'     => 'modified_at',
				'direction' => 'asc',
			)
		);

		$this->assertSame( 'modified', $args['orderby'] );
		$this->assertSame( 'ASC', $args['order'] );
	}

	// -- Duplicate tests ------------------------------------------------

	public function test_duplicate_row_creates_copy_with_prefixed_title(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$fixture = $this->create_collection_fixture( 'dup', 'text' );
		$source_id = $this->create_entry( 'crtxt_dup', 'My Row' );
		update_post_meta( $source_id, "field-{$fixture['field_id']}", 'hello' );

		$response = $this->duplicate_row( $fixture['collection_id'], $source_id );

		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();
		$this->assertNotSame( $source_id, $data['id'] );
		$this->assertSame( 'Copy of My Row', $data['title']['raw'] );
		$this->assertSame( 'crtxt_dup', get_post_type( $data['id'] ) );
		$this->assertSame( 'hello', $data['meta']["field-{$fixture['field_id']}"] );

		// Source row stays untouched.
		$this->assertSame( 'My Row', get_post( $source_id )->post_title );
		$this->assertSame( 'hello', get_post_meta( $source_id, "field-{$fixture['field_id']}", true ) );
	}

	public function test_duplicate_row_copies_content_and_status(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$fixture = $this->create_collection_fixture( 'dupc', 'text' );

		$source_id = (int) wp_insert_post(
			array(
				'post_type'    => 'crtxt_dupc',
				'post_status'  => 'private',
				'post_title'   => 'Original',
				'post_content' => '<p>Body text.</p>',
				'post_excerpt' => 'short summary',
			)
		);

		$response = $this->duplicate_row( $fixture['collection_id'], $source_id );

		$this->assertSame( 201, $response->get_status() );
		$copy = get_post( $response->get_data()['id'] );
		$this->assertSame( '<p>Body text.</p>', $copy->post_content );
		$this->assertSame( 'short summary', $copy->post_excerpt );
		$this->assertSame( 'private', $copy->post_status );
	}

	public function test_duplicate_row_copies_multiselect_values(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Tagged', 'dupms' );
		$field_id      = $this->create_collection_field( $collection_id, 'Tags', 'multiselect' );
		$source_id     = $this->create_entry( 'crtxt_dupms', 'Tagged row' );
		add_post_meta( $source_id, "field-{$field_id}", 'alpha' );
		add_post_meta( $source_id, "field-{$field_id}", 'beta' );

		$response = $this->duplicate_row( $collection_id, $source_id );

		$this->assertSame( 201, $response->get_status() );
		$new_id = $response->get_data()['id'];
		$values = get_post_meta( $new_id, "field-{$field_id}", false );
		$this->assertContains( 'alpha', $values );
		$this->assertContains( 'beta', $values );
		$this->assertCount( 2, $values );
	}

	public function test_duplicate_row_skips_rollups(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$projects_id = $this->create_collection_with_slug( 'Projects', 'dup-proj' );
		$invoices_id = $this->create_collection_with_slug( 'Invoices', 'dup-inv' );
		$relation    = $this->create_relation_pair( $projects_id, $invoices_id );
		$count_id    = $this->create_rollup_field( $projects_id, 'Count', $relation['source_id'], 0, 'count' );

		$project_id = $this->create_entry( 'crtxt_dup-proj', 'Project A' );
		$invoice_id = $this->create_entry( 'crtxt_dup-inv', 'Invoice 1' );
		\Cortext\Relations::sync_relation_value(
			$project_id,
			$relation['source_id'],
			array( $invoice_id )
		);

		$response = $this->duplicate_row( $projects_id, $project_id );

		$this->assertSame( 201, $response->get_status() );
		$new_id = $response->get_data()['id'];
		// Rollup values are computed on read; no stored meta to copy.
		$this->assertSame( '', get_post_meta( $new_id, "field-{$count_id}", true ) );
	}

	public function test_duplicate_row_copies_relation_when_reverse_is_multiple(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$tasks_id  = $this->create_collection_with_slug( 'Tasks', 'dup-task' );
		$people_id = $this->create_collection_with_slug( 'People', 'dup-people' );
		$relation  = $this->create_relation_pair( $tasks_id, $people_id, true, true );

		$task_id   = $this->create_entry( 'crtxt_dup-task', 'Original task' );
		$person_id = $this->create_entry( 'crtxt_dup-people', 'Ada' );
		\Cortext\Relations::sync_relation_value(
			$task_id,
			$relation['source_id'],
			array( $person_id )
		);

		$response = $this->duplicate_row( $tasks_id, $task_id );

		$this->assertSame( 201, $response->get_status() );
		$new_id = $response->get_data()['id'];

		// New row points at the same person.
		$this->assertSame(
			array( (string) $person_id ),
			get_post_meta( $new_id, "field-{$relation['source_id']}", false )
		);
		// Source row still points at the person; reverse list contains both.
		$this->assertSame(
			array( (string) $person_id ),
			get_post_meta( $task_id, "field-{$relation['source_id']}", false )
		);
		$reverse_values = get_post_meta( $person_id, "field-{$relation['reverse_id']}", false );
		$this->assertContains( (string) $task_id, $reverse_values );
		$this->assertContains( (string) $new_id, $reverse_values );
	}

	public function test_duplicate_row_skips_relation_when_reverse_is_single(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$tasks_id  = $this->create_collection_with_slug( 'Tasks', 'dup-tsng' );
		$people_id = $this->create_collection_with_slug( 'People', 'dup-psng' );
		// Reverse is single-valued: each person can be tied to only one task.
		$relation = $this->create_relation_pair( $tasks_id, $people_id, true, false );

		$task_id   = $this->create_entry( 'crtxt_dup-tsng', 'Original task' );
		$person_id = $this->create_entry( 'crtxt_dup-psng', 'Ada' );
		\Cortext\Relations::sync_relation_value(
			$task_id,
			$relation['source_id'],
			array( $person_id )
		);

		$response = $this->duplicate_row( $tasks_id, $task_id );

		$this->assertSame( 201, $response->get_status() );
		$new_id = $response->get_data()['id'];

		// Source row keeps its relation; new row has no relation.
		$this->assertSame(
			array( (string) $person_id ),
			get_post_meta( $task_id, "field-{$relation['source_id']}", false )
		);
		$this->assertSame(
			array(),
			get_post_meta( $new_id, "field-{$relation['source_id']}", false )
		);
		$this->assertSame(
			array( (string) $task_id ),
			get_post_meta( $person_id, "field-{$relation['reverse_id']}", false )
		);
	}

	public function test_duplicate_row_copies_document_icon(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$fixture   = $this->create_collection_fixture( 'dupic', 'text' );
		$source_id = $this->create_entry( 'crtxt_dupic', 'Iconified' );
		$icon      = wp_json_encode( array( 'type' => 'wp', 'name' => 'home' ) );
		update_post_meta( $source_id, 'cortext_document_icon', $icon );

		$response = $this->duplicate_row( $fixture['collection_id'], $source_id );

		$this->assertSame( 201, $response->get_status() );
		$new_id = $response->get_data()['id'];
		$this->assertSame( $icon, get_post_meta( $new_id, 'cortext_document_icon', true ) );
	}

	public function test_duplicate_row_returns_404_for_unknown_row(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$fixture = $this->create_collection_fixture( 'dupnf' );

		$response = $this->duplicate_row( $fixture['collection_id'], 999999 );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_duplicate_row_requires_edit_caps(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );
		$fixture   = $this->create_collection_fixture( 'dupperm' );
		$source_id = $this->create_entry( 'crtxt_dupperm', 'Original' );

		$response = $this->duplicate_row( $fixture['collection_id'], $source_id );

		$this->assertSame( 403, $response->get_status() );
	}

	// -- Helpers --------------------------------------------------------

	private function invoke_format_row( int $post_id, int $field_id ): array {
		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'format_row' );
		$method->setAccessible( true );

		return $method->invoke( $controller, get_post( $post_id ), array( $field_id ), array() );
	}

	/**
	 * @param int[] $field_ids Field IDs to include in the formatted row.
	 */
	private function invoke_format_row_with_fields( int $post_id, array $field_ids ): array {
		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'format_row' );
		$method->setAccessible( true );

		return $method->invoke(
			$controller,
			get_post( $post_id ),
			$field_ids,
			array()
		);
	}

	/**
	 * @param int[] $field_ids
	 * @return int[]
	 */
	private function invoke_filter_requested_field_ids( array $requested, array $field_ids ): array {
		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'filter_requested_field_ids' );
		$method->setAccessible( true );

		return $method->invoke( $controller, $requested, $field_ids );
	}

	private function invoke_build_query_args( int $collection_id, string $slug, array $sort ): array {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params(
			array(
				'collection' => $collection_id,
				'sort'       => $sort,
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

		return $method->invoke( $controller, $request, $slug );
	}

	private function query_rows( array $params ): \WP_REST_Response {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		// Default to edit context so existing tests keep hitting the
		// authenticated path. Tests for public access pass context=view.
		$request->set_query_params( array_merge( array( 'context' => 'edit' ), $params ) );

		return rest_do_request( $request );
	}

	private function create_row( int $collection_id, string $title ): \WP_REST_Response {
		$request = new WP_REST_Request(
			'POST',
			"/cortext/v1/collections/{$collection_id}/rows"
		);
		$request->set_param( 'collection_id', $collection_id );
		$request->set_param( 'title', $title );

		return rest_do_request( $request );
	}

	private function update_row_field( int $collection_id, int $row_id, string $field, mixed $value ): \WP_REST_Response {
		$request = new WP_REST_Request(
			'POST',
			"/cortext/v1/collections/{$collection_id}/rows/{$row_id}"
		);
		$request->set_param( 'collection_id', $collection_id );
		$request->set_param( 'row_id', $row_id );
		$request->set_param( 'field', $field );
		$request->set_param( 'value', $value );

		return rest_do_request( $request );
	}

	private function duplicate_row( int $collection_id, int $row_id ): \WP_REST_Response {
		$request = new WP_REST_Request(
			'POST',
			"/cortext/v1/collections/{$collection_id}/rows/{$row_id}/duplicate"
		);
		$request->set_param( 'collection_id', $collection_id );
		$request->set_param( 'row_id', $row_id );

		return rest_do_request( $request );
	}

	private function create_collection_with_slug( string $title, string $slug ): int {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'slug' => $slug ),
			)
		);

		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		return $collection_id;
	}

	private function create_collection_field( int $collection_id, string $title, string $type, array $meta = array() ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array_merge( array( 'type' => $type ), $meta ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		return $field_id;
	}

	/**
	 * @return array{source_id:int,reverse_id:int}
	 */
	private function create_relation_pair(
		int $source_collection_id,
		int $target_collection_id,
		bool $source_multiple = true,
		bool $reverse_multiple = true
	): array {
		$source_id = $this->create_collection_field(
			$source_collection_id,
			'Relation',
			'relation',
			array(
				'related_collection_id' => (string) $target_collection_id,
				'relation_multiple'     => $source_multiple ? '1' : '0',
			)
		);
		$reverse_id = $this->create_collection_field(
			$target_collection_id,
			'Reverse relation',
			'relation',
			array(
				'related_collection_id' => (string) $source_collection_id,
				'relation_multiple'     => $reverse_multiple ? '1' : '0',
			)
		);
		update_post_meta( $source_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $source_id );

		return array(
			'source_id'  => $source_id,
			'reverse_id' => $reverse_id,
		);
	}

	private function create_rollup_field(
		int $collection_id,
		string $title,
		int $relation_field_id,
		int $target_field_id,
		string $aggregator
	): int {
		$meta = array(
			'rollup_relation_field_id' => (string) $relation_field_id,
			'rollup_aggregator'        => $aggregator,
		);
		if ( $target_field_id > 0 ) {
			$meta['rollup_target_field_id'] = (string) $target_field_id;
		}

		return $this->create_collection_field( $collection_id, $title, 'rollup', $meta );
	}

	private function create_entry( string $post_type, string $title ): int {
		return (int) wp_insert_post(
			array(
				'post_type'   => $post_type,
				'post_status' => 'publish',
				'post_title'  => $title,
			)
		);
	}

	/**
	 * Creates a collection with one field and registers its entry CPT.
	 *
	 * @return array{collection_id: int, field_id: int}
	 */
	private function create_collection_fixture( string $slug, string $field_type = 'number', string $post_status = 'private' ): array {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => $post_status,
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
