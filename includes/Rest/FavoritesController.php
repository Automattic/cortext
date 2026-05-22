<?php
/**
 * REST endpoint for the current user's sidebar favorites.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Documents;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class FavoritesController {

	private const NAMESPACE = 'cortext/v1';
	private const META_KEY  = 'cortext_favorites';

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
			'/favorites',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_favorites' ),
					'permission_callback' => array( $this, 'can_read' ),
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( $this, 'update_favorites' ),
					'permission_callback' => array( $this, 'can_read' ),
					'args'                => array(
						'favorites' => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'kind' => array(
										'type' => 'string',
										'enum' => self::ALLOWED_KINDS,
									),
									'id'   => array(
										'type'    => 'integer',
										'minimum' => 1,
									),
								),
							),
						),
					),
				),
			)
		);
	}

	public function can_read(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function get_favorites(): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'favorites' => $this->resolve_stored_favorites( get_current_user_id() ),
			),
			200
		);
	}

	public function update_favorites( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$favorites = $request->get_param( 'favorites' );
		if ( ! is_array( $favorites ) ) {
			return new WP_Error(
				'cortext_favorites_invalid_payload',
				__( 'Favorites must be an ordered list.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$formatted = array();
		$stored    = array();
		$seen      = array();

		foreach ( $favorites as $favorite ) {
			if ( ! is_array( $favorite ) ) {
				return new WP_Error(
					'cortext_document_target_invalid',
					__( 'Target document is invalid.', 'cortext' ),
					array( 'status' => 400 )
				);
			}

			$id = isset( $favorite['id'] ) ? (int) $favorite['id'] : 0;
			if ( isset( $seen[ $id ] ) ) {
				continue;
			}

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

			$seen[ $id ] = true;
			$stored[]    = "{$target['kind']}:{$target['id']}";
			$formatted[] = $target;
		}

		update_user_meta( get_current_user_id(), self::META_KEY, $stored );

		return new WP_REST_Response(
			array(
				'favorites' => $formatted,
			),
			200
		);
	}

	private function resolve_stored_favorites( int $user_id ): array {
		$raw = get_user_meta( $user_id, self::META_KEY, true );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$out  = array();
		$seen = array();
		foreach ( $raw as $entry ) {
			$id = $this->stored_entry_id( $entry );
			if ( $id < 1 || isset( $seen[ $id ] ) ) {
				continue;
			}

			$target = $this->documents->format_target( $id );
			if ( is_wp_error( $target ) ) {
				continue;
			}

			if ( ! in_array( $target['kind'], self::ALLOWED_KINDS, true ) ) {
				continue;
			}

			$seen[ $id ] = true;
			$out[]       = $target;
		}

		return $out;
	}

	private function stored_entry_id( mixed $entry ): int {
		if ( is_string( $entry ) ) {
			$parts = explode( ':', $entry, 2 );
			if ( 2 !== count( $parts ) ) {
				return 0;
			}
			return (int) $parts[1];
		}

		if ( is_array( $entry ) && isset( $entry['id'] ) ) {
			return (int) $entry['id'];
		}

		return 0;
	}
}
