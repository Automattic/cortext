<?php
/**
 * Tests for Cortext\Rest\RecentsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\Page;
use Cortext\Rest\RecentsController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Recents_Controller extends BaseTestCase {

	use InMemoryPostsQuery;

	private const META_KEY = 'cortext_recents';

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Page() )->register_post_type();
		( new Collection() )->register_post_type();

		$this->install_in_memory_posts_query();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RecentsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/recents', $routes );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->get_recents();

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_touches_pages_collections_and_rows(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_icon  = wp_json_encode(
			array(
				'type'  => 'wp',
				'name'  => 'home',
				'color' => 'blue',
			)
		);
		$page_id    = $this->create_page(
			array(
				'post_name'  => 'notes',
				'meta_input' => array(
					DocumentIdentity::META_KEY => $page_icon,
				),
			)
		);
		$collection = $this->create_collection( 'people', 'People' );
		$row_id     = $this->create_row( 'crtxt_people', 'Ada Lovelace' );

		$this->touch_recent( 'page', $page_id );
		$this->touch_recent( 'collection', $collection );
		$response = $this->touch_recent( 'row', $row_id, $collection );

		$this->assertSame( 200, $response->get_status() );
		$recents = $this->get_recents()->get_data()['recents'];

		$this->assertCount( 3, $recents );
		$this->assertSame( 'row', $recents[0]['kind'] );
		$this->assertSame( $row_id, $recents[0]['id'] );
		$this->assertSame( 'Ada Lovelace', $recents[0]['title'] );
		$this->assertSame( "ada-lovelace-{$row_id}", $recents[0]['path'] );
		$this->assertSame( $collection, $recents[0]['collection']['id'] );
		$this->assertSame( 'People', $recents[0]['collection']['title'] );
		$this->assertSame( 'collection', $recents[1]['kind'] );
		$this->assertSame( "collection/people-{$collection}", $recents[1]['path'] );
		$this->assertSame( 'page', $recents[2]['kind'] );
		$this->assertSame( "page/notes-{$page_id}", $recents[2]['path'] );
		$this->assertSame( $page_icon, $recents[2]['icon'] );
		$this->assertMatchesRegularExpression(
			'/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/',
			$recents[0]['updatedAt']
		);
	}

	public function test_recents_are_stored_per_user(): void {
		$user_a = $this->create_user( 'administrator' );
		$user_b = $this->create_user( 'administrator' );

		wp_set_current_user( $user_a );
		$page_id = $this->create_page();
		$this->touch_recent( 'page', $page_id );

		wp_set_current_user( $user_b );
		$response = $this->get_recents();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['recents'] );
	}

	public function test_repeated_touch_moves_item_to_top_without_duplicate(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_a = $this->create_page( array( 'post_title' => 'A' ) );
		$page_b = $this->create_page( array( 'post_title' => 'B' ) );

		$this->touch_recent( 'page', $page_a );
		$this->touch_recent( 'page', $page_b );
		$this->touch_recent( 'page', $page_a );

		$recents = $this->get_recents()->get_data()['recents'];

		$this->assertCount( 2, $recents );
		$this->assertSame( $page_a, $recents[0]['id'] );
		$this->assertSame( $page_b, $recents[1]['id'] );
	}

	public function test_rejects_invalid_and_forbidden_targets(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Regular post',
			)
		);

		$invalid_type           = $this->touch_recent( 'page', $post_id );
		$row_missing_collection = $this->touch_recent( 'row', 999 );

		$owner_id = $this->create_user( 'administrator' );
		wp_set_current_user( $owner_id );
		$private_page = $this->create_page(
			array(
				'post_author' => $owner_id,
				'post_status' => 'private',
			)
		);

		wp_set_current_user( $this->create_user( 'contributor' ) );
		$forbidden = $this->touch_recent( 'page', $private_page );

		$this->assertSame( 404, $invalid_type->get_status() );
		$this->assertSame( 400, $row_missing_collection->get_status() );
		$this->assertSame( 403, $forbidden->get_status() );
	}

	public function test_get_prunes_deleted_and_trashed_targets(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();

		$this->touch_recent( 'page', $page_id );
		wp_trash_post( $page_id );

		$response = $this->get_recents();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['recents'] );
		$this->assertSame( array(), get_user_meta( get_current_user_id(), self::META_KEY, true ) );

		$page_id = $this->create_page();
		$this->touch_recent( 'page', $page_id );
		wp_delete_post( $page_id, true );

		$response = $this->get_recents();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['recents'] );
	}

	public function test_recents_are_capped_at_five_items(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_ids = array();

		for ( $i = 0; $i < 6; $i++ ) {
			$page_ids[] = $this->create_page(
				array(
					'post_title' => "Page {$i}",
				)
			);
			$this->touch_recent( 'page', $page_ids[ $i ] );
		}

		$recents = $this->get_recents()->get_data()['recents'];

		$this->assertCount( 5, $recents );
		$this->assertSame( $page_ids[5], $recents[0]['id'] );
		$this->assertNotContains(
			$page_ids[0],
			array_map(
				static fn ( array $recent ): int => (int) $recent['id'],
				$recents
			)
		);
	}

	public function test_rejects_touching_an_inline_collection_recent(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'hidden', 'Hidden' );
		update_post_meta( $collection_id, Collection::MODE_META_KEY, Collection::MODE_INLINE );

		$response = $this->touch_recent( 'collection', $collection_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_recents_inline_collection',
			$response->get_data()['code']
		);
	}

	public function test_get_drops_stale_inline_collection_recents(): void {
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		$full_id   = $this->create_collection( 'visible', 'Visible' );
		$inline_id = $this->create_collection( 'hidden', 'Hidden' );
		update_post_meta( $full_id, Collection::MODE_META_KEY, Collection::MODE_FULL_PAGE );
		update_post_meta( $inline_id, Collection::MODE_META_KEY, Collection::MODE_INLINE );

		update_user_meta(
			$user_id,
			self::META_KEY,
			array(
				array(
					'kind'      => 'collection',
					'id'        => $full_id,
					'updatedAt' => gmdate( DATE_RFC3339 ),
				),
				array(
					'kind'      => 'collection',
					'id'        => $inline_id,
					'updatedAt' => gmdate( DATE_RFC3339 ),
				),
			)
		);

		$response = $this->get_recents();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $full_id ),
			array_column( $response->get_data()['recents'], 'id' )
		);
	}

	private function get_recents() {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/recents' );
		return rest_do_request( $request );
	}

	private function touch_recent( string $kind, int $id, int $collection_id = 0 ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/recents' );
		$params  = array(
			'kind' => $kind,
			'id'   => $id,
		);
		if ( $collection_id > 0 ) {
			$params['collectionId'] = $collection_id;
		}
		$request->set_body_params( $params );
		return rest_do_request( $request );
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

	private function create_page( array $args = array() ): int {
		$defaults = array(
			'post_type'   => Page::POST_TYPE,
			'post_status' => 'private',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		return (int) $id;
	}

	private function create_collection( string $slug, string $title = 'Collection' ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array(
					'slug' => $slug,
				),
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		( new CollectionEntries() )->register_for_collection( get_post( (int) $id ) );

		return (int) $id;
	}

	private function create_row( string $post_type, string $title ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => $post_type,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	private function unregister_dynamic_collection_post_types(): void {
		foreach ( get_post_types() as $post_type ) {
			if (
				str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) &&
				! in_array( $post_type, array( Page::POST_TYPE, Collection::POST_TYPE, Field::POST_TYPE ), true )
			) {
				unregister_post_type( $post_type );
			}
		}
	}
}
