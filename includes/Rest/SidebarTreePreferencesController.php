<?php
/**
 * REST endpoint for the current user's sidebar tree expansion state.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\PostType\Document;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class SidebarTreePreferencesController {

	private const NAMESPACE = 'cortext/v1';
	private const META_KEY  = 'cortext_sidebar_expanded_documents';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/sidebar-tree-preferences',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_preferences' ),
					'permission_callback' => array( $this, 'can_read' ),
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( $this, 'update_preferences' ),
					'permission_callback' => array( $this, 'can_read' ),
					'args'                => array(
						'expanded' => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array(
								'type'    => 'integer',
								'minimum' => 1,
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

	public function get_preferences(): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'expanded' => $this->resolve_stored_expanded( get_current_user_id() ),
			),
			200
		);
	}

	public function update_preferences( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$expanded = $request->get_param( 'expanded' );
		if ( ! is_array( $expanded ) ) {
			return new WP_Error(
				'cortext_sidebar_tree_preferences_invalid_payload',
				__( 'Expanded documents must be sent as a list.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$valid = $this->valid_tree_document_ids( $this->normalize_ids( $expanded ) );
		update_user_meta( get_current_user_id(), self::META_KEY, $valid );

		return new WP_REST_Response(
			array(
				'expanded' => $valid,
			),
			200
		);
	}

	private function resolve_stored_expanded( int $user_id ): array {
		$raw = get_user_meta( $user_id, self::META_KEY, true );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$valid = $this->valid_tree_document_ids( $this->normalize_ids( $raw ) );
		if ( array_values( $raw ) !== $valid ) {
			update_user_meta( $user_id, self::META_KEY, $valid );
		}

		return $valid;
	}

	/**
	 * Normalizes expanded document ids.
	 *
	 * @param array<int,mixed> $raw Stored or requested ids.
	 * @return int[]
	 */
	private function normalize_ids( array $raw ): array {
		$ids  = array();
		$seen = array();
		foreach ( $raw as $entry ) {
			$id = is_numeric( $entry ) ? (int) $entry : 0;
			if ( $id < 1 || isset( $seen[ $id ] ) ) {
				continue;
			}
			$seen[ $id ] = true;
			$ids[]       = $id;
		}
		return $ids;
	}

	/**
	 * Keeps only editable documents that belong in the tree.
	 *
	 * @param int[] $ids Candidate document ids.
	 * @return int[]
	 */
	private function valid_tree_document_ids( array $ids ): array {
		$out = array();
		foreach ( $ids as $id ) {
			if ( $this->is_tree_document( $id ) ) {
				$out[] = $id;
			}
		}
		return $out;
	}

	private function is_tree_document( int $id ): bool {
		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return false;
		}
		if ( ! in_array( $post->post_status, array( 'draft', 'private', 'publish' ), true ) ) {
			return false;
		}
		if ( ! current_user_can( 'edit_post', $id ) ) {
			return false;
		}
		return ! $this->has_trait_without_defining_one( $post );
	}

	private function has_trait_without_defining_one( WP_Post $post ): bool {
		if ( Document::is_collection_post( $post ) ) {
			return false;
		}

		$terms = wp_get_object_terms(
			$post->ID,
			TraitTaxonomy::TAXONOMY,
			array( 'fields' => 'ids' )
		);
		return is_array( $terms ) && count( $terms ) > 0;
	}
}
