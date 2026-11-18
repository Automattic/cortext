<?php
/**
 * Tests for manual row order REST endpoints.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Rest\DocumentsController;
use Cortext\Rest\RowsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Rows_Reorder extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private ArchiveCascade $archive_cascade;

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
		$this->install_in_memory_posts_query();
		TraitTaxonomy::reset_wordbless_order();

		$this->archive_cascade = new ArchiveCascade();
		$this->archive_cascade->register_status();
		$this->archive_cascade->register_meta();
		$this->archive_cascade->register();
		( new TrashCascade() )->register();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RowsController() )->register();
		( new DocumentsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
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
			array_map(
				fn( int $row_id ): int => $this->order_of( $fixture['collection_id'], $row_id ),
				$rows
			)
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
			array_map(
				fn( int $row_id ): int => $this->order_of( $fixture['collection_id'], $row_id ),
				$rows
			)
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
			array_map(
				fn( int $row_id ): int => $this->order_of( $fixture['collection_id'], $row_id ),
				$rows
			)
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
		$this->assertSame( 150, $this->order_of( $fixture['collection_id'], $rows[2] ) );
		$this->assertSame( 100, $this->order_of( $fixture['collection_id'], $rows[0] ) );
		$this->assertSame( 200, $this->order_of( $fixture['collection_id'], $rows[1] ) );
	}

	public function test_new_member_lands_after_existing_rows(): void {
		$fixture       = $this->create_collection_fixture( 'append' );
		$collection_id = $fixture['collection_id'];
		$tt_id         = TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id );

		$existing = $this->create_ordered_rows( $collection_id, 2 );
		$this->set_manual_orders( $collection_id, $existing, array( 100, 200 ) );

		$new_row = $this->create_row_for( $collection_id, 'New Row' );
		$trait   = new TraitTaxonomy();
		$trait->append_new_member_to_order(
			$new_row,
			array( $tt_id ),
			array( $tt_id ),
			TraitTaxonomy::TAXONOMY,
			false,
			array()
		);

		$this->assertSame( 300, $this->order_of( $collection_id, $new_row ) );
		$this->assertSame( 100, $this->order_of( $collection_id, $existing[0] ) );
		$this->assertSame( 200, $this->order_of( $collection_id, $existing[1] ) );
	}

	public function test_new_member_keeps_existing_order_on_resave(): void {
		$fixture       = $this->create_collection_fixture( 'resave' );
		$collection_id = $fixture['collection_id'];
		$tt_id         = TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id );

		$row = $this->create_row_for( $collection_id, 'Placed Row' );
		TraitTaxonomy::set_member_order( $row, $tt_id, 250 );

		$trait = new TraitTaxonomy();
		$trait->append_new_member_to_order(
			$row,
			array( $tt_id ),
			array( $tt_id ),
			TraitTaxonomy::TAXONOMY,
			false,
			array()
		);

		// A non-zero position (a prior drag or seed) is left untouched.
		$this->assertSame( 250, $this->order_of( $collection_id, $row ) );
	}

	public function test_row_keeps_manual_position_after_archive_and_restore(): void {
		$fixture = $this->create_collection_fixture( 'keep-row' );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 300, 100, 200 ) );

		$this->assertIsArray( $this->archive_cascade->archive( $rows[1] ) );
		$this->assertSame( 100, $this->order_of( $fixture['collection_id'], $rows[1] ) );
		$this->assertIsArray( $this->archive_cascade->unarchive( $rows[1] ) );

		$this->assertSame( 'publish', get_post_status( $rows[1] ) );
		$this->assertSame(
			array( 300, 100, 200 ),
			array_map(
				fn( int $row_id ): int => $this->order_of( $fixture['collection_id'], $row_id ),
				$rows
			)
		);
	}

	public function test_rows_keep_manual_positions_through_collection_archive_cascade(): void {
		$fixture = $this->create_collection_fixture( 'keep-cascade' );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 300, 100, 200 ) );

		$archived = $this->archive_cascade->archive( $fixture['collection_id'] );
		$this->assertIsArray( $archived );
		foreach ( $rows as $row_id ) {
			$this->assertSame( 'crtxt_archived', get_post_status( $row_id ) );
		}
		$this->assertIsArray( $this->archive_cascade->unarchive( $fixture['collection_id'] ) );

		foreach ( $rows as $row_id ) {
			$this->assertSame( 'publish', get_post_status( $row_id ) );
		}
		$this->assertSame(
			array( 300, 100, 200 ),
			array_map(
				fn( int $row_id ): int => $this->order_of( $fixture['collection_id'], $row_id ),
				$rows
			)
		);
	}

	/**
	 * @dataProvider hidden_statuses
	 *
	 * @param string $status Hidden status to apply.
	 */
	public function test_reorder_rejects_rows_of_a_hidden_collection( string $status ): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$fixture = $this->create_collection_fixture( 'hidden-collection-' . $status );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 200, 300 ) );
		$this->hide( $fixture['collection_id'], $status );

		$response = $this->reorder_row(
			$rows[2],
			array(
				'before_id'    => $rows[0],
				'current_sort' => null,
			)
		);

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_reorder_collection_hidden', $response->get_data()['code'] );
		$this->assertSame( 300, $this->order_of( $fixture['collection_id'], $rows[2] ) );
	}

	/**
	 * @dataProvider hidden_statuses
	 *
	 * @param string $status Hidden status to apply.
	 */
	public function test_reorder_rejects_a_hidden_row( string $status ): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$fixture = $this->create_collection_fixture( 'hidden-row-' . $status );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 200, 300 ) );
		$this->hide( $rows[2], $status );

		$response = $this->reorder_row(
			$rows[2],
			array(
				'before_id'    => $rows[0],
				'current_sort' => null,
			)
		);

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_reorder_row_hidden', $response->get_data()['code'] );
		$this->assertSame( 300, $this->order_of( $fixture['collection_id'], $rows[2] ) );
	}

	/**
	 * @dataProvider hidden_anchor_cases
	 *
	 * @param string $status Hidden status to apply.
	 * @param string $anchor Neighbor parameter that points at the hidden row.
	 */
	public function test_reorder_rejects_a_hidden_neighbor_before_writing( string $status, string $anchor ): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$fixture = $this->create_collection_fixture( 'hidden-anchor-' . $status . '-' . $anchor );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 300, 200, 100 ) );
		delete_post_meta( $fixture['collection_id'], '_cortext_manual_seeded' );
		$this->hide( $rows[0], $status );

		$response = $this->reorder_row(
			$rows[2],
			array(
				$anchor        => $rows[0],
				'current_sort' => array(
					'field'     => 'created_at',
					'direction' => 'asc',
				),
			)
		);

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_reorder_neighbor_hidden', $response->get_data()['code'] );
		$this->assertSame( '', get_post_meta( $fixture['collection_id'], '_cortext_manual_seeded', true ) );
		$this->assertSame(
			array( 300, 200, 100 ),
			array_map(
				fn( int $row_id ): int => $this->order_of( $fixture['collection_id'], $row_id ),
				$rows
			)
		);
	}

	public function test_reorder_moves_an_active_row_next_to_active_rows_beside_hidden_ones(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$fixture = $this->create_collection_fixture( 'active-beside-hidden' );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 4 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 200, 300, 400 ) );
		$this->hide( $rows[1], 'crtxt_archived' );

		$response = $this->reorder_row(
			$rows[3],
			array(
				'before_id'    => $rows[2],
				'after_id'     => $rows[0],
				'current_sort' => null,
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$menu_order = $response->get_data()['menu_order'];
		$this->assertGreaterThan( 100, $menu_order );
		$this->assertLessThan( 300, $menu_order );
	}

	public function test_reorder_densifies_when_a_restored_row_ties_with_its_neighbor(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$fixture = $this->create_collection_fixture( 'restored-tie' );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 4 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 200, 300, 400 ) );

		// Moving the last row between the two active rows around an archived
		// one lands it on the archived row's position.
		$this->assertIsArray( $this->archive_cascade->archive( $rows[1] ) );
		$this->reorder_row(
			$rows[3],
			array(
				'before_id'    => $rows[2],
				'after_id'     => $rows[0],
				'current_sort' => null,
			)
		);
		$this->assertIsArray( $this->archive_cascade->unarchive( $rows[1] ) );
		$this->assertSame( $this->order_of( $fixture['collection_id'], $rows[1] ), $this->order_of( $fixture['collection_id'], $rows[3] ) );

		$response = $this->reorder_row(
			$rows[2],
			array(
				'before_id'    => $rows[3],
				'after_id'     => $rows[1],
				'current_sort' => null,
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['reseeded'] );
		$orders = array_map(
			fn( int $row_id ): int => $this->order_of( $fixture['collection_id'], $row_id ),
			$rows
		);
		$this->assertLessThan( $orders[1], $orders[0] );
		$this->assertLessThan( $orders[2], $orders[1] );
		$this->assertLessThan( $orders[3], $orders[2] );
	}

	public function test_reorder_rejects_tied_neighbors_sent_in_reverse_order(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$fixture = $this->create_collection_fixture( 'reverse-tie' );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 3 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 100, 200 ) );

		// Lists show tied rows by ID, so rows[0] sits above rows[1].
		$response = $this->reorder_row(
			$rows[2],
			array(
				'before_id'    => $rows[0],
				'after_id'     => $rows[1],
				'current_sort' => null,
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_reorder_invalid_neighbors', $response->get_data()['code'] );
	}

	/**
	 * @dataProvider hidden_statuses
	 *
	 * @param string $status Hidden status to apply.
	 */
	public function test_reorder_treats_a_hidden_row_of_another_collection_as_not_found( string $status ): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$fixture = $this->create_collection_fixture( 'own-' . $status );
		$rows    = $this->create_ordered_rows( $fixture['collection_id'], 2 );
		$this->set_manual_orders( $fixture['collection_id'], $rows, array( 100, 200 ) );
		$other   = $this->create_collection_fixture( 'other-' . $status );
		$foreign = $this->create_row_for( $other['collection_id'] );
		$this->hide( $foreign, $status );

		$response = $this->reorder_row(
			$rows[1],
			array(
				'before_id'    => $foreign,
				'current_sort' => null,
			)
		);

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_row_not_found', $response->get_data()['code'] );
	}

	public static function hidden_statuses(): array {
		return array(
			'archived' => array( 'crtxt_archived' ),
			'trashed'  => array( 'trash' ),
		);
	}

	public static function hidden_anchor_cases(): array {
		return array(
			'archived before_id' => array( 'crtxt_archived', 'before_id' ),
			'archived after_id'  => array( 'crtxt_archived', 'after_id' ),
			'trashed before_id'  => array( 'trash', 'before_id' ),
			'trashed after_id'   => array( 'trash', 'after_id' ),
		);
	}

	private function hide( int $post_id, string $status ): void {
		if ( 'trash' === $status ) {
			$this->assertNotEmpty( wp_trash_post( $post_id ) );
		} else {
			$this->assertIsArray( $this->archive_cascade->archive( $post_id ) );
		}
		$this->assertSame( $status, get_post_status( $post_id ) );
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
		$id      = (int) wp_insert_post(
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
	 * Sets manual order values for a collection fixture, writing them into the
	 * collection's per-row term_order the same way the reorder flow does.
	 *
	 * @param int   $collection_id Collection post ID.
	 * @param int[] $row_ids       Row post IDs.
	 * @param int[] $orders        Order values.
	 */
	private function set_manual_orders( int $collection_id, array $row_ids, array $orders ): void {
		$tt_id = TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id );
		foreach ( $row_ids as $index => $row_id ) {
			TraitTaxonomy::set_member_order( $row_id, $tt_id, $orders[ $index ] );
		}
		update_post_meta( $collection_id, '_cortext_manual_seeded', '1' );
	}

	/**
	 * Reads a row's manual order within a collection.
	 *
	 * @param int $collection_id Collection post ID.
	 * @param int $row_id        Row post ID.
	 */
	private function order_of( int $collection_id, int $row_id ): int {
		$tt_id = TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id );
		return TraitTaxonomy::member_order( $row_id, $tt_id );
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
