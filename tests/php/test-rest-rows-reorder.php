<?php
/**
 * Tests for manual row order REST endpoints.
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

final class Test_Rest_Rows_Reorder extends BaseTestCase {

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

	public function test_reorder_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey(
			'/cortext/v1/collections/(?P<collection_id>\d+)/rows/(?P<row_id>\d+)/reorder',
			$routes
		);
	}

	public function test_reorder_rejects_non_editors(): void {
		$fixture = $this->create_collection_fixture( 'r403' );
		$row_id  = $this->create_entry( $fixture['post_type'], 'Row' );

		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->reorder_row(
			$fixture['collection_id'],
			$row_id,
			array(
				'after_id'     => $row_id + 1,
				'current_sort' => null,
			)
		);

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_reorder_requires_a_neighbor(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'r400' );
		$row_id  = $this->create_entry( $fixture['post_type'], 'Row' );

		$response = $this->reorder_row(
			$fixture['collection_id'],
			$row_id,
			array( 'current_sort' => null )
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_reorder_rejects_cross_collection_neighbor(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture_a = $this->create_collection_fixture( 'crossa' );
		$fixture_b = $this->create_collection_fixture( 'crossb' );
		$row_a     = $this->create_entry( $fixture_a['post_type'], 'A' );
		$row_b     = $this->create_entry( $fixture_b['post_type'], 'B' );

		$response = $this->reorder_row(
			$fixture_a['collection_id'],
			$row_a,
			array(
				'before_id'    => $row_b,
				'current_sort' => null,
			)
		);

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_first_reorder_requires_current_sort_param(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'sortreq' );
		$rows    = $this->create_ordered_entries( $fixture['post_type'], 2 );

		$response = $this->reorder_row(
			$fixture['collection_id'],
			$rows[1],
			array( 'after_id' => $rows[0] )
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_reorder_current_sort_required', $response->get_data()['code'] );
	}

	public function test_first_reorder_seeds_collection_in_current_sort_order(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'seeded' );
		$rows    = $this->create_ordered_entries( $fixture['post_type'], 5 );
		foreach ( $rows as $row_id ) {
			wp_update_post(
				array(
					'ID'         => $row_id,
					'menu_order' => 0,
				)
			);
		}

		$response = $this->reorder_row(
			$fixture['collection_id'],
			$rows[4],
			array(
				'after_id'     => $rows[3],
				'current_sort' => array(
					'field'     => 'created_at',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertTrue( $data['reseeded'] );
		$this->assertTrue( $data['manual_seeded'] );
		$this->assertSame( '1', get_post_meta( $fixture['collection_id'], '_cortext_manual_seeded', true ) );
		$this->assertSame(
			array( 100, 200, 300, 400, 500 ),
			array_map( array( $this, 'menu_order' ), $rows )
		);
	}

	public function test_subsequent_move_uses_midpoint_without_touching_other_rows(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'midpoint' );
		$rows    = $this->create_ordered_entries( $fixture['post_type'], 5 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 200, 300, 400, 500 ) );

		$response = $this->reorder_row(
			$fixture['collection_id'],
			$rows[2],
			array(
				'before_id'    => $rows[1],
				'after_id'     => $rows[0],
				'current_sort' => array(
					'field'     => 'manual',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['reseeded'] );
		$this->assertSame( 150, $response->get_data()['menu_order'] );
		$this->assertSame(
			array( 100, 200, 150, 400, 500 ),
			array_map( array( $this, 'menu_order' ), $rows )
		);
	}

	public function test_reorder_from_field_sort_reseeds_visible_order(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'resort' );
		$rows    = $this->create_ordered_entries( $fixture['post_type'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 300, 100, 200 ) );

		$response = $this->reorder_row(
			$fixture['collection_id'],
			$rows[2],
			array(
				'before_id'    => $rows[0],
				'current_sort' => array(
					'field'     => 'created_at',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['reseeded'] );
		$this->assertSame(
			array( 100, 200, 0 ),
			array_map( array( $this, 'menu_order' ), $rows )
		);
	}

	public function test_reorder_densifies_when_gap_is_too_small(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'dense' );
		$rows    = $this->create_ordered_entries( $fixture['post_type'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 101, 300 ) );

		$response = $this->reorder_row(
			$fixture['collection_id'],
			$rows[2],
			array(
				'before_id'    => $rows[1],
				'after_id'     => $rows[0],
				'current_sort' => array(
					'field'     => 'manual',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['reseeded'] );
		$this->assertSame( 150, $this->menu_order( $rows[2] ) );
		$this->assertSame( 100, $this->menu_order( $rows[0] ) );
		$this->assertSame( 200, $this->menu_order( $rows[1] ) );
	}

	public function test_rows_endpoint_reports_seeded_manual_order(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'manualget' );
		$rows    = $this->create_ordered_entries( $fixture['post_type'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 300, 100, 200 ) );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
				'per_page'   => 25,
				'page'       => 1,
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertTrue( $data['collection']['manual_order_seeded'] );
	}

	public function test_rows_endpoint_reports_unseeded_manual_order(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'manualunseeded' );
		$this->create_ordered_entries( $fixture['post_type'], 2 );

		$response = $this->query_rows(
			array(
				'collection' => $fixture['collection_id'],
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['collection']['manual_order_seeded'] );
	}

	public function test_insert_hook_appends_new_rows_after_existing_manual_order(): void {
		$fixture = $this->create_collection_fixture( 'append' );
		$rows    = $this->create_ordered_entries( $fixture['post_type'], 2 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 250 ) );

		$new_row = $this->create_entry( $fixture['post_type'], 'New row' );

		$this->assertSame( 350, $this->menu_order( $new_row ) );
	}

	public function test_build_query_args_without_sort_uses_manual_order(): void {
		$fixture = $this->create_collection_fixture( 'bqmanual' );
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
			)
		);

		$controller = new RowsController();
		$method     = new \ReflectionMethod( $controller, 'build_query_args' );
		$method->setAccessible( true );
		$args = $method->invoke( $controller, $request, 'bqmanual' );

		$this->assertSame(
			array(
				'menu_order' => 'ASC',
				'ID'         => 'ASC',
			),
			$args['orderby']
		);
	}

	private function reorder_row( int $collection_id, int $row_id, array $params ): \WP_REST_Response {
		$request = new WP_REST_Request(
			'POST',
			"/cortext/v1/collections/{$collection_id}/rows/{$row_id}/reorder"
		);
		$request->set_param( 'collection_id', $collection_id );
		$request->set_param( 'row_id', $row_id );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_do_request( $request );
	}

	private function query_rows( array $params ): \WP_REST_Response {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/rows' );
		$request->set_query_params( $params );

		return rest_do_request( $request );
	}

	/**
	 * Creates a collection and registers its entry CPT.
	 *
	 * @param string $slug Collection slug.
	 * @return array{collection_id:int,post_type:string}
	 */
	private function create_collection_fixture( string $slug ): array {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => ucfirst( $slug ),
				'meta_input'  => array( 'slug' => $slug ),
			)
		);

		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		return array(
			'collection_id' => $collection_id,
			'post_type'     => CollectionEntries::CPT_PREFIX . $slug,
		);
	}

	/**
	 * Creates entries in a stable date order.
	 *
	 * @param string $post_type Entry post type.
	 * @param int    $count     Number of entries to create.
	 * @return int[]
	 */
	private function create_ordered_entries( string $post_type, int $count ): array {
		$rows = array();
		for ( $i = 0; $i < $count; $i++ ) {
			$rows[] = $this->create_entry(
				$post_type,
				'Row ' . ( $i + 1 ),
				sprintf( '2026-01-%02d 00:00:00', $i + 1 )
			);
		}
		return $rows;
	}

	private function create_entry( string $post_type, string $title, string $date = '2026-01-01 00:00:00' ): int {
		return (int) wp_insert_post(
			array(
				'post_type'     => $post_type,
				'post_status'   => 'publish',
				'post_title'    => $title,
				'post_date'     => $date,
				'post_date_gmt' => $date,
			)
		);
	}

	/**
	 * Sets manual order values for a collection fixture.
	 *
	 * @param int   $collection_id Collection post ID.
	 * @param int[] $row_ids       Row post IDs.
	 * @param int[] $orders        Menu order values.
	 */
	private function set_manual_orders( int $collection_id, array $row_ids, array $orders ): void {
		foreach ( $row_ids as $index => $row_id ) {
			wp_update_post(
				array(
					'ID'         => $row_id,
					'menu_order' => $orders[ $index ],
				)
			);
		}
		update_post_meta( $collection_id, '_cortext_manual_seeded', '1' );
	}

	private function menu_order( int $row_id ): int {
		return (int) get_post( $row_id )->menu_order;
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
