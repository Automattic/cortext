<?php
/**
 * Read-only rule for `crtxt_document` posts.
 *
 * Archived and trashed documents keep their data but can't be edited until
 * they are restored, and frozen documents can't be edited until they are
 * unfrozen. Core REST writes and autosaves to them fail here, before the
 * archive and container checks run.
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

	/**
	 * Request keys a move sends. A frozen document can still be moved, since
	 * its place in the tree isn't part of its content.
	 */
	private const MOVE_PARAMS = array( 'parent', 'menu_order' );

	/** Request keys that never change the document. */
	private const IGNORED_PARAMS = array( 'id', 'context', '_locale', '_fields', '_envelope', '_method' );

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
		return self::lifecycle_error( $post ) ?? self::frozen_error( $post );
	}

	/**
	 * Returns the error for a document that is out of circulation (archived
	 * or trashed), or null.
	 *
	 * @param WP_Post $post Document about to be written.
	 */
	public static function lifecycle_error( WP_Post $post ): ?WP_Error {
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

	private static function frozen_error( WP_Post $post ): ?WP_Error {
		if ( ! DocumentFreeze::is_frozen( (int) $post->ID ) ) {
			return null;
		}

		return new WP_Error(
			'cortext_document_frozen',
			__( 'Unlock this document before editing it.', 'cortext' ),
			array( 'status' => 409 )
		);
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

		$lifecycle_error = self::lifecycle_error( $post );
		if ( $lifecycle_error instanceof WP_Error ) {
			return $lifecycle_error;
		}

		if ( $this->is_move( $request ) ) {
			return $prepared_post;
		}

		return self::frozen_error( $post ) ?? $prepared_post;
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

	/**
	 * Whether a request only changes the document's parent or position.
	 *
	 * @param WP_REST_Request $request Incoming core REST request.
	 */
	private function is_move( WP_REST_Request $request ): bool {
		$keys = array_diff(
			array_keys(
				array_merge(
					(array) $request->get_json_params(),
					$request->get_body_params(),
					$request->get_query_params()
				)
			),
			self::IGNORED_PARAMS
		);

		return ! empty( $keys ) && empty( array_diff( $keys, self::MOVE_PARAMS ) );
	}

	private function requested_document( WP_REST_Request $request ): ?WP_Post {
		$post_id = (int) $request->get_param( 'id' );
		$post    = $post_id > 0 ? get_post( $post_id ) : null;

		return $post instanceof WP_Post && Document::POST_TYPE === $post->post_type ? $post : null;
	}
}
