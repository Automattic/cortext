<?php
/**
 * REST endpoint for creating Cortext collections.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class CollectionsController {

	private const NAMESPACE = 'cortext/v1';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/collections',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'create' ),
					'permission_callback' => array( $this, 'can_create' ),
					'args'                => array(
						'title' => array(
							'type'     => 'string',
							'required' => true,
						),
					),
				),
			)
		);
	}

	public function can_create(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function create( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$title = trim( sanitize_text_field( (string) $request->get_param( 'title' ) ) );

		if ( '' === $title ) {
			return new WP_Error(
				'cortext_collection_title_required',
				__( 'Collection name is required.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$slug = $this->unique_slug( $title );

		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array(
					'slug' => $slug,
				),
			),
			true
		);

		if ( is_wp_error( $collection_id ) ) {
			return $collection_id;
		}

		$collection = get_post( (int) $collection_id );
		if ( ! $collection ) {
			wp_delete_post( (int) $collection_id, true );
			return new WP_Error(
				'cortext_collection_create_failed',
				__( 'Collection could not be created.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		( new CollectionEntries() )->register_for_collection( $collection );

		$rest_base = CollectionEntries::CPT_PREFIX . $slug;
		if ( ! post_type_exists( $rest_base ) ) {
			wp_delete_post( (int) $collection_id, true );
			return new WP_Error(
				'cortext_collection_cpt_failed',
				__( 'Collection rows could not be registered.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'id'       => (int) $collection_id,
				'title'    => $title,
				'slug'     => $slug,
				'restBase' => $rest_base,
			),
			201
		);
	}

	private function unique_slug( string $raw_slug ): string {
		$max_length = CollectionEntries::MAX_CPT_LEN - strlen( CollectionEntries::CPT_PREFIX );
		$base       = sanitize_key( sanitize_title( $raw_slug ) );

		if ( '' === $base ) {
			$base = 'items';
		}

		$base = trim( substr( $base, 0, $max_length ), '-' );
		if ( '' === $base ) {
			$base = 'items';
		}

		$taken = $this->existing_slugs();

		for ( $suffix = 0; $suffix < 1000; $suffix++ ) {
			$suffix_text = $suffix > 0 ? '-' . ( $suffix + 1 ) : '';
			$stem_length = $max_length - strlen( $suffix_text );
			$stem        = trim( substr( $base, 0, $stem_length ), '-' );
			if ( '' === $stem ) {
				$stem = 'items';
			}

			$candidate = $stem . $suffix_text;
			if ( ! $this->slug_taken( $candidate, $taken ) ) {
				return $candidate;
			}
		}

		return substr( uniqid( 'c', false ), 0, $max_length );
	}

	private function slug_taken( string $slug, array $taken ): bool {
		if ( CollectionEntries::is_reserved_slug( $slug ) ) {
			return true;
		}

		if ( post_type_exists( CollectionEntries::CPT_PREFIX . $slug ) ) {
			return true;
		}

		return isset( $taken[ $slug ] );
	}

	/**
	 * Gets existing collection slugs.
	 *
	 * @return array<string, true> Set of slugs already in use, keyed by slug.
	 */
	private function existing_slugs(): array {
		$collection_ids = get_posts(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'any',
				'numberposts' => -1,
				'fields'      => 'ids',
			)
		);

		$slugs = array();
		foreach ( $collection_ids as $collection_id ) {
			$slug = get_post_meta( (int) $collection_id, 'slug', true );
			if ( is_string( $slug ) && '' !== $slug ) {
				$slugs[ $slug ] = true;
			}
		}

		return $slugs;
	}
}
