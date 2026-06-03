<?php
/**
 * Tests for Cortext\Rest\WorkspaceHomeController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Rest\WorkspaceHomeController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Workspace_Home_Controller extends BaseTestCase {

	use InMemoryTermStore;

	private const META_KEY = 'cortext_workspace_home';

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
		( new WorkspaceHomeController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_get_returns_null_when_no_home_is_set(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->get_home();

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['home'] );
	}

	public function test_sets_and_reads_a_page_home(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page(
			array(
				'post_name'  => 'daily-notes',
				'post_title' => 'Daily notes',
			)
		);

		$set_response = $this->set_home( $page_id );
		$get_response = $this->get_home();

		$home = $set_response->get_data()['home'];
		$this->assertSame( 200, $set_response->get_status() );
		$this->assertSame( $page_id, $home['id'] );
		$this->assertSame( "daily-notes-{$page_id}", $home['path'] );
		$this->assertSame( 'Daily notes', $home['title'] );
		$this->assertSame( $home, $get_response->get_data()['home'] );
		$this->assertSame(
			(string) $page_id,
			(string) get_user_meta( get_current_user_id(), self::META_KEY, true )
		);
	}

	public function test_sets_and_reads_a_collection_home(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'books' );

		$set_response = $this->set_home( $collection_id );
		$get_response = $this->get_home();

		$home = $set_response->get_data()['home'];
		$this->assertSame( 200, $set_response->get_status() );
		$this->assertSame( $collection_id, $home['id'] );
		$this->assertSame( "books-{$collection_id}", $home['path'] );
		$this->assertSame( $home, $get_response->get_data()['home'] );
	}

	public function test_legacy_kind_id_stored_meta_is_forward_migrated_on_read(): void {
		// Older builds stored the home as `"kind:id"`. The reader accepts
		// that shape and returns the resolved target.
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page(
			array(
				'post_name' => 'home',
			)
		);
		update_user_meta(
			get_current_user_id(),
			self::META_KEY,
			"page:{$page_id}"
		);

		$response = $this->get_home();

		$home = $response->get_data()['home'];
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $page_id, $home['id'] );
		$this->assertSame( "home-{$page_id}", $home['path'] );
	}

	public function test_home_is_stored_per_user(): void {
		$user_a = $this->create_user( 'administrator' );
		$user_b = $this->create_user( 'administrator' );
		wp_set_current_user( $user_a );
		$page_id = $this->create_page();

		$this->set_home( $page_id );

		wp_set_current_user( $user_b );
		$response = $this->get_home();

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['home'] );
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

		$response = $this->set_home( $post_id );

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
		$response = $this->set_home( $page_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame(
			'cortext_document_target_forbidden',
			$response->get_data()['code']
		);
	}

	public function test_get_returns_null_when_stored_home_is_trashed(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();
		$this->set_home( $page_id );

		wp_trash_post( $page_id );
		$response = $this->get_home();

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['home'] );
	}

	public function test_get_returns_null_when_stored_home_is_deleted(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();
		$this->set_home( $page_id );

		wp_delete_post( $page_id, true );
		$response = $this->get_home();

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['home'] );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->get_home();

		$this->assertSame( 403, $response->get_status() );
	}

	private function get_home() {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/workspace-home' );
		return rest_do_request( $request );
	}

	private function set_home( int $id ) {
		$request = new WP_REST_Request( 'PUT', '/cortext/v1/workspace-home' );
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

	private function create_collection( string $slug ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Test collection ' . wp_generate_uuid4(),
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
}
