<?php
/**
 * Tests for Cortext\Rest\PostLocksController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\Rest\PostLocksController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Post_Locks_Controller extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		require_once ABSPATH . 'wp-admin/includes/post.php';

		( new Document() )->register_post_type();
		( new DocumentIdentity() )->register();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new PostLocksController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/lock', $routes );
	}

	public function test_acquires_lock_when_document_is_unlocked(): void {
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		$post_id = $this->create_document();

		$response = $this->lock( $post_id );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $data['postLock']['isLocked'] );
		$this->assertStringContainsString( ':' . $user_id, $data['postLock']['activePostLock'] );
		$this->assertArrayHasKey( 'postLockUtils', $data );
		$this->assertStringContainsString( ':' . $user_id, (string) get_post_meta( $post_id, '_edit_lock', true ) );
	}

	public function test_returns_current_editor_when_locked_by_another_user(): void {
		$owner_id = $this->create_user( 'administrator', 'Current Editor' );
		$post_id  = $this->create_document();
		wp_set_current_user( $owner_id );
		wp_set_post_lock( $post_id );

		wp_set_current_user( $this->create_user( 'administrator', 'Second Editor' ) );
		$response = $this->lock( $post_id );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $data['postLock']['isLocked'] );
		$this->assertSame( 'Current Editor', $data['postLock']['user']['name'] );
		$this->assertStringContainsString( ':' . $owner_id, (string) get_post_meta( $post_id, '_edit_lock', true ) );
	}

	public function test_force_takes_over_lock_and_returns_fresh_post(): void {
		$owner_id = $this->create_user( 'administrator', 'Current Editor' );
		$post_id  = $this->create_document();
		wp_set_current_user( $owner_id );
		wp_set_post_lock( $post_id );

		$takeover_id = $this->create_user( 'administrator', 'Second Editor' );
		wp_set_current_user( $takeover_id );
		$response = $this->lock( $post_id, array( 'force' => true ) );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $data['postLock']['isLocked'] );
		$this->assertStringContainsString( ':' . $takeover_id, $data['postLock']['activePostLock'] );
		$this->assertSame( $post_id, $data['post']['id'] );
		$this->assertStringContainsString( ':' . $takeover_id, (string) get_post_meta( $post_id, '_edit_lock', true ) );
	}

	public function test_rejects_non_document_post_type(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'private',
				'post_title'  => 'Plain post',
			)
		);

		$response = $this->lock( $post_id );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_rejects_trashed_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = $this->create_document();
		wp_trash_post( $post_id );

		$response = $this->lock( $post_id );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_in_trash', $response->as_error()->get_error_code() );
	}

	public function test_rejects_user_without_edit_permission(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = $this->create_document();

		wp_set_current_user( $this->create_user( 'subscriber' ) );
		$response = $this->lock( $post_id );

		$this->assertSame( 403, $response->get_status() );
	}

	private function lock( int $post_id, array $params = array() ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $post_id . '/lock' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
		return rest_do_request( $request );
	}

	private function create_user( string $role, ?string $display_name = null ): int {
		$args = array(
			'user_login' => uniqid( 'cortext_', false ),
			'user_pass'  => 'password',
			'role'       => $role,
		);
		if ( null !== $display_name ) {
			$args['display_name'] = $display_name;
		}

		$user_id = (int) wp_insert_user( $args );

		$this->assertGreaterThan( 0, $user_id );
		return $user_id;
	}

	private function create_document(): int {
		$post_id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Test document ' . wp_generate_uuid4(),
			)
		);

		$this->assertIsInt( $post_id );
		$this->assertGreaterThan( 0, $post_id );
		return (int) $post_id;
	}
}
