<?php
/**
 * Tests for Cortext\Rest\DocumentTrashController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Page;
use Cortext\PostType\Collection;
use Cortext\PostType\PageTrashCascade;
use Cortext\Rest\DocumentTrashController;
use WorDBless\BaseTestCase;
use WP_Query;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Document_Trash_Controller extends BaseTestCase {

	use InMemoryPostsQuery;

	public function set_up(): void {
		parent::set_up();

		( new Page() )->register_post_type();
		( new Collection() )->register_post_type();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_filters( 'wp_untrash_post_status' );

		$this->install_in_memory_posts_query();

		( new PageTrashCascade() )->register();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentTrashController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_routes_are_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/documents/trash', $routes );
		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/restore', $routes );
		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/permanent-delete', $routes );
	}

	public function test_trashed_documents_route_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->query_trashed_documents();

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_trashed_documents_lists_pages_and_rows(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page(
			array(
				'post_title'  => 'Trashed page',
				'post_parent' => 123,
			)
		);
		update_post_meta( $page_id, 'cortext_document_icon', '{"type":"emoji","value":"P"}' );
		update_post_meta( $page_id, PageTrashCascade::META_KEY, '99' );
		wp_trash_post( $page_id );

		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Albums',
				'meta_input'  => array( 'slug' => 'albums' ),
			)
		);
		$row_post_type = 'crtxt_albums';
		register_post_type(
			$row_post_type,
			array(
				'public'       => false,
				'show_in_rest' => true,
				'rest_base'    => $row_post_type,
				'supports'     => array( 'title', 'editor', 'custom-fields' ),
			)
		);
		add_post_type_support( $row_post_type, 'cortext-document' );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => $row_post_type,
				'post_status' => 'publish',
				'post_title'  => 'Trashed album',
				'post_name'   => 'trashed-album',
				'meta_input'  => array(
					'cortext_document_icon' => '{"type":"wp","name":"album"}',
				),
			)
		);
		wp_trash_post( $row_id );

		$published_row = (int) wp_insert_post(
			array(
				'post_type'   => $row_post_type,
				'post_status' => 'publish',
				'post_title'  => 'Visible album',
			)
		);
		$regular_post = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Regular post',
			)
		);
		wp_trash_post( $regular_post );

		$response = $this->query_trashed_documents();

		$this->assertSame( 200, $response->get_status() );
		$data      = $response->get_data();
		$documents = $data['documents'];
		$this->assertSame( 2, $data['total'] );
		$this->assertCount( 2, $documents );

		$by_id = array_column( $documents, null, 'id' );
		$this->assertArrayHasKey( $page_id, $by_id );
		$this->assertArrayHasKey( $row_id, $by_id );
		$this->assertArrayNotHasKey( $published_row, $by_id );
		$this->assertArrayNotHasKey( $regular_post, $by_id );

		$page = $by_id[ $page_id ];
		$this->assertSame( Page::POST_TYPE, $page['type'] );
		$this->assertSame( 'page', $page['kind'] );
		$this->assertSame( 'trash', $page['status'] );
		$this->assertSame( 123, $page['parent'] );
		$this->assertSame( 99, $page['meta'][ PageTrashCascade::META_KEY ] );

		$row = $by_id[ $row_id ];
		$this->assertSame( $row_post_type, $row['type'] );
		$this->assertSame( 'row', $row['kind'] );
		$this->assertSame( 'Trashed album', $row['title']['raw'] );
		$this->assertSame( '{"type":"wp","name":"album"}', $row['meta']['cortext_document_icon'] );
		$this->assertSame( $collection_id, $row['collection']['id'] );
		$this->assertSame( 'albums', $row['collection']['slug'] );
		$this->assertSame( 'Albums', $row['collection']['title']['raw'] );
	}

	public function test_trashed_documents_resolves_collection_once_per_row_post_type(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Cached albums',
				'meta_input'  => array( 'slug' => 'cachedalbums' ),
			)
		);

		$row_post_type = 'crtxt_cachedalbums';
		register_post_type(
			$row_post_type,
			array(
				'public'       => false,
				'show_in_rest' => true,
				'rest_base'    => $row_post_type,
				'supports'     => array( 'title', 'editor' ),
			)
		);
		add_post_type_support( $row_post_type, 'cortext-document' );

		foreach ( array( 'First trashed album', 'Second trashed album' ) as $title ) {
			$row_id = (int) wp_insert_post(
				array(
					'post_type'   => $row_post_type,
					'post_status' => 'publish',
					'post_title'  => $title,
				)
			);
			wp_trash_post( $row_id );
		}

		$collection_lookups = 0;
		$count_lookups      = static function ( $pre, WP_Query $query ) use ( &$collection_lookups ) {
			$vars = $query->query_vars;
			if (
				Collection::POST_TYPE === ( $vars['post_type'] ?? '' ) &&
				'slug' === ( $vars['meta_key'] ?? '' ) &&
				'cachedalbums' === ( $vars['meta_value'] ?? '' )
			) {
				++$collection_lookups;
			}

			return $pre;
		};
		add_filter( 'posts_pre_query', $count_lookups, 9, 2 );

		$response = $this->query_trashed_documents();

		remove_filter( 'posts_pre_query', $count_lookups, 9 );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 1, $collection_lookups );
	}

	public function test_restores_a_trashed_page_and_returns_its_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );
		$this->assertSame( 'trash', get_post_status( $page_id ) );

		$response = $this->restore( $page_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNotSame( 'trash', get_post_status( $page_id ) );

		$data = $response->get_data();
		$this->assertSame( array( $page_id ), $data['restored'] );
		// The freshly-untrashed post is included so the canvas can drop the
		// banner without a follow-up GET.
		$this->assertIsArray( $data['post'] );
		$this->assertSame( $page_id, $data['post']['id'] );
		$this->assertNotSame( 'trash', $data['post']['status'] );
	}

	public function test_returns_revived_descendants_in_restored_array(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$grandchild_id = $this->create_page( array( 'post_parent' => $child_id ) );

		wp_trash_post( $parent_id );

		$response = $this->restore( $parent_id );

		$this->assertSame( 200, $response->get_status() );
		$restored = $response->get_data()['restored'];
		$this->assertCount( 3, $restored );
		$this->assertContains( $parent_id, $restored );
		$this->assertContains( $child_id, $restored );
		$this->assertContains( $grandchild_id, $restored );
	}

	public function test_restore_omits_descendants_that_were_independently_trashed(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id  = $this->create_page();
		$sibling_id = $this->create_page();

		// Sibling lives in trash from its own delete, untagged.
		wp_trash_post( $sibling_id );
		wp_trash_post( $parent_id );

		$response = $this->restore( $parent_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $parent_id ), $response->get_data()['restored'] );
		$this->assertSame( 'trash', get_post_status( $sibling_id ), 'Independent trash should not be revived.' );
	}

	public function test_rejects_unknown_post_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->restore( 99999 );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_document_not_found', $response->get_data()['code'] );
	}

	public function test_rejects_non_document_post_type(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'A regular post',
			)
		);
		wp_trash_post( $post_id );

		$response = $this->restore( $post_id );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_document_not_found', $response->get_data()['code'] );
	}

	public function test_rejects_page_that_is_not_in_trash(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();

		$response = $this->restore( $page_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_document_not_trashed', $response->get_data()['code'] );
	}

	public function test_requires_delete_post_capability(): void {
		// Subscriber lacks delete_post on any post.
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );

		$response = $this->restore( $page_id );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_permanent_delete_removes_a_trashed_page(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );

		$response = $this->permanent_delete( $page_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $page_id ), $response->get_data()['deleted'] );
		$this->assertNull( get_post( $page_id ) );
	}

	public function test_permanent_delete_cascades_through_tagged_descendants(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$grandchild_id = $this->create_page( array( 'post_parent' => $child_id ) );

		wp_trash_post( $parent_id );

		$response = $this->permanent_delete( $parent_id );

		$this->assertSame( 200, $response->get_status() );
		$deleted = $response->get_data()['deleted'];
		$this->assertCount( 3, $deleted );
		$this->assertContains( $parent_id, $deleted );
		$this->assertContains( $child_id, $deleted );
		$this->assertContains( $grandchild_id, $deleted );

		// Parent is the last entry, so descendants are gone before WP's
		// hierarchical reparenting could fire on the parent's deletion.
		$this->assertSame( $parent_id, end( $deleted ) );

		$this->assertNull( get_post( $parent_id ) );
		$this->assertNull( get_post( $child_id ) );
		$this->assertNull( get_post( $grandchild_id ) );
	}

	public function test_permanent_delete_leaves_independently_trashed_siblings_alone(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id  = $this->create_page();
		$sibling_id = $this->create_page();

		wp_trash_post( $sibling_id );
		wp_trash_post( $parent_id );

		$this->permanent_delete( $parent_id );

		$this->assertSame( 'trash', get_post_status( $sibling_id ), 'Independently trashed sibling stays untouched.' );
	}

	public function test_permanent_delete_rejects_page_that_is_not_in_trash(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();

		$response = $this->permanent_delete( $page_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_document_not_trashed', $response->get_data()['code'] );
	}

	public function test_permanent_delete_requires_delete_post_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );

		$response = $this->permanent_delete( $page_id );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_permanent_delete_removes_a_trashed_row_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$row_post_type = 'crtxt_trashrow';
		register_post_type(
			$row_post_type,
			array(
				'public'       => false,
				'show_in_rest' => true,
				'rest_base'    => $row_post_type,
				'supports'     => array( 'title', 'editor' ),
			)
		);
		add_post_type_support( $row_post_type, 'cortext-document' );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => $row_post_type,
				'post_status' => 'publish',
				'post_title'  => 'A trashed row',
			)
		);
		wp_trash_post( $row_id );

		$response = $this->permanent_delete( $row_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $row_id ), $response->get_data()['deleted'] );
		$this->assertNull( get_post( $row_id ) );
	}

	public function test_restore_skips_cascade_walk_for_flat_row_documents(): void {
		// Row CPTs opt into cortext-document but have no hierarchy today, so
		// restore should only return the row itself.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$row_post_type = 'crtxt_widgets';
		register_post_type(
			$row_post_type,
			array(
				'public'       => false,
				'show_in_rest' => true,
				'rest_base'    => $row_post_type,
				'supports'     => array( 'title', 'editor' ),
			)
		);
		add_post_type_support( $row_post_type, 'cortext-document' );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => $row_post_type,
				'post_status' => 'publish',
				'post_title'  => 'A widget row',
			)
		);
		wp_trash_post( $row_id );

		$response = $this->restore( $row_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $row_id ), $response->get_data()['restored'] );
	}

	private function restore( int $id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $id . '/restore' );
		return rest_do_request( $request );
	}

	private function permanent_delete( int $id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $id . '/permanent-delete' );
		return rest_do_request( $request );
	}

	private function query_trashed_documents() {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/documents/trash' );
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
			'post_status' => 'publish',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		return (int) $id;
	}
}
