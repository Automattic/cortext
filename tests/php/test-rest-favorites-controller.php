<?php
/**
 * Tests for Cortext\Rest\FavoritesController.
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
use Cortext\Rest\FavoritesController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Favorites_Controller extends BaseTestCase {

	use InMemoryPostsQuery;

	private const META_KEY = 'cortext_favorites';

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Page() )->register_post_type();
		( new Collection() )->register_post_type();
		$this->install_in_memory_posts_query();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new FavoritesController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
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
				array(
					'kind' => 'collection',
					'id'   => $collection_id,
				),
				array(
					'kind' => 'page',
					'id'   => $page_id,
				),
			)
		);
		$get_response = $this->get_favorites();

		$expected = array(
			array(
				'kind'  => 'collection',
				'id'    => $collection_id,
				'title' => 'Books',
				'path'  => "collection/books-{$collection_id}",
			),
			array(
				'kind'  => 'page',
				'id'    => $page_id,
				'title' => 'Daily Notes',
				'path'  => "page/daily-notes-{$page_id}",
				'icon'  => $page_icon,
			),
		);
		$this->assertSame( 200, $set_response->get_status() );
		$this->assertSame( $expected, $set_response->get_data()['favorites'] );
		$this->assertSame( $expected, $get_response->get_data()['favorites'] );
		$this->assertSame(
			array( "collection:{$collection_id}", "page:{$page_id}" ),
			get_user_meta( get_current_user_id(), self::META_KEY, true )
		);
	}

	public function test_favorites_are_stored_per_user(): void {
		$user_a = $this->create_user( 'administrator' );
		$user_b = $this->create_user( 'administrator' );
		wp_set_current_user( $user_a );
		$page_id = $this->create_page();

		$this->set_favorites(
			array(
				array(
					'kind' => 'page',
					'id'   => $page_id,
				),
			)
		);

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
				array(
					'kind' => 'page',
					'id'   => $page_a,
				),
				array(
					'kind' => 'page',
					'id'   => $page_b,
				),
			)
		);

		$this->set_favorites(
			array(
				array(
					'kind' => 'page',
					'id'   => $page_b,
				),
				array(
					'kind' => 'page',
					'id'   => $page_a,
				),
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

		$response = $this->set_favorites(
			array(
				array(
					'kind' => 'page',
					'id'   => 0,
				),
			)
		);

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

		$response = $this->set_favorites(
			array(
				array(
					'kind' => 'page',
					'id'   => $post_id,
				),
			)
		);

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
		$response = $this->set_favorites(
			array(
				array(
					'kind' => 'page',
					'id'   => $page_id,
				),
			)
		);

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
				"page:{$valid_page}",
				"page:{$valid_page}",
				'not-a-target',
				"page:{$trashed}",
				"page:{$deleted}",
				"page:{$private}",
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
			array( "page:{$valid_page}" ),
			get_user_meta( $user_id, self::META_KEY, true )
		);
	}

	public function test_get_prunes_a_row_favorite_whose_row_was_trashed(): void {
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		$collection_id = $this->create_collection( 'people', 'People' );
		$kept_row      = $this->create_row( 'crtxt_people', 'Kept' );
		$trashed_row   = $this->create_row( 'crtxt_people', 'Trashed' );

		update_user_meta(
			$user_id,
			self::META_KEY,
			array(
				array(
					'kind'         => 'row',
					'id'           => $kept_row,
					'collectionId' => $collection_id,
				),
				array(
					'kind'         => 'row',
					'id'           => $trashed_row,
					'collectionId' => $collection_id,
				),
			)
		);

		wp_trash_post( $trashed_row );
		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $kept_row ),
			array_column( $response->get_data()['favorites'], 'id' )
		);
		$this->assertSame(
			array(
				array(
					'kind'         => 'row',
					'id'           => $kept_row,
					'collectionId' => $collection_id,
				),
			),
			get_user_meta( $user_id, self::META_KEY, true )
		);
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->get_favorites();

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_rejects_favoriting_an_inline_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'hidden', 'Hidden' );
		update_post_meta( $collection_id, Collection::MODE_META_KEY, Collection::MODE_INLINE );

		$response = $this->set_favorites(
			array(
				array(
					'kind' => 'collection',
					'id'   => $collection_id,
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_document_target_inline_collection',
			$response->get_data()['code']
		);
	}

	public function test_sets_and_reads_row_favorites(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'people', 'People' );
		$row_id        = $this->create_row( 'crtxt_people', 'Ada Lovelace' );

		$set_response = $this->set_favorites(
			array(
				array(
					'kind'         => 'row',
					'id'           => $row_id,
					'collectionId' => $collection_id,
				),
			)
		);
		$get_response = $this->get_favorites();

		$this->assertSame( 200, $set_response->get_status() );
		$favorites = $set_response->get_data()['favorites'];
		$this->assertCount( 1, $favorites );
		$this->assertSame( 'row', $favorites[0]['kind'] );
		$this->assertSame( $row_id, $favorites[0]['id'] );
		$this->assertSame( 'Ada Lovelace', $favorites[0]['title'] );
		$this->assertSame( $collection_id, $favorites[0]['collection']['id'] );
		$this->assertSame( 'People', $favorites[0]['collection']['title'] );
		$this->assertSame(
			$favorites,
			$get_response->get_data()['favorites']
		);
		// Row favorites carry their collection id. Page and collection favorites
		// keep the old `"kind:id"` string.
		$this->assertSame(
			array(
				array(
					'kind'         => 'row',
					'id'           => $row_id,
					'collectionId' => $collection_id,
				),
			),
			get_user_meta( get_current_user_id(), self::META_KEY, true )
		);
	}

	public function test_rejects_a_row_favorite_without_its_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$this->create_collection( 'people', 'People' );
		$row_id = $this->create_row( 'crtxt_people', 'Ada Lovelace' );

		$response = $this->set_favorites(
			array(
				array(
					'kind' => 'row',
					'id'   => $row_id,
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_document_target_invalid',
			$response->get_data()['code']
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
		update_post_meta( $kept_id, Collection::MODE_META_KEY, Collection::MODE_FULL_PAGE );
		update_post_meta( $deleted_id, Collection::MODE_META_KEY, Collection::MODE_FULL_PAGE );

		update_user_meta(
			$user_id,
			self::META_KEY,
			array(
				"collection:{$kept_id}",
				"collection:{$deleted_id}",
			)
		);

		wp_delete_post( $deleted_id, true );

		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $kept_id ),
			array_column( $response->get_data()['favorites'], 'id' )
		);
	}

	public function test_get_drops_stale_inline_collection_favorites(): void {
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
				"collection:{$full_id}",
				"collection:{$inline_id}",
			)
		);

		$response = $this->get_favorites();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( $full_id ),
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
			'post_type'   => Page::POST_TYPE,
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
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => '' === $title ? 'Test collection ' . wp_generate_uuid4() : $title,
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
