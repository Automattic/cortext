<?php
/**
 * Read-only rule for `crtxt_document` posts.
 *
 * Archived and trashed documents keep their data but can't be edited until
 * they are restored. Core REST writes and autosaves to them fail here, before
 * the archive and container checks run.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use WP_Error;
use WP_Post;
use WP_REST_Request;

final class DocumentWriteGuard {

	public function register(): void {
		add_filter( 'rest_pre_insert_' . Document::POST_TYPE, array( $this, 'guard_rest_write' ), 4, 2 );
		add_filter( 'rest_dispatch_request', array( $this, 'guard_autosave' ), 10, 4 );
	}

	/**
	 * Returns the error a write to this document should fail with, or null
	 * when the document can be edited.
	 *
	 * @param WP_Post $post Document about to be written.
	 */
	public static function read_only_error( WP_Post $post ): ?WP_Error {
		if ( Documents::STATUS_ARCHIVED === $post->post_status ) {
			return new WP_Error(
				'cortext_document_archived',
				__( 'Restore this document before editing it.', 'cortext' ),
				array( 'status' => 409 )
			);
		}

		if ( Documents::STATUS_TRASH === $post->post_status ) {
			return new WP_Error(
				'cortext_document_in_trash',
				__( 'Move this document out of Trash before editing it.', 'cortext' ),
				array( 'status' => 409 )
			);
		}

		return null;
	}

	/**
	 * Rejects core REST updates to read-only documents.
	 *
	 * @param mixed           $prepared_post Post data prepared by core REST.
	 * @param WP_REST_Request $request       Incoming core REST request.
	 * @return mixed|WP_Error
	 */
	public function guard_rest_write( $prepared_post, WP_REST_Request $request ) {
		if ( is_wp_error( $prepared_post ) ) {
			return $prepared_post;
		}

		$post = $this->requested_document( $request );
		if ( ! $post instanceof WP_Post ) {
			return $prepared_post;
		}

		return self::read_only_error( $post ) ?? $prepared_post;
	}

	/**
	 * Rejects autosaves to read-only documents. The autosave controller
	 * ignores errors from the pre-insert filter, so it needs its own check.
	 *
	 * @param mixed           $dispatch_result Result supplied by an earlier filter.
	 * @param WP_REST_Request $request         Incoming REST request.
	 * @param string          $route           Matched route pattern.
	 * @param array           $handler         Matched route handler.
	 * @return mixed|WP_Error
	 */
	public function guard_autosave( $dispatch_result, WP_REST_Request $request, string $route, array $handler ) {
		unset( $route );

		$callback = $handler['callback'] ?? null;
		if (
			null !== $dispatch_result
			|| 'POST' !== $request->get_method()
			|| ! is_array( $callback )
			|| ! isset( $callback[0], $callback[1] )
			|| ! $callback[0] instanceof \WP_REST_Autosaves_Controller
			|| 'create_item' !== $callback[1]
		) {
			return $dispatch_result;
		}

		$post = $this->requested_document( $request );
		if ( ! $post instanceof WP_Post ) {
			return $dispatch_result;
		}

		return self::read_only_error( $post ) ?? $dispatch_result;
	}

	private function requested_document( WP_REST_Request $request ): ?WP_Post {
		$post_id = (int) $request->get_param( 'id' );
		$post    = $post_id > 0 ? get_post( $post_id ) : null;

		return $post instanceof WP_Post && Document::POST_TYPE === $post->post_type ? $post : null;
	}
}
