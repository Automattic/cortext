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

	private const ALLOWED_KINDS = array(
		Documents::KIND_PAGE,
		Documents::KIND_COLLECTION,
	);

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
						'kind' => array(
							'type'     => 'string',
							'required' => true,
							'enum'     => self::ALLOWED_KINDS,
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
		$id = (int) $request->get_param( 'id' );

		$home = $this->resolve_home_target( $id );
		if ( is_wp_error( $home ) ) {
			return $home;
		}

		update_user_meta( get_current_user_id(), self::META_KEY, "{$home['kind']}:{$home['id']}" );

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

		$home = $this->resolve_home_target( (int) $parts[1] );
		return is_wp_error( $home ) ? null : $home;
	}

	/**
	 * Resolves a workspace home target by id and returns the small wire shape
	 * Home needs. The response keeps `{kind, id, path}` only; callers can read
	 * title or icon from the matching document record when they need it.
	 *
	 * @param int $id Target document id.
	 * @return array{kind:string,id:int,path:string}|WP_Error
	 */
	private function resolve_home_target( int $id ) {
		$target = $this->documents->format_target( $id );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		if ( ! in_array( $target['kind'], self::ALLOWED_KINDS, true ) ) {
			return new WP_Error(
				'cortext_document_target_not_found',
				__( 'Target document was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return array(
			'kind' => $target['kind'],
			'id'   => $target['id'],
			'path' => $target['path'],
		);
	}
}
