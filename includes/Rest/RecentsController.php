<?php
/**
 * REST endpoint for the current user's recent Cortext activity.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Documents;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Page;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class RecentsController {

	private const NAMESPACE = 'cortext/v1';
	private const META_KEY  = 'cortext_recents';
	private const MAX_ITEMS = 5;

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
						'kind'         => array(
							'type'     => 'string',
							'required' => true,
							'enum'     => array( 'page', 'collection', 'row' ),
						),
						'id'           => array(
							'type'     => 'integer',
							'required' => true,
							'minimum'  => 1,
						),
						'collectionId' => array(
							'type'    => 'integer',
							'minimum' => 1,
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
		$kind          = (string) $request->get_param( 'kind' );
		$id            = (int) $request->get_param( 'id' );
		$collection_id = (int) $request->get_param( 'collectionId' );

		$target = $this->format_target( $kind, $id, $collection_id );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		$item = array(
			'kind'      => $kind,
			'id'        => $id,
			'updatedAt' => gmdate( DATE_RFC3339 ),
		);
		if ( 'row' === $kind ) {
			$item['collectionId'] = $collection_id;
		}

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
			$target = $this->format_target(
				$item['kind'],
				$item['id'],
				$item['collectionId'] ?? 0
			);
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
	 * @return array<int,array{kind:string,id:int,updatedAt:string,collectionId?:int}>
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
			if ( ! in_array( $kind, array( 'page', 'collection', 'row' ), true ) || $id < 1 ) {
				continue;
			}

			$stored = array(
				'kind'      => $kind,
				'id'        => $id,
				'updatedAt' => isset( $item['updatedAt'] ) && is_string( $item['updatedAt'] )
					? $item['updatedAt']
					: gmdate( DATE_RFC3339 ),
			);
			if ( 'row' === $kind ) {
				$collection_id = isset( $item['collectionId'] ) ? (int) $item['collectionId'] : 0;
				if ( $collection_id < 1 ) {
					continue;
				}
				$stored['collectionId'] = $collection_id;
			}
			$items[] = $stored;
		}

		return array_slice( $items, 0, self::MAX_ITEMS );
	}

	/**
	 * Formats a supported Cortext target for the recents response.
	 *
	 * @param string $kind Target kind.
	 * @param int    $id Target post ID.
	 * @param int    $collection_id Parent collection ID for row targets.
	 * @return array<string,mixed>|WP_Error
	 */
	private function format_target( string $kind, int $id, int $collection_id = 0 ) {
		if ( ! in_array( $kind, array( 'page', 'collection', 'row' ), true ) || $id < 1 ) {
			return new WP_Error(
				'cortext_recents_invalid_target',
				__( 'Recent target is invalid.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( 'row' === $kind ) {
			return $this->format_row_target( $id, $collection_id );
		}

		$post          = get_post( $id );
		$expected_type = 'page' === $kind ? Page::POST_TYPE : Collection::POST_TYPE;
		if ( ! $post instanceof WP_Post || $expected_type !== $post->post_type || 'trash' === $post->post_status ) {
			return new WP_Error(
				'cortext_recents_not_found',
				__( 'Recent target was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		// Inline collections do not have their own workspace route, so Recents
		// should not point at them. Rows inside them are still valid recents.
		if ( 'collection' === $kind && Collection::is_inline( $id ) ) {
			return new WP_Error(
				'cortext_recents_inline_collection',
				__( 'Inline collections cannot be added to Recents.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( ! current_user_can( 'edit_post', $id ) ) {
			return new WP_Error(
				'cortext_recents_forbidden',
				__( 'You are not allowed to use this target as a recent item.', 'cortext' ),
				array( 'status' => 403 )
			);
		}

		if ( 'page' === $kind ) {
			return $this->documents->format_document( $post ) ?? new WP_Error(
				'cortext_recents_not_found',
				__( 'Recent target was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return array(
			'kind'  => $kind,
			'id'    => $id,
			'title' => $this->post_title( $post ),
			'path'  => $this->target_path( $post, $kind ),
		);
	}

	/**
	 * Formats a collection row target.
	 *
	 * @param int $row_id Row post ID.
	 * @param int $collection_id Parent collection post ID.
	 * @return array<string,mixed>|WP_Error
	 */
	private function format_row_target( int $row_id, int $collection_id ) {
		if ( $collection_id < 1 ) {
			return new WP_Error(
				'cortext_recents_row_collection_required',
				__( 'Recent row target requires a collection.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$collection = get_post( $collection_id );
		if (
			! $collection instanceof WP_Post ||
			Collection::POST_TYPE !== $collection->post_type ||
			'trash' === $collection->post_status
		) {
			return new WP_Error(
				'cortext_recents_collection_not_found',
				__( 'Recent row collection was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$slug = get_post_meta( $collection_id, 'slug', true );
		$slug = is_string( $slug ) ? trim( $slug ) : '';
		$row  = get_post( $row_id );
		if (
			'' === $slug ||
			! $row instanceof WP_Post ||
			CollectionEntries::CPT_PREFIX . $slug !== $row->post_type ||
			'trash' === $row->post_status
		) {
			return new WP_Error(
				'cortext_recents_not_found',
				__( 'Recent target was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( ! current_user_can( 'edit_post', $collection_id ) || ! current_user_can( 'edit_post', $row_id ) ) {
			return new WP_Error(
				'cortext_recents_forbidden',
				__( 'You are not allowed to use this target as a recent item.', 'cortext' ),
				array( 'status' => 403 )
			);
		}

		$document = $this->documents->format_document( $row );
		if ( null === $document ) {
			return new WP_Error(
				'cortext_recents_not_found',
				__( 'Recent target was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $document;
	}

	private function post_title( WP_Post $post ): string {
		$title = trim( $post->post_title );
		return '' === $title ? __( '(untitled)', 'cortext' ) : $title;
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

	/**
	 * Builds the stable dedupe key for a stored recent item.
	 *
	 * @param array{kind:string,id:int} $item Recent item.
	 */
	private function recent_key( array $item ): string {
		return "{$item['kind']}:{$item['id']}";
	}
}
