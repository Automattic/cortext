<?php
/**
 * Resolves a document id to its post type, rest_base, and slug.
 *
 * The shell addresses any document by id alone (the slug in the URL is
 * cosmetic). Core REST still needs the post type to fetch the record, and
 * that differs across documents: `crtxt_page` for pages, dynamic
 * `crtxt_<collection-slug>` for rows. This endpoint is the one extra hop
 * that lets the URL stay slug-agnostic.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class DocumentLocatorController {

	private const NAMESPACE = 'cortext/v1';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'locate' ),
					'permission_callback' => array( $this, 'check_document_post' ),
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Permission gate. Returns 404 for unknown ids or non-document post types
	 * so the resolver can treat it as "route to not-found, not just unauthorized."
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 *
	 * @return bool|WP_Error
	 */
	public function check_document_post( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( ! current_user_can( 'read_post', $id ) ) {
			return false;
		}

		return true;
	}

	public function locate( WP_REST_Request $request ): WP_REST_Response {
		$id        = (int) $request->get_param( 'id' );
		$post      = get_post( $id );
		$type      = get_post_type_object( $post->post_type );
		$rest_base = $type && ! empty( $type->rest_base ) ? $type->rest_base : $post->post_type;

		return new WP_REST_Response(
			array(
				'id'        => (int) $post->ID,
				'type'      => $post->post_type,
				'rest_base' => $rest_base,
				'slug'      => $post->post_name,
			),
			200
		);
	}
}
