<?php
/**
 * REST endpoint for the current user's recent Cortext activity.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Documents;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class RecentsController {

	private const NAMESPACE = 'cortext/v1';
	private const META_KEY  = 'cortext_recents';
	private const MAX_ITEMS = 5;

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
			'/recents',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_recents' ),
					'permission_callback' => array( $this, 'can_read' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'touch_recent' ),
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

	public function get_recents(): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'recents' => $this->resolve_stored_recents( get_current_user_id() ),
			),
			200
		);
	}

	public function touch_recent( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$id = (int) $request->get_param( 'id' );

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

		$item = array(
			'kind'      => $target['kind'],
			'id'        => $target['id'],
			'updatedAt' => gmdate( DATE_RFC3339 ),
		);

		$items = array( $item );
		$key   = $this->recent_key( $item );
		foreach ( $this->read_stored_items( get_current_user_id() ) as $stored_item ) {
			if ( $this->recent_key( $stored_item ) === $key ) {
				continue;
			}
			$items[] = $stored_item;
			if ( count( $items ) >= self::MAX_ITEMS ) {
				break;
			}
		}

		update_user_meta( get_current_user_id(), self::META_KEY, $items );

		return new WP_REST_Response(
			array(
				'recents' => $this->resolve_stored_recents( get_current_user_id() ),
			),
			200
		);
	}

	/**
	 * Resolves stored recents and prunes stale entries.
	 *
	 * @param int $user_id User ID.
	 * @return array<int,array<string,mixed>>
	 */
	private function resolve_stored_recents( int $user_id ): array {
		$items    = $this->read_stored_items( $user_id );
		$resolved = array();
		$valid    = array();

		foreach ( $items as $item ) {
			$target = $this->documents->format_target( $item['id'] );
			if ( is_wp_error( $target ) ) {
				continue;
			}

			$target['updatedAt'] = $item['updatedAt'];
			$resolved[]          = $target;
			$valid[]             = $item;
		}

		if ( count( $valid ) !== count( $items ) ) {
			update_user_meta( $user_id, self::META_KEY, $valid );
		}

		return $resolved;
	}

	/**
	 * Reads normalized stored recent items.
	 *
	 * @param int $user_id User ID.
	 * @return array<int,array{kind:string,id:int,updatedAt:string}>
	 */
	private function read_stored_items( int $user_id ): array {
		$raw = get_user_meta( $user_id, self::META_KEY, true );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$items = array();
		foreach ( $raw as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			$kind = isset( $item['kind'] ) ? (string) $item['kind'] : '';
			$id   = isset( $item['id'] ) ? (int) $item['id'] : 0;
			if ( ! in_array( $kind, self::ALLOWED_KINDS, true ) || $id < 1 ) {
				continue;
			}

			$items[] = array(
				'kind'      => $kind,
				'id'        => $id,
				'updatedAt' => isset( $item['updatedAt'] ) && is_string( $item['updatedAt'] )
					? $item['updatedAt']
					: gmdate( DATE_RFC3339 ),
			);
		}

		return array_slice( $items, 0, self::MAX_ITEMS );
	}

	/**
	 * Dedupe key for a stored recent item. The post id is enough because a post
	 * can only belong to one kind; older entries may carry a stale kind label,
	 * but the id still points to the same target.
	 *
	 * @param array{id:int} $item Recent item.
	 */
	private function recent_key( array $item ): string {
		return (string) $item['id'];
	}
}
