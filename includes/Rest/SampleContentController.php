<?php
/**
 * REST endpoint for seeding optional Cortext sample content.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\CLI\SeedDummyCollections;
use Cortext\PostType\Document;
use WP_Error;
use WP_REST_Response;

final class SampleContentController {

	private const NAMESPACE = 'cortext/v1';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/sample-content/seed',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'seed' ),
					'permission_callback' => array( $this, 'can_seed' ),
				),
			)
		);
	}

	public function can_seed(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function seed(): WP_REST_Response|WP_Error {
		$before = $this->counts();

		try {
			( new SeedDummyCollections() )->seed_sample_content();
		} catch ( \Throwable $exception ) {
			return new WP_Error(
				'cortext_sample_seed_failed',
				$exception->getMessage(),
				array( 'status' => 500 )
			);
		}

		$after = $this->counts();

		return new WP_REST_Response(
			array(
				'message' => __( 'Sample content is ready.', 'cortext' ),
				'counts'  => $after,
				'created' => array(
					'pages'       => max( 0, $after['pages'] - $before['pages'] ),
					'collections' => max( 0, $after['collections'] - $before['collections'] ),
					'entries'     => max( 0, $after['entries'] - $before['entries'] ),
				),
			),
			200
		);
	}

	/**
	 * Counts seeded sample content by kind.
	 *
	 * @return array{pages:int,collections:int,entries:int}
	 */
	private function counts(): array {
		return array(
			'pages'       => $this->count_seeded_documents( '_cortext_seed_content_version' ),
			'collections' => $this->count_seeded_documents( 'cortext_seed_slug' ),
			'entries'     => $this->count_seeded_documents( '_cortext_seed_entry_content_version' ),
		);
	}

	private function count_seeded_documents( string $meta_key ): int {
		$posts = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => array( 'draft', 'private', 'publish', 'pending', 'future', 'trash' ),
				'fields'         => 'ids',
				'posts_per_page' => -1,
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_key'       => $meta_key,
			)
		);

		return count( $posts );
	}
}
