<?php
/**
 * Tests for Cortext\Rest\FavoritesController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Rest\FavoritesController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Favorites_Controller extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private const META_KEY = 'cortext_favorites';

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
		( new FavoritesController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_get_returns_empty_list_when_no_favorites_are_set(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['favorites'] );
	}

	public function test_sets_and_reads_page_and_collection_favorites_in_order(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id   = $this->create_page(
			array(
				'post_name'  => 'daily-notes',
				'post_title' => 'Daily Notes',
			)
		);
		$page_icon = wp_json_encode(
			array(
				'type' => 'wp',
				'name' => 'notebook',
			)
		);
		update_post_meta( $page_id, DocumentIdentity::META_KEY, $page_icon );
		$collection_id = $this->create_collection( 'books', 'Books' );

		$set_response = $this->set_favorites(
			array(
				array( 'id' => $collection_id ),
				array( 'id' => $page_id ),
			)
		);
		$get_response = $this->get_favorites();

		$expected = array(
			array(
				'id'    => $collection_id,
				'title' => 'Books',
				'path'  => "books-{$collection_id}",
			),
			array(
				'id'    => $page_id,
				'title' => 'Daily Notes',
				'path'  => "daily-notes-{$page_id}",
				'icon'  => $page_icon,
			),
		);
		$this->assertSame( 200, $set_response->get_status() );
		$this->assertSame( $expected, $set_response->get_data()['favorites'] );
		$this->assertSame( $expected, $get_response->get_data()['favorites'] );
		$this->assertSame(
			array( $collection_id, $page_id ),
			get_user_meta( get_current_user_id(), self::META_KEY, true )
		);
	}

	public function test_favorites_are_stored_per_user(): void {
		$user_a = $this->create_user( 'administrator' );
		$user_b = $this->create_user( 'administrator' );
		wp_set_current_user( $user_a );
		$page_id = $this->create_page();

		$this->set_favorites( array( array( 'id' => $page_id ) ) );

		wp_set_current_user( $user_b );
		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['favorites'] );
	}

	public function test_reorder_persists(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_a = $this->create_page( array( 'post_name' => 'a' ) );
		$page_b = $this->create_page( array( 'post_name' => 'b' ) );
		$this->set_favorites(
			array(
				array( 'id' => $page_a ),
				array( 'id' => $page_b ),
			)
		);

		$this->set_favorites(
			array(
				array( 'id' => $page_b ),
				array( 'id' => $page_a ),
			)
		);
		$response = $this->get_favorites();

		$this->assertSame(
			array( $page_b, $page_a ),
			array_column( $response->get_data()['favorites'], 'id' )
		);
	}

	public function test_rejects_invalid_targets(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->set_favorites( array( array( 'id' => 0 ) ) );

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_rejects_a_non_cortext_target(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Regular post',
			)
		);

		$response = $this->set_favorites( array( array( 'id' => $post_id ) ) );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame(
			'cortext_document_target_not_found',
			$response->get_data()['code']
		);
	}

	public function test_rejects_a_target_the_user_cannot_edit(): void {
		$owner_id = $this->create_user( 'administrator' );
		wp_set_current_user( $owner_id );
		$page_id = $this->create_page(
			array(
				'post_author' => $owner_id,
				'post_status' => 'private',
			)
		);

		wp_set_current_user( $this->create_user( 'contributor' ) );
		$response = $this->set_favorites( array( array( 'id' => $page_id ) ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame(
			'cortext_document_target_forbidden',
			$response->get_data()['code']
		);
	}

	public function test_get_omits_invalid_deleted_trashed_duplicate_and_inaccessible_targets(): void {
		$owner_id = $this->create_user( 'administrator' );
		$user_id  = $this->create_user( 'contributor' );
		wp_set_current_user( $owner_id );
		$valid_page = $this->create_page(
			array(
				'post_author' => $user_id,
				'post_name'   => 'valid',
				'post_status' => 'draft',
			)
		);
		$trashed    = $this->create_page();
		$deleted    = $this->create_page();
		$private    = $this->create_page(
			array(
				'post_author' => $owner_id,
				'post_status' => 'private',
			)
		);
		wp_trash_post( $trashed );
		wp_delete_post( $deleted, true );

		update_user_meta(
			$user_id,
			self::META_KEY,
			array(
				$valid_page,
				$valid_page,
				'not-a-target',
				$trashed,
				$deleted,
				$private,
			)
		);

		wp_set_current_user( $user_id );
		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $valid_page ),
			array_column( $response->get_data()['favorites'], 'id' )
		);
		// Keep storage pruned too. Otherwise the next save can replay a stale
		// favorite and fail before it writes the valid ones.
		$this->assertSame(
			array( $valid_page ),
			get_user_meta( $user_id, self::META_KEY, true )
		);
	}

	public function test_get_prunes_a_row_favorite_whose_row_was_trashed(): void {
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		$collection_id = $this->create_collection( 'people', 'People' );
		$kept_row      = $this->create_row( $collection_id, 'Kept' );
		$trashed_row   = $this->create_row( $collection_id, 'Trashed' );

		update_user_meta(
			$user_id,
			self::META_KEY,
			array( $kept_row, $trashed_row )
		);

		wp_trash_post( $trashed_row );
		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $kept_row ),
			array_column( $response->get_data()['favorites'], 'id' )
		);
		$this->assertSame(
			array( $kept_row ),
			get_user_meta( $user_id, self::META_KEY, true )
		);
	}

	public function test_get_migrates_legacy_kind_id_string_shape(): void {
		// Older builds stored favorites as `"kind:id"` strings. The reader
		// accepts that shape and rewrites it as the canonical bare-int id
		// on the next access.
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		$collection_id = $this->create_collection( 'people', 'People' );
		$row_id        = $this->create_row( $collection_id, 'Ada Lovelace' );

		update_user_meta(
			$user_id,
			self::META_KEY,
			array( "collection:{$collection_id}", "row:{$row_id}" )
		);

		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $collection_id, $row_id ),
			array_column( $response->get_data()['favorites'], 'id' )
		);
		$this->assertSame(
			array( $collection_id, $row_id ),
			get_user_meta( $user_id, self::META_KEY, true )
		);
	}

	public function test_get_migrates_legacy_row_favorite_array_shape(): void {
		// Older builds stored row favorites as arrays carrying the parent
		// collection id. The read should accept that shape and rewrite it
		// as the canonical bare-int id so the next save uses the new shape.
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		$collection_id = $this->create_collection( 'people', 'People' );
		$row_id        = $this->create_row( $collection_id, 'Ada Lovelace' );

		update_user_meta(
			$user_id,
			self::META_KEY,
			array(
				array(
					'kind'         => 'row',
					'id'           => $row_id,
					'collectionId' => $collection_id,
				),
			)
		);

		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $row_id ),
			array_column( $response->get_data()['favorites'], 'id' )
		);
		$this->assertSame(
			array( $row_id ),
			get_user_meta( $user_id, self::META_KEY, true )
		);
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->get_favorites();

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_sets_and_reads_row_favorites(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'people', 'People' );
		$row_id        = $this->create_row( $collection_id, 'Ada Lovelace' );

		$set_response = $this->set_favorites( array( array( 'id' => $row_id ) ) );
		$get_response = $this->get_favorites();

		$this->assertSame( 200, $set_response->get_status() );
		$favorites = $set_response->get_data()['favorites'];
		$this->assertCount( 1, $favorites );
		$this->assertSame( $row_id, $favorites[0]['id'] );
		$this->assertSame( 'Ada Lovelace', $favorites[0]['title'] );
		// The parent collection comes out of the response. The server
		// resolves it from the row's trait term, so the client never has to
		// send it.
		$this->assertSame( $collection_id, $favorites[0]['collection']['id'] );
		$this->assertSame( 'People', $favorites[0]['collection']['title'] );
		$this->assertSame(
			$favorites,
			$get_response->get_data()['favorites']
		);
		$this->assertSame(
			array( $row_id ),
			get_user_meta( get_current_user_id(), self::META_KEY, true )
		);
	}

	public function test_get_drops_favorites_for_a_permanently_deleted_collection(): void {
		// Self-heal contract: when a collection is force-deleted, the next
		// favorites read filters its entry out via format_target's not-found
		// branch. No eager scrub on delete is needed for correctness.
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		$kept_id    = $this->create_collection( 'kept', 'Kept' );
		$deleted_id = $this->create_collection( 'doomed', 'Doomed' );

		update_user_meta(
			$user_id,
			self::META_KEY,
			array( $kept_id, $deleted_id )
		);

		wp_delete_post( $deleted_id, true );

		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $kept_id ),
			array_column( $response->get_data()['favorites'], 'id' )
		);
	}

	private function get_favorites() {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/favorites' );
		return rest_do_request( $request );
	}

	private function set_favorites( array $favorites ) {
		$request = new WP_REST_Request( 'PUT', '/cortext/v1/favorites' );
		$request->set_body_params(
			array(
				'favorites' => $favorites,
			)
		);
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

	private function create_collection( string $slug, string $title = '' ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => '' === $title ? 'Test collection ' . wp_generate_uuid4() : $title,
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
