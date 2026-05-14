<?php
/**
 * REST endpoints for restoring and permanently deleting trashed Cortext
 * documents (pages and collection rows).
 *
 * Page documents carry hierarchy, so restore/delete here also walks the
 * `PageTrashCascade` marker chain to surface descendants. Row documents are
 * flat per collection, so the cascade walk is a no-op for them.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Page;
use Cortext\PostType\PageTrashCascade;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class DocumentTrashController {

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
			'/documents/trash',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_trashed_documents' ),
					'permission_callback' => array( $this, 'can_read_documents' ),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/restore',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'restore' ),
					'permission_callback' => array( $this, 'check_document_post' ),
					'args'                => $id_arg,
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/permanent-delete',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'permanent_delete' ),
					'permission_callback' => array( $this, 'check_document_post' ),
					'args'                => $id_arg,
				),
			)
		);
	}

	public function can_read_documents(): bool {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Returns every trashed Cortext document the current user can edit.
	 *
	 * @return WP_REST_Response
	 */
	public function get_trashed_documents(): WP_REST_Response {
		$documents  = array();
		$post_types = array_values(
			array_filter(
				get_post_types(),
				static fn( string $post_type ): bool => post_type_supports( $post_type, 'cortext-document' )
			)
		);

		foreach ( $post_types as $post_type ) {
			$posts = get_posts(
				array(
					'post_type'      => $post_type,
					'post_status'    => 'trash',
					'posts_per_page' => -1,
					'orderby'        => 'modified',
					'order'          => 'DESC',
				)
			);

			foreach ( $posts as $post ) {
				if ( ! $post instanceof WP_Post || ! current_user_can( 'edit_post', $post->ID ) ) {
					continue;
				}

				$document = $this->format_trashed_document( $post );
				if ( null !== $document ) {
					$documents[] = $document;
				}
			}
		}

		usort(
			$documents,
			static fn( array $a, array $b ): int => strcmp(
				(string) ( $b['modified_at'] ?? '' ),
				(string) ( $a['modified_at'] ?? '' )
			)
		);

		return new WP_REST_Response(
			array(
				'documents' => $documents,
				'total'     => count( $documents ),
			),
			200
		);
	}

	/**
	 * Permission gate. Returns a `WP_Error` with status 404 when the post id
	 * is unknown or its post type does not opt into `cortext-document` so the
	 * consumer can tell "not found" from "not allowed" without leaking
	 * permission semantics into the route callback. WP REST honours `WP_Error`
	 * returns from permission callbacks.
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
				'cortext_document_not_trashed',
				__( 'Document is not in trash.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		// Snapshot the tagged subtree before the cascade runs. The
		// `untrashed_post` action fires synchronously inside `wp_untrash_post`,
		// so a post-call query alone could not tell which descendants this
		// restore brought back versus which were already out of trash. The
		// cascade marker is per-immediate-parent, so we walk down the chain.
		// Cascade is page-only; rows are flat and produce an empty subtree.
		$candidates = Page::POST_TYPE === $post->post_type
			? $this->tagged_subtree_ids( $id )
			: array();

		$result = wp_untrash_post( $id );
		if ( ! $result ) {
			return new WP_Error(
				'cortext_document_restore_failed',
				__( 'Document could not be restored.', 'cortext' ),
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
				'post'     => $this->prepared_post( $post ),
			),
			200
		);
	}

	/**
	 * Runs the standard `WP_REST_Posts_Controller` against the given document so
	 * the response payload matches what `useEntityRecord` already knows how to
	 * consume. Lets clients drop a follow-up GET after a successful restore.
	 *
	 * @param \WP_Post $post Document post to render.
	 *
	 * @return mixed
	 */
	private function prepared_post( \WP_Post $post ) {
		$post_type_object = get_post_type_object( $post->post_type );
		$rest_base        = $post_type_object && ! empty( $post_type_object->rest_base )
			? $post_type_object->rest_base
			: $post->post_type;

		$rest_request = new WP_REST_Request( 'GET', '/wp/v2/' . $rest_base . '/' . $post->ID );
		$rest_request->set_param( 'context', 'edit' );
		$response = rest_do_request( $rest_request );
		return $response->is_error() ? null : $response->get_data();
	}

	/**
	 * Formats a trashed Cortext document for the sidebar Trash response.
	 *
	 * @param WP_Post $post Trashed document post.
	 * @return array<string,mixed>|null
	 */
	private function format_trashed_document( WP_Post $post ): ?array {
		if ( ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return null;
		}

		$collection = $this->find_collection_by_row_post_type( $post->post_type );
		$kind       = Page::POST_TYPE === $post->post_type
			? 'page'
			: ( $collection instanceof WP_Post ? 'row' : 'document' );

		$document = array(
			'id'          => (int) $post->ID,
			'type'        => $post->post_type,
			'kind'        => $kind,
			'slug'        => $post->post_name,
			'status'      => $post->post_status,
			'parent'      => (int) $post->post_parent,
			'menu_order'  => (int) $post->menu_order,
			'title'       => array(
				'raw'      => $post->post_title,
				'rendered' => $post->post_title,
			),
			'modified_at' => $this->format_gmt_date( $post->post_modified_gmt ),
			'meta'        => array(
				'cortext_document_icon'    => (string) get_post_meta( $post->ID, 'cortext_document_icon', true ),
				PageTrashCascade::META_KEY => (int) get_post_meta( $post->ID, PageTrashCascade::META_KEY, true ),
			),
		);

		if ( $collection instanceof WP_Post ) {
			$slug                   = substr( $post->post_type, strlen( CollectionEntries::CPT_PREFIX ) );
			$document['collection'] = array(
				'id'    => (int) $collection->ID,
				'slug'  => $slug,
				'title' => array(
					'raw'      => $collection->post_title,
					'rendered' => $collection->post_title,
				),
			);
		}

		return $document;
	}

	private function find_collection_by_row_post_type( string $post_type ): ?WP_Post {
		if (
			! str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) ||
			Collection::POST_TYPE === $post_type
		) {
			return null;
		}

		$slug = substr( $post_type, strlen( CollectionEntries::CPT_PREFIX ) );
		if ( '' === $slug ) {
			return null;
		}

		$collections = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_status'    => array( 'draft', 'private', 'publish' ),
				'posts_per_page' => 1,
				'meta_key'       => 'slug', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => $slug,  // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		return $collections[0] ?? null;
	}

	private function format_gmt_date( string $mysql_gmt ): string {
		$timestamp = strtotime( $mysql_gmt . ' UTC' );
		if ( false === $timestamp ) {
			return '';
		}
		return gmdate( 'c', $timestamp );
	}

	public function permanent_delete( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( 'trash' !== $post->post_status ) {
			return new WP_Error(
				'cortext_document_not_trashed',
				__( 'Document is not in trash.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		// Snapshot the subtree up front, then delete leaves-first so WP's
		// hierarchical-delete reparenting (`post_parent = $deleted->post_parent`)
		// has nothing to do for any non-leaf. Cascade is page-only; rows are
		// flat and produce an empty descendant list.
		$descendants = Page::POST_TYPE === $post->post_type
			? $this->tagged_subtree_ids( $id )
			: array();

		$deleted = array();
		foreach ( array_reverse( $descendants ) as $descendant_id ) {
			if ( wp_delete_post( $descendant_id, true ) ) {
				$deleted[] = $descendant_id;
			}
		}

		if ( ! wp_delete_post( $id, true ) ) {
			return new WP_Error(
				'cortext_document_delete_failed',
				__( 'Document could not be deleted.', 'cortext' ),
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
	 * a time. Page-only by design.
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
