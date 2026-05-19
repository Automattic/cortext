<?php
/**
 * Tests for Cortext\Rest\WorkspaceHomeController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\Page;
use Cortext\Rest\WorkspaceHomeController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Workspace_Home_Controller extends BaseTestCase {

	private const META_KEY = 'cortext_workspace_home';

	public function set_up(): void {
		parent::set_up();

		( new Page() )->register_post_type();
		( new Collection() )->register_post_type();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new WorkspaceHomeController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
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
				'post_name' => 'daily-notes',
			)
		);

		$set_response = $this->set_home( 'page', $page_id );
		$get_response = $this->get_home();

		$expected = array(
			'kind' => 'page',
			'id'   => $page_id,
			'path' => "page/daily-notes-{$page_id}",
		);
		$this->assertSame( 200, $set_response->get_status() );
		$this->assertSame( $expected, $set_response->get_data()['home'] );
		$this->assertSame( $expected, $get_response->get_data()['home'] );
		$this->assertSame(
			"page:{$page_id}",
			get_user_meta( get_current_user_id(), self::META_KEY, true )
		);
	}

	public function test_sets_and_reads_a_collection_home(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'books' );

		$set_response = $this->set_home( 'collection', $collection_id );
		$get_response = $this->get_home();

		$expected = array(
			'kind' => 'collection',
			'id'   => $collection_id,
			'path' => "collection/books-{$collection_id}",
		);
		$this->assertSame( 200, $set_response->get_status() );
		$this->assertSame( $expected, $set_response->get_data()['home'] );
		$this->assertSame( $expected, $get_response->get_data()['home'] );
	}

	public function test_home_is_stored_per_user(): void {
		$user_a = $this->create_user( 'administrator' );
		$user_b = $this->create_user( 'administrator' );
		wp_set_current_user( $user_a );
		$page_id = $this->create_page();

		$this->set_home( 'page', $page_id );

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

		$response = $this->set_home( 'page', $post_id );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame(
			'cortext_workspace_home_not_found',
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
		$response = $this->set_home( 'page', $page_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame(
			'cortext_workspace_home_forbidden',
			$response->get_data()['code']
		);
	}

	public function test_get_returns_null_when_stored_home_is_trashed(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();
		$this->set_home( 'page', $page_id );

		wp_trash_post( $page_id );
		$response = $this->get_home();

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['home'] );
	}

	public function test_get_returns_null_when_stored_home_is_deleted(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();
		$this->set_home( 'page', $page_id );

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

	public function test_rejects_setting_inline_collection_as_home(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'hidden' );
		update_post_meta( $collection_id, Collection::MODE_META_KEY, Collection::MODE_INLINE );

		$response = $this->set_home( 'collection', $collection_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_workspace_home_inline_collection',
			$response->get_data()['code']
		);
	}

	public function test_get_returns_null_when_stored_home_points_to_inline_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'visible' );
		update_post_meta( $collection_id, Collection::MODE_META_KEY, Collection::MODE_FULL_PAGE );

		$this->set_home( 'collection', $collection_id );

		// Defensive case: if a stored home becomes inline, reads collapse to
		// null instead of sending users to a missing route.
		update_post_meta( $collection_id, Collection::MODE_META_KEY, Collection::MODE_INLINE );

		$response = $this->get_home();

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['home'] );
	}

	private function get_home() {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/workspace-home' );
		return rest_do_request( $request );
	}

	private function set_home( string $kind, int $id ) {
		$request = new WP_REST_Request( 'PUT', '/cortext/v1/workspace-home' );
		$request->set_body_params(
			array(
				'kind' => $kind,
				'id'   => $id,
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

	private function create_collection( string $slug ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Test collection ' . wp_generate_uuid4(),
				'meta_input'  => array(
					'slug' => $slug,
				),
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		return (int) $id;
	}
}
