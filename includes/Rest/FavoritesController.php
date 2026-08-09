<?php
/**
 * REST endpoint for the current user's sidebar favorites.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class FavoritesController {

	private const NAMESPACE = 'cortext/v1';
	private const META_KEY  = 'cortext_favorites';

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
									'id' => array(
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

		$user_id          = get_current_user_id();
		$existing_slots   = $this->stored_favorite_slots( $user_id );
		$existing_hidden  = array_fill_keys(
			array_column(
				array_filter(
					$existing_slots,
					static fn( array $slot ): bool => $slot['hidden']
				),
				'id'
			),
			true
		);
		$formatted        = array();
		$requested        = array();
		$requested_hidden = array();
		$seen             = array();

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
				if ( 'cortext_document_target_hidden' === $target->get_error_code() ) {
					if ( ! isset( $existing_hidden[ $id ] ) ) {
						return $target;
					}
					$seen[ $id ]        = true;
					$requested_hidden[] = $id;
					continue;
				}
				return $target;
			}

			$seen[ $id ] = true;
			$requested[] = (int) $target['id'];
			$formatted[] = $target;
		}

		$stored = $this->merge_with_hidden_favorites(
			$existing_slots,
			$requested,
			$requested_hidden
		);
		update_user_meta( $user_id, self::META_KEY, $stored );

		return new WP_REST_Response(
			array(
				'favorites' => $formatted,
			),
			200
		);
	}

	/**
	 * Merges the visible order sent by the client with archived favorites. Each
	 * archived favorite keeps its current slot.
	 *
	 * @param array<int, array{id: int, hidden: bool}> $slots Existing valid slots.
	 * @param array<int, int>                          $requested Requested visible IDs.
	 * @param array<int, int>                          $requested_hidden Requested hidden IDs.
	 * @return array<int, int>
	 */
	private function merge_with_hidden_favorites(
		array $slots,
		array $requested,
		array $requested_hidden
	): array {
		$stored          = array();
		$emitted         = array();
		$requested_index = 0;

		foreach ( $slots as $slot ) {
			if ( $slot['hidden'] ) {
				if ( ! isset( $emitted[ $slot['id'] ] ) ) {
					$stored[]               = $slot['id'];
					$emitted[ $slot['id'] ] = true;
				}
				continue;
			}

			if ( ! isset( $requested[ $requested_index ] ) ) {
				continue;
			}

			$id = $requested[ $requested_index ];
			++$requested_index;
			if ( isset( $emitted[ $id ] ) ) {
				continue;
			}
			$stored[]       = $id;
			$emitted[ $id ] = true;
		}

		for ( $count = count( $requested ); $requested_index < $count; ++$requested_index ) {
			$id = $requested[ $requested_index ];
			if ( isset( $emitted[ $id ] ) ) {
				continue;
			}
			$stored[]       = $id;
			$emitted[ $id ] = true;
		}

		foreach ( $requested_hidden as $id ) {
			if ( isset( $emitted[ $id ] ) ) {
				continue;
			}
			$stored[]       = $id;
			$emitted[ $id ] = true;
		}

		return $stored;
	}

	/**
	 * Builds visible and hidden slots from the user's saved favorites. Invalid,
	 * deleted, and inaccessible documents are left out.
	 *
	 * @param int $user_id User whose stored favorites should be resolved.
	 * @return array<int, array{id: int, hidden: bool}>
	 */
	private function stored_favorite_slots( int $user_id ): array {
		$raw = get_user_meta( $user_id, self::META_KEY, true );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$slots = array();
		$seen  = array();
		foreach ( $raw as $entry ) {
			$id = $this->stored_entry_id( $entry );
			if ( $id < 1 || isset( $seen[ $id ] ) ) {
				continue;
			}

			$target = $this->documents->format_target( $id );
			if ( is_wp_error( $target ) ) {
				if ( 'cortext_document_target_hidden' !== $target->get_error_code() ) {
					continue;
				}
				$slots[]     = array(
					'id'     => $id,
					'hidden' => true,
				);
				$seen[ $id ] = true;
				continue;
			}

			$canonical_id = (int) $target['id'];
			$slots[]      = array(
				'id'     => $canonical_id,
				'hidden' => false,
			);
			$seen[ $id ]  = true;
		}

		return $slots;
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
			$id = $this->stored_entry_id( $entry );
			if ( $id < 1 || isset( $seen[ $id ] ) ) {
				continue;
			}

			$target = $this->documents->format_target( $id );
			if ( is_wp_error( $target ) ) {
				if ( 'cortext_document_target_hidden' === $target->get_error_code() ) {
					$seen[ $id ] = true;
					$valid[]     = $id;
				}
				continue;
			}

			$seen[ $id ] = true;
			// Re-normalise to the canonical bare-id shape on read so older
			// `kind:id` strings and `{kind, id}` arrays migrate forward on the
			// next access.
			$valid[] = (int) $target['id'];
			$out[]   = $target;
		}

		// Keep storage matched to what we can still resolve. Otherwise the next
		// save may replay a stale favorite and fail the whole update.
		if ( array_values( $raw ) !== $valid ) {
			update_user_meta( $user_id, self::META_KEY, $valid );
		}

		return $out;
	}

	/**
	 * Reads the document id out of a stored favorite. Integers are the
	 * canonical shape; strings (`"kind:id"`) and arrays (older row favorites
	 * with `collectionId`) are accepted for lazy migration on the next read.
	 *
	 * @param mixed $entry Raw stored entry.
	 */
	private function stored_entry_id( mixed $entry ): int {
		if ( is_int( $entry ) ) {
			return $entry;
		}

		if ( is_string( $entry ) ) {
			if ( ctype_digit( $entry ) ) {
				return (int) $entry;
			}
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
