<?php
/**
 * REST endpoint for the current user's sidebar favorites.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\PostType\Collection;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Page;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class FavoritesController {

	private const NAMESPACE = 'cortext/v1';
	private const META_KEY  = 'cortext_favorites';

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
										'enum' => array( 'page', 'collection' ),
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
				return $this->invalid_target_error();
			}

			$kind = isset( $favorite['kind'] ) ? (string) $favorite['kind'] : '';
			$id   = isset( $favorite['id'] ) ? (int) $favorite['id'] : 0;
			$key  = "{$kind}:{$id}";

			if ( isset( $seen[ $key ] ) ) {
				continue;
			}

			$target = $this->format_target( $kind, $id, true );
			if ( is_wp_error( $target ) ) {
				return $target;
			}

			$seen[ $key ] = true;
			$stored[]     = $key;
			$formatted[]  = $target;
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
			$parsed = $this->parse_stored_entry( $entry );
			if ( ! $parsed ) {
				continue;
			}

			$key = "{$parsed['kind']}:{$parsed['id']}";
			if ( isset( $seen[ $key ] ) ) {
				continue;
			}

			$target = $this->format_target( $parsed['kind'], $parsed['id'], true );
			if ( is_wp_error( $target ) ) {
				continue;
			}

			$seen[ $key ] = true;
			$out[]        = $target;
		}

		return $out;
	}

	private function parse_stored_entry( mixed $entry ): ?array {
		if ( is_string( $entry ) ) {
			$parts = explode( ':', $entry, 2 );
			if ( 2 !== count( $parts ) ) {
				return null;
			}
			return array(
				'kind' => $parts[0],
				'id'   => (int) $parts[1],
			);
		}

		if ( is_array( $entry ) ) {
			return array(
				'kind' => isset( $entry['kind'] ) ? (string) $entry['kind'] : '',
				'id'   => isset( $entry['id'] ) ? (int) $entry['id'] : 0,
			);
		}

		return null;
	}

	/**
	 * Formats a page or collection target into the shell route contract.
	 *
	 * @param string $kind Target kind.
	 * @param int    $id Target post ID.
	 * @param bool   $require_edit Whether to enforce edit_post capability.
	 * @return array<string,mixed>|WP_Error
	 */
	private function format_target( string $kind, int $id, bool $require_edit ) {
		if ( ! in_array( $kind, array( 'page', 'collection' ), true ) || $id < 1 ) {
			return $this->invalid_target_error();
		}

		$post = get_post( $id );
		if ( ! $this->is_supported_target( $post, $kind ) ) {
			return new WP_Error(
				'cortext_favorites_not_found',
				__( 'Favorite target was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( 'collection' === $kind && Collection::is_inline( $id ) ) {
			return new WP_Error(
				'cortext_favorites_inline_collection',
				__( 'Inline collections cannot be added to favorites.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( $require_edit && ! current_user_can( 'edit_post', $id ) ) {
			return new WP_Error(
				'cortext_favorites_forbidden',
				__( 'You are not allowed to favorite this target.', 'cortext' ),
				array( 'status' => 403 )
			);
		}

		$target = array(
			'kind'  => $kind,
			'id'    => $id,
			'title' => $this->post_title( $post ),
			'path'  => $this->target_path( $post, $kind ),
		);
		if ( 'page' === $kind ) {
			$icon = get_post_meta( $id, DocumentIdentity::META_KEY, true );
			if ( is_string( $icon ) && '' !== $icon ) {
				$target['icon'] = $icon;
			}
		}

		return $target;
	}

	private function invalid_target_error(): WP_Error {
		return new WP_Error(
			'cortext_favorites_invalid_target',
			__( 'Favorite target is invalid.', 'cortext' ),
			array( 'status' => 400 )
		);
	}

	private function is_supported_target( ?WP_Post $post, string $kind ): bool {
		if ( ! $post || 'trash' === $post->post_status ) {
			return false;
		}

		$type = 'page' === $kind ? Page::POST_TYPE : Collection::POST_TYPE;
		return $type === $post->post_type;
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
}
