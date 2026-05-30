<?php
/**
 * Tests for Cortext\Rest\RecentsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Rest\RecentsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Recents_Controller extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private const META_KEY = 'cortext_recents';

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

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RecentsController() )->register();
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
		$row_id     = $this->create_row( $collection, 'Ada Lovelace' );

		$this->touch_recent( $page_id );
		$this->touch_recent( $collection );
		$response = $this->touch_recent( $row_id );

		$this->assertSame( 200, $response->get_status() );
		$recents = $this->get_recents()->get_data()['recents'];

		$this->assertCount( 3, $recents );
		$this->assertSame( $row_id, $recents[0]['id'] );
		$this->assertSame( 'Ada Lovelace', $recents[0]['title'] );
		$this->assertSame( "ada-lovelace-{$row_id}", $recents[0]['path'] );
		$this->assertSame( $collection, $recents[0]['collection']['id'] );
		$this->assertSame( 'People', $recents[0]['collection']['title'] );
		$this->assertSame( $collection, $recents[1]['id'] );
		$this->assertSame( "people-{$collection}", $recents[1]['path'] );
		$this->assertSame( $page_id, $recents[2]['id'] );
		$this->assertSame( "notes-{$page_id}", $recents[2]['path'] );
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
		$this->touch_recent( $page_id );

		wp_set_current_user( $user_b );
		$response = $this->get_recents();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['recents'] );
	}

	public function test_repeated_touch_moves_item_to_top_without_duplicate(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_a = $this->create_page( array( 'post_title' => 'A' ) );
		$page_b = $this->create_page( array( 'post_title' => 'B' ) );

		$this->touch_recent( $page_a );
		$this->touch_recent( $page_b );
		$this->touch_recent( $page_a );

		$recents = $this->get_recents()->get_data()['recents'];

		$this->assertCount( 2, $recents );
		$this->assertSame( $page_a, $recents[0]['id'] );
		$this->assertSame( $page_b, $recents[1]['id'] );
	}

	public function test_stored_meta_uses_bare_id_shape(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();

		$this->touch_recent( $page_id );

		$stored = get_user_meta( get_current_user_id(), self::META_KEY, true );
		$this->assertIsArray( $stored );
		$this->assertCount( 1, $stored );
		$this->assertSame( $page_id, $stored[0]['id'] );
		$this->assertArrayNotHasKey( 'kind', $stored[0] );
		$this->assertArrayHasKey( 'updatedAt', $stored[0] );
	}

	public function test_legacy_kind_id_meta_is_forward_migrated_on_read(): void {
		// Older builds stored each recent as `{kind, id, updatedAt}`. The
		// reader accepts that shape, renders it, and rewrites storage to
		// the new `{id, updatedAt}` shape on the next save.
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();

		update_user_meta(
			get_current_user_id(),
			self::META_KEY,
			array(
				array(
					'kind'      => 'page',
					'id'        => $page_id,
					'updatedAt' => '2026-05-01T00:00:00+00:00',
				),
			)
		);

		$response = $this->get_recents();
		$recents  = $response->get_data()['recents'];

		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( 1, $recents );
		$this->assertSame( $page_id, $recents[0]['id'] );
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

		$invalid_type = $this->touch_recent( $post_id );

		$owner_id = $this->create_user( 'administrator' );
		wp_set_current_user( $owner_id );
		$private_page = $this->create_page(
			array(
				'post_author' => $owner_id,
				'post_status' => 'private',
			)
		);

		wp_set_current_user( $this->create_user( 'contributor' ) );
		$forbidden = $this->touch_recent( $private_page );

		$this->assertSame( 404, $invalid_type->get_status() );
		$this->assertSame( 403, $forbidden->get_status() );
	}

	public function test_get_prunes_deleted_and_trashed_targets(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();

		$this->touch_recent( $page_id );
		wp_trash_post( $page_id );

		$response = $this->get_recents();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['recents'] );
		$this->assertSame( array(), get_user_meta( get_current_user_id(), self::META_KEY, true ) );

		$page_id = $this->create_page();
		$this->touch_recent( $page_id );
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
			$this->touch_recent( $page_ids[ $i ] );
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

	private function get_recents() {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/recents' );
		return rest_do_request( $request );
	}

	private function touch_recent( int $id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/recents' );
		$request->set_body_params( array( 'id' => $id ) );
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
			'post_type'   => Document::POST_TYPE,
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
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'post_name'   => $slug,
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Title',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( (int) $id, 'cortext_fields', (string) $field_id );

		return (int) $id;
	}

	private function create_row( int $collection_id, string $title ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
		$this->assertGreaterThan( 0, $id );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

		return $id;
	}
}
