<?php
/**
 * Tests for Cortext\Rest\DocumentsController.
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
use Cortext\PostType\PageTrashCascade;
use Cortext\Rest\DocumentsController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Documents_Controller extends BaseTestCase {

	use InMemoryPostsQuery;

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Page() )->register_post_type();
		( new DocumentIdentity() )->register();
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();

		$this->install_in_memory_posts_query();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/cortext/v1/documents', $routes );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->query();

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_returns_pages_and_rows_with_excerpts(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$this->create_collection( 'projects', 'Projects' );
		$page_id = $this->create_page(
			array(
				'post_title'   => 'Welcome',
				'post_name'    => 'welcome',
				'post_content' => 'The quick brown fox.',
			)
		);
		$row_id  = $this->create_row( 'crtxt_projects', 'Launch plan' );

		$response = $this->query();

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertArrayHasKey( 'documents', $data );
		$this->assertArrayHasKey( 'total', $data );

		$by_id = array();
		foreach ( $data['documents'] as $document ) {
			$by_id[ $document['id'] ] = $document;
		}

		$this->assertArrayHasKey( $page_id, $by_id );
		$this->assertSame( 'page', $by_id[ $page_id ]['kind'] );
		$this->assertSame( 'Welcome', $by_id[ $page_id ]['title'] );
		$this->assertStringContainsString( 'quick brown fox', $by_id[ $page_id ]['excerpt'] );

		$this->assertArrayHasKey( $row_id, $by_id );
		$this->assertSame( 'row', $by_id[ $row_id ]['kind'] );
		$this->assertSame( 'Projects', $by_id[ $row_id ]['collection']['title'] );
	}

	public function test_filters_by_kind(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$this->create_collection( 'projects', 'Projects' );
		$page_id = $this->create_page( array( 'post_title' => 'Welcome' ) );
		$row_id  = $this->create_row( 'crtxt_projects', 'Launch plan' );

		$pages_only = $this->query( array( 'kind' => 'page' ) )->get_data();
		$rows_only  = $this->query( array( 'kind' => 'row' ) )->get_data();

		$page_ids = array_column( $pages_only['documents'], 'id' );
		$row_ids  = array_column( $rows_only['documents'], 'id' );

		$this->assertContains( $page_id, $page_ids );
		$this->assertNotContains( $row_id, $page_ids );
		$this->assertContains( $row_id, $row_ids );
		$this->assertNotContains( $page_id, $row_ids );
	}

	public function test_matches_search(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$match     = $this->create_page( array( 'post_title' => 'Quarterly report' ) );
		$unrelated = $this->create_page( array( 'post_title' => 'Unrelated' ) );

		$response = $this->query( array( 'search' => 'quarterly' ) );

		$ids = array_column( $response->get_data()['documents'], 'id' );
		$this->assertContains( $match, $ids );
		$this->assertNotContains( $unrelated, $ids );
	}

	public function test_rejects_invalid_kind(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->query( array( 'kind' => 'wat' ) );

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_status_trash_lists_pages_and_rows_with_trash_metadata(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection( 'albums', 'Albums' );
		$page_id       = $this->create_page(
			array(
				'post_title'  => 'Trashed page',
				'post_parent' => 123,
				'meta_input'  => array(
					DocumentIdentity::META_KEY => '{"type":"emoji","value":"P"}',
					PageTrashCascade::META_KEY => '99',
				),
			)
		);
		wp_trash_post( $page_id );

		$row_id = $this->create_row( 'crtxt_albums', 'Trashed album' );
		wp_trash_post( $row_id );

		$visible_page = $this->create_page( array( 'post_title' => 'Still here' ) );

		$response = $this->query( array( 'status' => 'trash' ) );

		$this->assertSame( 200, $response->get_status() );
		$by_id = array_column( $response->get_data()['documents'], null, 'id' );

		$this->assertArrayHasKey( $page_id, $by_id );
		$this->assertArrayHasKey( $row_id, $by_id );
		$this->assertArrayNotHasKey( $visible_page, $by_id );

		$page = $by_id[ $page_id ];
		$this->assertSame( 'page', $page['kind'] );
		$this->assertSame( 123, $page['parent'] );
		$this->assertSame( 99, $page['meta'][ PageTrashCascade::META_KEY ] );
		$this->assertSame( '{"type":"emoji","value":"P"}', $page['meta']['cortext_document_icon'] );

		$row = $by_id[ $row_id ];
		$this->assertSame( 'row', $row['kind'] );
		$this->assertSame( $collection_id, $row['collection']['id'] );
		$this->assertSame( 'Albums', $row['collection']['title'] );
	}

	public function test_status_trash_excerpt_is_excluded(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page( array( 'post_title' => 'Trashed' ) );
		wp_trash_post( $page_id );

		$response = $this->query( array( 'status' => 'trash' ) );

		$by_id = array_column( $response->get_data()['documents'], null, 'id' );
		$this->assertArrayHasKey( $page_id, $by_id );
		// Trash lists carry trash metadata; excerpts are only for live
		// document lists.
		$this->assertArrayHasKey( 'meta', $by_id[ $page_id ] );
		$this->assertArrayNotHasKey( 'excerpt', $by_id[ $page_id ] );
	}

	public function test_default_listing_excludes_trashed_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$live    = $this->create_page( array( 'post_title' => 'Live' ) );
		$trashed = $this->create_page( array( 'post_title' => 'Trashed' ) );
		wp_trash_post( $trashed );

		$ids = array_column( $this->query()->get_data()['documents'], 'id' );

		$this->assertContains( $live, $ids );
		$this->assertNotContains( $trashed, $ids );
	}

	private function query( array $params = array() ) {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/documents' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
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
