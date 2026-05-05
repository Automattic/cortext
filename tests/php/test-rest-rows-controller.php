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
			'/cortext/v1/collections/(?P<collection_id>\d+)/rows/(?P<row_id>\d+)',
			$routes
		);
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
		// Default sort: oldest-first so new rows land at the bottom.
		$this->assertSame( 'date', $args['orderby'] );
		$this->assertSame( 'ASC', $args['order'] );
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

	// -- Relation tests -------------------------------------------------

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
		$request->set_query_params( $params );

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
