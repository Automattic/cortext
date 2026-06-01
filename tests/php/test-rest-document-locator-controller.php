<?php
/**
 * Tests for Cortext\Rest\DocumentLocatorController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\Rest\DocumentLocatorController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Document_Locator_Controller extends BaseTestCase {

	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );

		$this->install_in_memory_term_store();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentLocatorController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_returns_id_type_rest_base_and_slug_for_a_page_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'About us',
				'post_name'   => 'about-us',
			)
		);

		$response = $this->locate( $page_id );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( $page_id, $data['id'] );
		$this->assertSame( Document::POST_TYPE, $data['type'] );
		$this->assertSame( 'crtxt_documents', $data['rest_base'] );
		$this->assertSame( 'about-us', $data['slug'] );
		$this->assertSame( array(), $data['trait_ids'] );
	}

	public function test_404s_for_unknown_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->locate( 99999 );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_document_not_found', $response->get_data()['code'] );
	}

	public function test_404s_for_non_document_post_types(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'A regular post',
			)
		);

		$response = $this->locate( $post_id );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_document_not_found', $response->get_data()['code'] );
	}

	private function locate( int $id ) {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/documents/' . $id );
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
}
