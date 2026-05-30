<?php
/**
 * Tests for the trash mutation routes on Cortext\Rest\DocumentsController.
 *
 * Read tests (GET /cortext/v1/documents) live in
 * test-rest-documents-controller.php; this file owns restore and
 * permanent-delete because they need the trash cascade engine fixture.
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

final class Test_Rest_Documents_Controller_Mutations extends BaseTestCase {

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

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_filters( 'wp_untrash_post_status' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		( new TrashCascade() )->register();

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

	public function test_routes_are_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/restore', $routes );
		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/permanent-delete', $routes );
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

		$collection_id = $this->create_full_page_collection( 'trashrow' );
		$row_id        = $this->create_row( $collection_id );
		wp_trash_post( $row_id );

		$response = $this->permanent_delete( $row_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $row_id ), $response->get_data()['deleted'] );
		$this->assertNull( get_post( $row_id ) );
	}

	public function test_trash_response_lists_cascade_deleted_descendants(): void {
		// The sidebar uses this list to drop favorites without re-walking the
		// page tree. Without it, the client carries that knowledge.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$grandchild_id = $this->create_page( array( 'post_parent' => $child_id ) );

		$inline_collection_id = $this->create_full_page_collection( 'inline' );
		wp_update_post(
			array(
				'ID'          => $inline_collection_id,
				'post_parent' => $parent_id,
			)
		);

		$request  = new WP_REST_Request( 'DELETE', '/wp/v2/crtxt_documents/' . $parent_id );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertArrayHasKey( 'cascade_deleted', $data );
		$this->assertIsArray( $data['cascade_deleted'] );
		$this->assertContains( $child_id, $data['cascade_deleted'] );
		$this->assertContains( $grandchild_id, $data['cascade_deleted'] );
		$this->assertContains(
			$inline_collection_id,
			$data['cascade_deleted'],
			'Collections owned by the trashed page belong in the cascade response.'
		);
	}

	public function test_restores_a_trashed_full_page_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'restorable' );
		wp_trash_post( $collection_id );
		$this->assertSame( 'trash', get_post_status( $collection_id ) );

		$response = $this->restore( $collection_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNotSame( 'trash', get_post_status( $collection_id ) );
		$this->assertSame( array( $collection_id ), $response->get_data()['restored'] );
	}

	public function test_permanent_delete_removes_a_trashed_collection_and_its_rows(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'wipeable' );
		$row_id        = $this->create_row( $collection_id );
		wp_trash_post( $collection_id );

		// The cascade has to walk rows on permanent delete even if the trait
		// term lookup briefly fails.
		$response = $this->permanent_delete( $collection_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( get_post( $collection_id ) );
		$this->assertNull( get_post( $row_id ), 'Rows go with their collection on permanent delete.' );
	}

	public function test_permanent_delete_response_includes_cascaded_row_ids(): void {
		// Without this, the sidebar can't tell that an open row from the
		// deleted collection is gone and the canvas stays on a phantom URL.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'reported' );
		$row_id        = $this->create_row( $collection_id );
		wp_trash_post( $collection_id );

		$response = $this->permanent_delete( $collection_id );

		$this->assertSame( 200, $response->get_status() );
		$deleted = $response->get_data()['deleted'];
		$this->assertContains( $collection_id, $deleted );
		$this->assertContains(
			$row_id,
			$deleted,
			'The response must list rows deleted by the collection-to-row cascade so the sidebar can navigate away from them.'
		);
	}

	public function test_restore_skips_cascade_walk_for_flat_row_documents(): void {
		// A row that is just a `crtxt_document` with a trait term and no
		// nested documents should come back on its own.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'widgets' );
		$row_id        = $this->create_row( $collection_id );
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
			'post_status' => 'publish',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		return (int) $id;
	}

	private function create_full_page_collection( string $slug ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . $slug,
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

	private function create_row( int $collection_id ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Row ' . wp_generate_uuid4(),
			)
		);
		$this->assertGreaterThan( 0, $id );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

		return $id;
	}
}
