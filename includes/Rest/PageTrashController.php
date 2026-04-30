<?php
/**
 * REST endpoint for restoring trashed Cortext pages.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\PostType\Page;
use Cortext\PostType\PageTrashCascade;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class PageTrashController {

	private const NAMESPACE = 'cortext/v1';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		$id_arg = array(
			'id' => array(
				'type'     => 'integer',
				'required' => true,
			),
		);

		register_rest_route(
			self::NAMESPACE,
			'/pages/(?P<id>\d+)/restore',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'restore' ),
					'permission_callback' => array( $this, 'check_trashed_page' ),
					'args'                => $id_arg,
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/pages/(?P<id>\d+)/permanent-delete',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'permanent_delete' ),
					'permission_callback' => array( $this, 'check_trashed_page' ),
					'args'                => $id_arg,
				),
			)
		);
	}

	/**
	 * Permission gate. Returns a `WP_Error` with status 404 when the post id
	 * is unknown or not a `crtxt_page` so the consumer can tell "not found"
	 * from "not allowed" without leaking permission semantics into the route
	 * callback. WP REST honours `WP_Error` returns from permission callbacks.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 *
	 * @return bool|WP_Error
	 */
	public function check_trashed_page( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post || Page::POST_TYPE !== $post->post_type ) {
			return new WP_Error(
				'cortext_page_not_found',
				__( 'Page not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		// Trash, restore, and permanent-delete are gated on `delete_post` in
		// core's admin Pages list; keep the same convention here.
		if ( ! current_user_can( 'delete_post', $id ) ) {
			return false;
		}

		return true;
	}

	public function restore( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( 'trash' !== $post->post_status ) {
			return new WP_Error(
				'cortext_page_not_trashed',
				__( 'Page is not in trash.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		// Snapshot the tagged subtree before the cascade runs. The
		// `untrashed_post` action fires synchronously inside `wp_untrash_post`,
		// so a post-call query alone could not tell which descendants this
		// restore brought back versus which were already out of trash. The
		// cascade marker is per-immediate-parent, so we walk down the chain.
		$candidates = $this->tagged_subtree_ids( $id );

		$result = wp_untrash_post( $id );
		if ( ! $result ) {
			return new WP_Error(
				'cortext_page_restore_failed',
				__( 'Page could not be restored.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		$revived = array();
		foreach ( $candidates as $candidate_id ) {
			if ( 'trash' !== get_post_status( $candidate_id ) ) {
				$revived[] = $candidate_id;
			}
		}

		return new WP_REST_Response(
			array(
				'restored' => array_values( array_unique( array_merge( array( $id ), $revived ) ) ),
				'post'     => $this->prepared_post( $id ),
			),
			200
		);
	}

	/**
	 * Runs the standard `WP_REST_Posts_Controller` against the given page so
	 * the response payload matches what `useEntityRecord` already knows how to
	 * consume. Lets clients drop a follow-up GET after a successful restore.
	 *
	 * @param int $id Page id to render.
	 *
	 * @return mixed
	 */
	private function prepared_post( int $id ) {
		$rest_request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_pages/' . $id );
		$rest_request->set_param( 'context', 'edit' );
		$response = rest_do_request( $rest_request );
		return $response->is_error() ? null : $response->get_data();
	}

	public function permanent_delete( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( 'trash' !== $post->post_status ) {
			return new WP_Error(
				'cortext_page_not_trashed',
				__( 'Page is not in trash.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		// Snapshot the subtree up front, then delete leaves-first so WP's
		// hierarchical-delete reparenting (`post_parent = $deleted->post_parent`)
		// has nothing to do for any non-leaf.
		$descendants = $this->tagged_subtree_ids( $id );

		$deleted = array();
		foreach ( array_reverse( $descendants ) as $descendant_id ) {
			if ( wp_delete_post( $descendant_id, true ) ) {
				$deleted[] = $descendant_id;
			}
		}

		if ( ! wp_delete_post( $id, true ) ) {
			return new WP_Error(
				'cortext_page_delete_failed',
				__( 'Page could not be deleted.', 'cortext' ),
				array( 'status' => 500 )
			);
		}
		$deleted[] = $id;

		return new WP_REST_Response(
			array(
				'deleted' => $deleted,
			),
			200
		);
	}

	/**
	 * BFS over the cascade-marker tree rooted at `$root_id`, returning every
	 * trashed descendant whose marker chain ties back to the root. The marker
	 * stores each child's immediate parent, so the walk expands one level at
	 * a time.
	 *
	 * @param int $root_id Page id to walk from.
	 *
	 * @return int[] Trashed descendant ids (root excluded), no guaranteed order.
	 */
	private function tagged_subtree_ids( int $root_id ): array {
		$collected = array();
		$frontier  = array( $root_id );

		while ( ! empty( $frontier ) ) {
			$next = array();
			foreach ( $frontier as $current ) {
				foreach ( $this->trashed_children_tagged_with( $current ) as $child_id ) {
					if ( ! in_array( $child_id, $collected, true ) ) {
						$collected[] = $child_id;
						$next[]      = $child_id;
					}
				}
			}
			$frontier = $next;
		}

		return $collected;
	}

	/**
	 * Returns trashed pages currently tagged with the given parent id.
	 *
	 * @param int $parent_id Page id to match against the cascade marker.
	 *
	 * @return int[]
	 */
	private function trashed_children_tagged_with( int $parent_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Page::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => PageTrashCascade::META_KEY,   // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $parent_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		return array_map( 'intval', $ids );
	}
}
