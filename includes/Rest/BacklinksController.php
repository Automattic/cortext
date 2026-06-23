<?php
/**
 * REST endpoint for backlinks to a Cortext document.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use Cortext\PostType\Document;
use Cortext\Taxonomy\MentionTaxonomy;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;

final class BacklinksController {

	private const NAMESPACE = 'cortext/v1';

	// Backlinks fill one sidebar panel; cap the result and report truncation
	// rather than page through thousands of sources.
	private const MAX_SOURCES = 200;

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/backlinks',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_backlinks' ),
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

	public function check_document_post( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post instanceof WP_Post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
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

	public function get_backlinks( WP_REST_Request $request ): WP_REST_Response {
		$target_id   = (int) $request->get_param( 'id' );
		$documents   = new Documents();
		$target_post = get_post( $target_id );
		$target      = $target_post instanceof WP_Post
			? $documents->format_document( $target_post )
			: null;
		$term_id     = MentionTaxonomy::term_id_for_target( $target_id );
		$sources     = array();
		$truncated   = false;

		if ( $term_id > 0 ) {
			$query = new WP_Query(
				array(
					'post_type'           => Document::POST_TYPE,
					'post_status'         => array( 'publish', 'draft', 'private' ),
					// Fetch one past the cap so a fuller index reports as truncated.
					// phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_posts_per_page -- Backlinks are capped intentionally for one sidebar payload.
					'posts_per_page'      => self::MAX_SOURCES + 1,
					'ignore_sticky_posts' => true,
					'no_found_rows'       => true,
					'orderby'             => 'modified',
					'order'               => 'DESC',
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- Backlinks are served from the mention mirror taxonomy.
					'tax_query'           => array(
						array(
							'taxonomy' => MentionTaxonomy::TAXONOMY,
							'field'    => 'term_id',
							'terms'    => array( $term_id ),
						),
					),
				)
			);

			$found_posts = $query->posts;
			$truncated   = count( $found_posts ) > self::MAX_SOURCES;
			if ( $truncated ) {
				$found_posts = array_slice( $found_posts, 0, self::MAX_SOURCES );
			}

			foreach ( $found_posts as $source_post ) {
				if ( ! $source_post instanceof WP_Post ) {
					$source_post = get_post( (int) $source_post );
				}
				if ( ! $source_post instanceof WP_Post || (int) $source_post->ID === $target_id ) {
					continue;
				}
				if ( ! current_user_can( 'read_post', (int) $source_post->ID ) ) {
					continue;
				}
				$document = $documents->format_document( $source_post, array( 'include_trait_flags' => true ) );
				if ( null !== $document ) {
					$sources[] = $document;
				}
			}
		}

		return new WP_REST_Response(
			array(
				'target'    => $target,
				'total'     => count( $sources ),
				'truncated' => $truncated,
				'sources'   => $sources,
			),
			200
		);
	}
}
