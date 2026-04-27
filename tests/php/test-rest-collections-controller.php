<?php
/**
 * Tests for Cortext\Rest\CollectionsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\Rest\CollectionsController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Collections_Controller extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new CollectionsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_creates_collection_and_registers_row_cpt_from_title(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title' => 'Project Tasks',
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$data          = $response->get_data();
		$collection_id = (int) $data['id'];

		$this->assertSame( 'project-tasks', $data['slug'] );
		$this->assertSame( 'crtxt_project-tasks', $data['restBase'] );
		$this->assertTrue( post_type_exists( 'crtxt_project-tasks' ) );
		$this->assertSame( 'Project Tasks', get_post( $collection_id )->post_title );
		$this->assertSame( 'project-tasks', get_post_meta( $collection_id, 'slug', true ) );
		$this->assertSame( array(), get_post_meta( $collection_id, 'fields', false ) );
	}

	public function test_auto_suffixes_conflicting_slug_within_cpt_limit(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Existing',
				'meta_input'  => array( 'slug' => 'abcdefghijklmn' ),
			)
		);
		register_post_type( 'crtxt_abcdefghijklmn' );

		$response = $this->create_collection(
			array(
				'title' => 'abcdefghijklmnop',
			)
		);

		$data = $response->get_data();

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'abcdefghijkl-2', $data['slug'] );
		$this->assertLessThanOrEqual(
			CollectionEntries::MAX_CPT_LEN,
			strlen( CollectionEntries::CPT_PREFIX . $data['slug'] )
		);
		$this->assertTrue( post_type_exists( 'crtxt_abcdefghijkl-2' ) );
	}

	public function test_ignores_slug_and_fields_request_params(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title'  => 'Reading List',
				'slug'   => 'ignored',
				'fields' => array( 'Ignored Field' ),
			)
		);

		$data          = $response->get_data();
		$collection_id = (int) $data['id'];

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'reading-list', $data['slug'] );
		$this->assertSame( array(), get_post_meta( $collection_id, 'fields', false ) );
		$this->assertTrue( post_type_exists( 'crtxt_reading-list' ) );
	}

	public function test_auto_suffixes_reserved_slug(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title' => 'Page',
			)
		);

		$data = $response->get_data();

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'page-2', $data['slug'] );
		$this->assertTrue( post_type_exists( 'crtxt_page-2' ) );
	}

	public function test_rejects_empty_title(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title' => ' ',
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->create_collection(
			array(
				'title' => 'People',
			)
		);

		$this->assertSame( 403, $response->get_status() );
	}

	private function create_collection( array $body ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/collections' );
		$request->set_body_params( $body );

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

	private function unregister_dynamic_collection_post_types(): void {
		foreach ( get_post_types() as $post_type ) {
			if (
				str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) &&
				! in_array( $post_type, array( Collection::POST_TYPE, Field::POST_TYPE ), true )
			) {
				unregister_post_type( $post_type );
			}
		}
	}
}
