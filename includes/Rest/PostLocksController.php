<?php
/**
 * REST endpoint for locking Cortext documents.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class PostLocksController {

	private const NAMESPACE = 'cortext/v1';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/lock',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'lock' ),
					'permission_callback' => array( $this, 'can_lock' ),
					'args'                => array(
						'id'    => array(
							'type'     => 'integer',
							'required' => true,
						),
						'force' => array(
							'type'    => 'boolean',
							'default' => false,
						),
					),
				),
			)
		);
	}

	/**
	 * Permission check for the lock endpoint.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 *
	 * @return bool|WP_Error
	 */
	public function can_lock( WP_REST_Request $request ) {
		$post = get_post( (int) $request->get_param( 'id' ) );
		if ( ! $post instanceof WP_Post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return current_user_can( 'edit_post', (int) $post->ID );
	}

	public function lock( WP_REST_Request $request ) {
		$this->ensure_post_lock_functions();

		$post_id = (int) $request->get_param( 'id' );
		$post    = get_post( $post_id );
		if ( ! $post instanceof WP_Post ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( 'trash' === $post->post_status ) {
			return new WP_Error(
				'cortext_document_in_trash',
				__(
					'Move this document out of Trash before editing it.',
					'cortext'
				),
				array( 'status' => 409 )
			);
		}

		$force          = rest_sanitize_boolean( $request->get_param( 'force' ) );
		$locked_user_id = $force ? false : wp_check_post_lock( $post_id );
		if ( $locked_user_id ) {
			return new WP_REST_Response(
				array(
					'postLock'      => $this->locked_post_lock( (int) $locked_user_id ),
					'postLockUtils' => $this->post_lock_utils( $post_id ),
				),
				200
			);
		}

		$active_post_lock = wp_set_post_lock( $post_id );
		if ( ! $active_post_lock ) {
			return new WP_Error(
				'cortext_document_lock_failed',
				__( "Couldn't lock this document.", 'cortext' ),
				array( 'status' => 500 )
			);
		}

		$data = array(
			'postLock'      => array(
				'isLocked'       => false,
				'activePostLock' => esc_attr( implode( ':', $active_post_lock ) ),
			),
			'postLockUtils' => $this->post_lock_utils( $post_id ),
		);

		if ( $force ) {
			$fresh_post = get_post( $post_id );
			if ( $fresh_post instanceof WP_Post ) {
				$data['post'] = $this->prepare_post_for_response( $fresh_post );
			}
		}

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Builds the locked postLock object expected by core/editor.
	 *
	 * @param int $user_id Lock owner's user id.
	 *
	 * @return array<string,mixed>
	 */
	private function locked_post_lock( int $user_id ): array {
		$user = get_userdata( $user_id );
		$lock = array(
			'isLocked' => true,
			'user'     => array(
				'name' => $user ? $user->display_name : __( 'Someone', 'cortext' ),
			),
		);

		if ( $user && get_option( 'show_avatars' ) ) {
			$lock['user']['avatar'] = get_avatar_url( $user_id, array( 'size' => 128 ) );
		}

		return $lock;
	}

	/**
	 * Builds the nonce and AJAX URL bundle used by core/editor lock code.
	 *
	 * @param int $post_id Post id.
	 *
	 * @return array<string,string>
	 */
	private function post_lock_utils( int $post_id ): array {
		return array(
			'nonce'       => wp_create_nonce( 'lock-post_' . $post_id ),
			'unlockNonce' => wp_create_nonce( 'update-post_' . $post_id ),
			'ajaxUrl'     => admin_url( 'admin-ajax.php' ),
		);
	}

	private function ensure_post_lock_functions(): void {
		if ( function_exists( 'wp_check_post_lock' ) && function_exists( 'wp_set_post_lock' ) ) {
			return;
		}

		require_once ABSPATH . 'wp-admin/includes/post.php';
	}

	/**
	 * Builds a fresh core REST post payload after takeover.
	 *
	 * @param WP_Post $post Post to prepare.
	 *
	 * @return array<string,mixed>|null
	 */
	private function prepare_post_for_response( WP_Post $post ): ?array {
		$post_type = get_post_type_object( $post->post_type );
		if ( ! $post_type || ! $post_type->show_in_rest ) {
			return null;
		}

		$controller = $post_type->get_rest_controller();
		if ( ! $controller || ! method_exists( $controller, 'prepare_item_for_response' ) ) {
			return null;
		}

		$request = new WP_REST_Request( 'GET', rest_get_route_for_post( $post ) );
		$request->set_param( 'context', 'edit' );
		$response = $controller->prepare_item_for_response( $post, $request );

		return rest_get_server()->response_to_data( $response, false );
	}
}
