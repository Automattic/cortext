<?php
/**
 * REST endpoint for the current user's workspace home preference.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Documents;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class WorkspaceHomeController {

	private const NAMESPACE = 'cortext/v1';
	private const META_KEY  = 'cortext_workspace_home';

	private Documents $documents;

	public function __construct( ?Documents $documents = null ) {
		$this->documents = $documents ?? new Documents();
	}

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
						'id' => array(
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
		$id = (int) $request->get_param( 'id' );

		$home = $this->resolve_home_target( $id );
		if ( is_wp_error( $home ) ) {
			return $home;
		}

		update_user_meta( get_current_user_id(), self::META_KEY, (int) $home['id'] );

		return new WP_REST_Response(
			array(
				'home' => $home,
			),
			200
		);
	}

	private function resolve_stored_home( int $user_id ): ?array {
		$raw = get_user_meta( $user_id, self::META_KEY, true );
		$id  = $this->stored_entry_id( $raw );
		if ( $id < 1 ) {
			return null;
		}

		$home = $this->resolve_home_target( $id );
		return is_wp_error( $home ) ? null : $home;
	}

	/**
	 * Resolves a workspace home target by id and returns the small wire shape
	 * Home needs. The response keeps `{id, path, title?, icon?}`; callers can
	 * read further fields from the matching document record when they need it.
	 *
	 * @param int $id Target document id.
	 * @return array<string,mixed>|WP_Error
	 */
	private function resolve_home_target( int $id ) {
		$target = $this->documents->format_target( $id );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		return $target;
	}

	/**
	 * Reads the home document id from stored user meta. Integers are the
	 * canonical shape; strings (`"kind:id"` from older builds) are accepted
	 * for lazy migration on the next read.
	 *
	 * @param mixed $raw Raw stored value.
	 */
	private function stored_entry_id( mixed $raw ): int {
		if ( is_int( $raw ) ) {
			return $raw;
		}

		if ( is_string( $raw ) && '' !== $raw ) {
			if ( ctype_digit( $raw ) ) {
				return (int) $raw;
			}
			$parts = explode( ':', $raw, 2 );
			if ( 2 !== count( $parts ) ) {
				return 0;
			}
			return (int) $parts[1];
		}

		return 0;
	}
}
