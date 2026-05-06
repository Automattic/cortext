<?php
/**
 * REST endpoint for the current user's workspace home preference.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\PostType\Collection;
use Cortext\PostType\Page;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class WorkspaceHomeController {

	private const NAMESPACE = 'cortext/v1';
	private const META_KEY  = 'cortext_workspace_home';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/workspace-home',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_home' ),
					'permission_callback' => array( $this, 'can_read' ),
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( $this, 'update_home' ),
					'permission_callback' => array( $this, 'can_read' ),
					'args'                => array(
						'kind' => array(
							'type'     => 'string',
							'required' => true,
							'enum'     => array( 'page', 'collection' ),
						),
						'id'   => array(
							'type'     => 'integer',
							'required' => true,
							'minimum'  => 1,
						),
					),
				),
			)
		);
	}

	public function can_read(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function get_home(): WP_REST_Response {
		$home = $this->resolve_stored_home( get_current_user_id() );

		return new WP_REST_Response(
			array(
				'home' => $home,
			),
			200
		);
	}

	public function update_home( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$kind = (string) $request->get_param( 'kind' );
		$id   = (int) $request->get_param( 'id' );

		$home = $this->format_target( $kind, $id, true );
		if ( is_wp_error( $home ) ) {
			return $home;
		}

		update_user_meta( get_current_user_id(), self::META_KEY, "{$kind}:{$id}" );

		return new WP_REST_Response(
			array(
				'home' => $home,
			),
			200
		);
	}

	private function resolve_stored_home( int $user_id ): ?array {
		$raw = get_user_meta( $user_id, self::META_KEY, true );
		if ( ! is_string( $raw ) || '' === $raw ) {
			return null;
		}

		$parts = explode( ':', $raw, 2 );
		if ( 2 !== count( $parts ) ) {
			return null;
		}

		$home = $this->format_target( $parts[0], (int) $parts[1], true );
		return is_wp_error( $home ) ? null : $home;
	}

	/**
	 * Formats a page or collection target into the shell route contract.
	 *
	 * @param string $kind Target kind.
	 * @param int    $id Target post ID.
	 * @param bool   $require_edit Whether to enforce edit_post capability.
	 * @return array{kind:string,id:int,path:string}|WP_Error
	 */
	private function format_target( string $kind, int $id, bool $require_edit ) {
		if ( ! in_array( $kind, array( 'page', 'collection' ), true ) || $id < 1 ) {
			return new WP_Error(
				'cortext_workspace_home_invalid_target',
				__( 'Workspace home target is invalid.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$post = get_post( $id );
		if ( ! $this->is_supported_target( $post, $kind ) ) {
			return new WP_Error(
				'cortext_workspace_home_not_found',
				__( 'Workspace home target was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( $require_edit && ! current_user_can( 'edit_post', $id ) ) {
			return new WP_Error(
				'cortext_workspace_home_forbidden',
				__( 'You are not allowed to use this target as your workspace home.', 'cortext' ),
				array( 'status' => 403 )
			);
		}

		return array(
			'kind' => $kind,
			'id'   => $id,
			'path' => $this->target_path( $post, $kind ),
		);
	}

	private function is_supported_target( ?WP_Post $post, string $kind ): bool {
		if ( ! $post || 'trash' === $post->post_status ) {
			return false;
		}

		$type = 'page' === $kind ? Page::POST_TYPE : Collection::POST_TYPE;
		return $type === $post->post_type;
	}

	private function target_path( WP_Post $post, string $kind ): string {
		if ( 'collection' === $kind ) {
			$slug = get_post_meta( (int) $post->ID, 'slug', true );
			$slug = is_string( $slug ) ? trim( $slug ) : '';
		} else {
			$slug = trim( $post->post_name );
		}

		$tail = '' === $slug ? (string) $post->ID : "{$slug}-{$post->ID}";
		return "{$kind}/{$tail}";
	}
}
