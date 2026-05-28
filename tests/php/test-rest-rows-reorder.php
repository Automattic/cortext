<?php
/**
 * Tests for manual row order REST endpoints.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Rest\DocumentsController;
use Cortext\Rest\RowsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Rows_Reorder extends BaseTestCase {

	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RowsController() )->register();
		( new DocumentsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_reorder_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey(
			'/cortext/v1/documents/(?P<id>\d+)/reorder',
			$routes
		);
	}

	public function test_reorder_rejects_non_editors(): void {
		$fixture = $this->create_collection_fixture( 'r403' );
		$row_id  = $this->create_row_for( $fixture['collection_id'] );

		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->reorder_row(
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
		$row_id  = $this->create_row_for( $fixture['collection_id'] );

		$response = $this->reorder_row(
			$row_id,
			array( 'current_sort' => null )
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_first_reorder_requires_current_sort_param(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'sortreq' );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 2 );

		$response = $this->reorder_row(
			$rows[1],
			array( 'after_id' => $rows[0] )
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_reorder_current_sort_required', $response->get_data()['code'] );
	}

	public function test_first_reorder_seeds_collection_in_current_sort_order(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$fixture = $this->create_collection_fixture( 'seeded' );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 5 );
		foreach ( $rows as $row_id ) {
			wp_update_post(
				array(
					'ID'         => $row_id,
					'menu_order' => 0,
				)
			);
		}

		$response = $this->reorder_row(
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
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 5 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 200, 300, 400, 500 ) );

		$response = $this->reorder_row(
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
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 300, 100, 200 ) );

		$response = $this->reorder_row(
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
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 101, 300 ) );

		$response = $this->reorder_row(
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

	private function reorder_row( int $row_id, array $params ): \WP_REST_Response {
		$request = new WP_REST_Request(
			'POST',
			"/cortext/v1/documents/{$row_id}/reorder"
		);
		$request->set_param( 'id', $row_id );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_do_request( $request );
	}

	/**
	 * Creates a collection document with a placeholder field so it has a
	 * trait term, then returns the collection id alongside metadata.
	 *
	 * @param string $slug Collection slug.
	 * @return array{collection_id:int}
	 */
	private function create_collection_fixture( string $slug ): array {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => ucfirst( $slug ),
				'post_name'   => $slug,
			)
		);

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Title',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		return array(
			'collection_id' => $collection_id,
		);
	}

	/**
	 * Creates a stable date-ordered list of rows attached to a collection's
	 * trait term.
	 *
	 * @param int $collection_id Collection document id.
	 * @param int $count         Number of rows to create.
	 * @return int[]
	 */
	private function create_ordered_rows( int $collection_id, int $count ): array {
		$rows = array();
		for ( $i = 0; $i < $count; $i++ ) {
			$rows[] = $this->create_row_for(
				$collection_id,
				'Row ' . ( $i + 1 ),
				sprintf( '2026-01-%02d 00:00:00', $i + 1 )
			);
		}
		return $rows;
	}

	private function create_row_for(
		int $collection_id,
		string $title = 'Row',
		string $date = '2026-01-01 00:00:00'
	): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'     => Document::POST_TYPE,
				'post_status'   => 'publish',
				'post_title'    => $title,
				'post_date'     => $date,
				'post_date_gmt' => $date,
			)
		);
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		if ( $term_id > 0 ) {
			wp_set_object_terms( $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		}
		return $id;
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
}
