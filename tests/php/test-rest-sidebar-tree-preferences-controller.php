<?php
/**
 * Tests for Cortext\Rest\SidebarTreePreferencesController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\Rest\SidebarTreePreferencesController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Sidebar_Tree_Preferences_Controller extends BaseTestCase {

	use InMemoryTermStore;

	private const META_KEY = 'cortext_sidebar_expanded_documents';

	private int $admin_id;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		$trait_taxonomy = new TraitTaxonomy();
		$trait_taxonomy->register_taxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		$this->install_in_memory_term_store();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new SidebarTreePreferencesController() )->register();
		do_action( 'rest_api_init' );

		$this->admin_id = $this->create_user( 'administrator' );
		wp_set_current_user( $this->admin_id );
	}

	public function tear_down(): void {
		delete_user_meta( $this->admin_id, self::META_KEY );
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_registers_route(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/sidebar-tree-preferences', $routes );
	}

	public function test_get_returns_empty_list_when_no_expanded_documents_are_set(): void {
		$response = $this->get_preferences();

		$this->assertSame( array(), $response->get_data()['expanded'] );
	}

	public function test_saves_expanded_documents_per_user(): void {
		$page_id       = $this->create_document( 'Tree page' );
		$collection_id = $this->create_document( 'Tree collection' );
		add_post_meta( $collection_id, 'cortext_fields', '1' );

		$set_response = $this->set_preferences(
			array( $page_id, $collection_id, $page_id )
		);

		$this->assertSame( array( $page_id, $collection_id ), $set_response->get_data()['expanded'] );
		$this->assertSame(
			array( $page_id, $collection_id ),
			$this->get_preferences()->get_data()['expanded']
		);

		$other_user = $this->create_user( 'administrator' );
		wp_set_current_user( $other_user );
		$this->assertSame( array(), $this->get_preferences()->get_data()['expanded'] );
		wp_set_current_user( $this->admin_id );
	}

	public function test_rejects_rows_and_documents_outside_the_tree(): void {
		$valid_page = $this->create_document( 'Valid page' );
		$row_id     = $this->create_document( 'Row' );
		wp_set_object_terms( $row_id, array( 'collection-slug' ), TraitTaxonomy::TAXONOMY );

		$trashed_id = $this->create_document( 'Trashed page', array( 'post_status' => 'trash' ) );

		$response = $this->set_preferences( array( $valid_page, $row_id, $trashed_id ) );

		$this->assertSame( array( $valid_page ), $response->get_data()['expanded'] );
	}

	public function test_get_removes_invalid_stored_ids(): void {
		$valid_page = $this->create_document( 'Valid page' );
		update_user_meta( $this->admin_id, self::META_KEY, array( $valid_page, 999999 ) );

		$response = $this->get_preferences();

		$this->assertSame( array( $valid_page ), $response->get_data()['expanded'] );
		$this->assertSame(
			array( $valid_page ),
			get_user_meta( $this->admin_id, self::META_KEY, true )
		);
	}

	public function test_rejects_missing_expanded_payload(): void {
		$request = new WP_REST_Request( 'PUT', '/cortext/v1/sidebar-tree-preferences' );

		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	private function get_preferences() {
		return rest_do_request( new WP_REST_Request( 'GET', '/cortext/v1/sidebar-tree-preferences' ) );
	}

	private function set_preferences( array $expanded ) {
		$request = new WP_REST_Request( 'PUT', '/cortext/v1/sidebar-tree-preferences' );
		$request->set_param( 'expanded', $expanded );
		return rest_do_request( $request );
	}

	private function create_document( string $title, array $args = array() ): int {
		return (int) wp_insert_post(
			array_merge(
				array(
					'post_type'   => Document::POST_TYPE,
					'post_status' => 'publish',
					'post_title'  => $title,
				),
				$args
			)
		);
	}

	private function create_user( string $role ): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'sidebar_tree_user_', true ),
				'user_pass'  => 'password',
				'user_email' => uniqid( 'sidebar-tree-user-', true ) . '@example.test',
				'role'       => $role,
			)
		);
	}
}
