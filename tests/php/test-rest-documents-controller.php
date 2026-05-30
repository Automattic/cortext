<?php
/**
 * Tests for Cortext\Rest\DocumentsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Rest\DocumentsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Documents_Controller extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new DocumentIdentity() )->register();
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
		( new DocumentsController() )->register();
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
		$this->assertArrayHasKey( '/cortext/v1/documents', $routes );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->query();

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_returns_pages_and_rows_with_excerpts(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$page_id       = $this->create_page(
			array(
				'post_title'   => 'Welcome',
				'post_name'    => 'welcome',
				'post_content' => 'The quick brown fox.',
			)
		);
		$row_id        = $this->create_row( $collection_id, 'Launch plan' );

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
		$this->assertSame( 'Welcome', $by_id[ $page_id ]['title'] );
		$this->assertStringContainsString( 'quick brown fox', $by_id[ $page_id ]['excerpt'] );

		$this->assertArrayHasKey( $row_id, $by_id );
		$this->assertSame( 'Projects', $by_id[ $row_id ]['collection']['title'] );
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

	public function test_status_trash_lists_pages_and_rows_with_trash_metadata(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection( 'albums', 'Albums' );
		$page_id       = $this->create_page(
			array(
				'post_title'  => 'Trashed page',
				'post_parent' => 123,
				'meta_input'  => array(
					DocumentIdentity::META_KEY => '{"type":"emoji","value":"P"}',
					TrashCascade::PARENT_MARKER_META => '99',
				),
			)
		);
		wp_trash_post( $page_id );

		$row_id = $this->create_row( $collection_id, 'Trashed album' );
		wp_trash_post( $row_id );

		$visible_page = $this->create_page( array( 'post_title' => 'Still here' ) );

		$response = $this->query( array( 'status' => 'trash' ) );

		$this->assertSame( 200, $response->get_status() );
		$by_id = array_column( $response->get_data()['documents'], null, 'id' );

		$this->assertArrayHasKey( $page_id, $by_id );
		$this->assertArrayHasKey( $row_id, $by_id );
		$this->assertArrayNotHasKey( $visible_page, $by_id );

		$page = $by_id[ $page_id ];
		$this->assertSame( 123, $page['parent'] );
		$this->assertSame( 99, $page['meta'][ TrashCascade::PARENT_MARKER_META ] );
		$this->assertSame( '{"type":"emoji","value":"P"}', $page['meta']['cortext_document_icon'] );

		$row = $by_id[ $row_id ];
		$this->assertSame( $collection_id, $row['collection']['id'] );
		$this->assertSame( 'Albums', $row['collection']['title'] );
	}

	public function test_status_trash_surfaces_parent_marker_on_nested_collections(): void {
		// Without this marker in the response, the sidebar can't tell which
		// collection was trashed by which owner page, so the entries would
		// render as roots instead of nesting under their owner page.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$owner_page = $this->create_page( array( 'post_title' => 'Owner' ) );
		$nested_id  = $this->create_collection( 'action-items', 'Action items' );
		// Sit the trashed collection underneath the owner page so the cascade
		// marker has a counterpart in the page tree.
		wp_update_post(
			array(
				'ID'          => $nested_id,
				'post_parent' => $owner_page,
			)
		);
		update_post_meta(
			$nested_id,
			TrashCascade::PARENT_MARKER_META,
			$owner_page
		);
		wp_trash_post( $nested_id );

		$response = $this->query( array( 'status' => 'trash' ) );

		$by_id = array_column( $response->get_data()['documents'], null, 'id' );
		$this->assertArrayHasKey( $nested_id, $by_id );
		$this->assertSame(
			$owner_page,
			$by_id[ $nested_id ]['meta'][ TrashCascade::PARENT_MARKER_META ]
		);
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
