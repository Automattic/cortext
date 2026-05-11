<?php
/**
 * Tests for Cortext\Rest\DocumentLocatorController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Page;
use Cortext\Rest\DocumentLocatorController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Document_Locator_Controller extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		( new Page() )->register_post_type();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentLocatorController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_returns_id_type_rest_base_and_slug_for_a_page_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = (int) wp_insert_post(
			array(
				'post_type'   => Page::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'About us',
				'post_name'   => 'about-us',
			)
		);

		$response = $this->locate( $page_id );

		$this->assertSame( 200, $response->get_status() );
		// Pages have rest_base `crtxt_pages` but post_type `crtxt_page`,
		// so the locator returns rest_base separately for the JS resolver
		// to build `/wp/v2/crtxt_pages/<id>` correctly.
		$this->assertSame(
			array(
				'id'        => $page_id,
				'type'      => Page::POST_TYPE,
				'rest_base' => 'crtxt_pages',
				'slug'      => 'about-us',
			),
			$response->get_data()
		);
	}

	public function test_returns_dynamic_post_type_for_row_documents(): void {
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
		DocumentIdentity::register_for_post_type( $row_post_type );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => $row_post_type,
				'post_status' => 'publish',
				'post_title'  => 'A widget',
				'post_name'   => 'a-widget',
			)
		);

		$response = $this->locate( $row_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $row_post_type, $response->get_data()['type'] );
		$this->assertSame( $row_post_type, $response->get_data()['rest_base'] );
		$this->assertSame( 'a-widget', $response->get_data()['slug'] );
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
