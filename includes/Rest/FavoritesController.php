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
		Documents::KIND_ROW,
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
									'kind'         => array(
										'type' => 'string',
										'enum' => self::ALLOWED_KINDS,
									),
									'id'           => array(
										'type'    => 'integer',
										'minimum' => 1,
									),
									'collectionId' => array(
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

			$id            = isset( $favorite['id'] ) ? (int) $favorite['id'] : 0;
			$collection_id = isset( $favorite['collectionId'] ) ? (int) $favorite['collectionId'] : 0;
			if ( isset( $seen[ $id ] ) ) {
				continue;
			}

			$target = $this->documents->format_target(
				$id,
				array( 'context_id' => $collection_id )
			);
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
			$stored[]    = $this->stored_entry_for_target( $target );
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

		$out   = array();
		$valid = array();
		$seen  = array();
		foreach ( $raw as $entry ) {
			$parsed = $this->parse_stored_entry( $entry );
			if ( null === $parsed || isset( $seen[ $parsed['id'] ] ) ) {
				continue;
			}

			$target = $this->documents->format_target(
				$parsed['id'],
				array( 'context_id' => $parsed['collectionId'] )
			);
			if ( is_wp_error( $target ) ) {
				continue;
			}

			if ( ! in_array( $target['kind'], self::ALLOWED_KINDS, true ) ) {
				continue;
			}

			$seen[ $parsed['id'] ] = true;
			$valid[]               = $entry;
			$out[]                 = $target;
		}

		// Keep storage matched to what we can still resolve. Otherwise the next
		// save may replay a stale favorite and fail the whole update.
		if ( count( $valid ) !== count( $raw ) ) {
			update_user_meta( $user_id, self::META_KEY, $valid );
		}

		return $out;
	}

	/**
	 * Stores a favorite in the user's saved format. Pages and collections keep
	 * the old `"kind:id"` string; rows use an array because their id needs the
	 * parent collection id too.
	 *
	 * @param array<string,mixed> $target Formatted document target.
	 * @return string|array{kind:string,id:int,collectionId:int}
	 */
	private function stored_entry_for_target( array $target ): string|array {
		$kind = (string) $target['kind'];
		$id   = (int) $target['id'];
		if ( Documents::KIND_ROW !== $kind ) {
			return "{$kind}:{$id}";
		}

		return array(
			'kind'         => $kind,
			'id'           => $id,
			'collectionId' => isset( $target['collection']['id'] )
				? (int) $target['collection']['id']
				: 0,
		);
	}

	/**
	 * Turns a saved favorite back into the `{id, collectionId}` pair
	 * `format_target` expects. Bad entries are skipped when favorites are read.
	 *
	 * @param mixed $entry Raw stored entry: a string for pages/collections, or an
	 *                     array for rows.
	 * @return array{id:int,collectionId:int}|null
	 */
	private function parse_stored_entry( mixed $entry ): ?array {
		if ( is_string( $entry ) ) {
			$parts = explode( ':', $entry, 2 );
			if ( 2 !== count( $parts ) ) {
				return null;
			}
			$id = (int) $parts[1];
			return $id > 0
				? array(
					'id'           => $id,
					'collectionId' => 0,
				)
				: null;
		}

		if ( is_array( $entry ) && isset( $entry['id'] ) ) {
			$id = (int) $entry['id'];
			return $id > 0
				? array(
					'id'           => $id,
					'collectionId' => isset( $entry['collectionId'] )
						? (int) $entry['collectionId']
						: 0,
				)
				: null;
		}

		return null;
	}
}
