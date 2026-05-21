<?php
/**
 * REST endpoints for Cortext documents.
 *
 * Handles listing, restore, permanent delete, duplicate, and collection
 * create through the `Documents` service.
 *
 * Restore and permanent-delete walk the page hierarchy via
 * `TrashCascadeEngine` so descendants move with their root. Single-resource
 * reads still go through `DocumentLocatorController` plus
 * `/wp/v2/<rest_base>/<id>`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Documents;
use Cortext\PostType\Cascade\CollectionToRowTrashCascade;
use Cortext\PostType\Cascade\DocumentToCollectionTrashCascade;
use Cortext\PostType\Cascade\PageHierarchyTrashCascade;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Page;
use Cortext\PostType\TrashCascadeEngine;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class DocumentsController {

	private const NAMESPACE = 'cortext/v1';

	private Documents $documents;

	private TrashCascadeEngine $cascade;

	public function __construct( ?Documents $documents = null, ?TrashCascadeEngine $cascade = null ) {
		$this->documents = $documents ?? new Documents();
		$this->cascade   = $cascade ?? new TrashCascadeEngine(
			array(
				new PageHierarchyTrashCascade(),
				new DocumentToCollectionTrashCascade(),
				new CollectionToRowTrashCascade( new CollectionEntries() ),
			)
		);
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/documents',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_documents' ),
					'permission_callback' => array( $this, 'can_read' ),
					'args'                => array(
						'search'   => array(
							'type'    => 'string',
							'default' => '',
						),
						'kind'     => array(
							'type'    => 'string',
							'default' => '',
							'enum'    => array( '', Documents::KIND_PAGE, Documents::KIND_ROW, Documents::KIND_COLLECTION ),
						),
						'status'   => array(
							'type'    => 'string',
							'default' => '',
							'enum'    => array( '', Documents::STATUS_TRASH ),
						),
						'page'     => array(
							'type'    => 'integer',
							'default' => 1,
							'minimum' => 1,
						),
						'per_page' => array(
							'type'              => 'integer',
							'default'           => 20,
							'validate_callback' => static fn( $value ) => (int) $value >= 1 && (int) $value <= 100,
						),
					),
				),
			)
		);

		$id_arg = array(
			'id' => array(
				'type'     => 'integer',
				'required' => true,
			),
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

		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/duplicate',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'duplicate' ),
					'permission_callback' => array( $this, 'can_duplicate' ),
					'args'                => $id_arg,
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/dependent-pages',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'dependent_pages' ),
					'permission_callback' => array( $this, 'can_list_dependent_pages' ),
					'args'                => $id_arg,
				),
			)
		);
	}

	public function can_read(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function get_documents( WP_REST_Request $request ): WP_REST_Response {
		$status = (string) $request->get_param( 'status' );

		$result = $this->documents->list(
			array(
				'search'          => (string) $request->get_param( 'search' ),
				'kind'            => (string) $request->get_param( 'kind' ),
				'status'          => '' === $status ? null : $status,
				'page'            => (int) $request->get_param( 'page' ),
				'per_page'        => (int) $request->get_param( 'per_page' ),
				'include_excerpt' => Documents::STATUS_TRASH !== $status,
			)
		);

		return new WP_REST_Response( $result, 200 );
	}

	/**
	 * Permission gate for trash mutations. Returns a `WP_Error` with status 404
	 * when the post id is unknown or its post type does not opt into
	 * `cortext-document`, so the caller can tell "not found" from "not allowed"
	 * without leaking permission details. WP REST honours `WP_Error` returns
	 * from permission callbacks.
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

		// Record the tagged subtree before the cascade runs. The
		// `untrashed_post` action fires synchronously inside `wp_untrash_post`,
		// so a post-call query alone could not tell which descendants this
		// restore brought back versus which were already out of trash.
		$candidates = $this->cascade->descendants_for_root( $id );

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

		// Hook deleted_post so the response includes every id that
		// disappeared during this request: explicit page descendants, the
		// document itself, and posts removed by other cascades (collection
		// rows or owned collections deleted on before_delete_post).
		$deleted = array();
		$capture = static function ( $deleted_post_id ) use ( &$deleted ): void {
			$deleted[] = (int) $deleted_post_id;
		};
		add_action( 'deleted_post', $capture );

		try {
			// Page descendants are deleted leaves-first so WordPress's
			// hierarchical delete reparenting has no non-leaf pages left to
			// move.
			$descendants = $this->cascade->descendants_for_root( $id );
			foreach ( array_reverse( $descendants ) as $descendant_id ) {
				wp_delete_post( $descendant_id, true );
			}

			$root_deleted = wp_delete_post( $id, true );
		} finally {
			remove_action( 'deleted_post', $capture );
		}

		if ( ! $root_deleted ) {
			return new WP_Error(
				'cortext_document_delete_failed',
				__( 'Document could not be deleted.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => array_values( array_unique( $deleted ) ),
			),
			200
		);
	}

	/**
	 * Permission gate for duplicate. Mirrors `check_document_post` so a
	 * missing document returns 404 before capability checks can turn it into
	 * a generic forbidden response.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 *
	 * @return bool|WP_Error
	 */
	public function can_duplicate( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post instanceof WP_Post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return current_user_can( 'edit_posts' ) && current_user_can( 'edit_post', $id );
	}

	public function duplicate( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$result = $this->documents->duplicate( (int) $request->get_param( 'id' ) );

		if ( $result instanceof WP_Error ) {
			return $result;
		}

		return new WP_REST_Response( $result, 201 );
	}

	/**
	 * Permission gate for dependent-pages. Only collections have block-level
	 * dependents to enumerate; for any other document kind return 404 so the
	 * caller cannot probe id existence by capability.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 *
	 * @return bool|WP_Error
	 */
	public function can_list_dependent_pages( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post instanceof WP_Post || Collection::POST_TYPE !== $post->post_type ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return current_user_can( 'edit_posts' );
	}

	/**
	 * Returns the public pages containing a `cortext/data-view` block
	 * referencing this collection.
	 *
	 * @see CollectionPublishToggle for use case.
	 *
	 * For speed, search in two stages:
	 *
	 * 1. Match the JSON fragment `"collectionId":%d` in post_content
	 * 2. Run matching posts through `parse_blocks` to remove false positives
	 *
	 * @param WP_REST_Request $request Inbound request.
	 */
	public function dependent_pages( WP_REST_Request $request ): WP_REST_Response {
		$collection_id = (int) $request->get_param( 'id' );

		global $wpdb;

		$needle = '%' . $wpdb->esc_like( sprintf( '"collectionId":%d', $collection_id ) ) . '%';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$candidate_ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts}
				WHERE post_type = %s
					AND post_status = 'publish'
					AND post_content LIKE %s
				LIMIT 200",
				Page::POST_TYPE,
				$needle
			)
		);

		$matches = array();
		foreach ( $candidate_ids as $candidate_id ) {
			$post = get_post( (int) $candidate_id );
			if ( ! $post instanceof WP_Post ) {
				continue;
			}
			if ( ! self::content_depends_on_collection( $post->post_content, $collection_id ) ) {
				continue;
			}
			$link      = get_permalink( $post );
			$matches[] = array(
				'id'    => (int) $post->ID,
				'title' => $post->post_title,
				'link'  => false === $link ? null : $link,
			);
		}

		return new WP_REST_Response( $matches );
	}

	/**
	 * Walks parsed blocks looking for a cortext/data-view with the given
	 * collectionId in its attrs.
	 *
	 * @param string $content       Serialized block content.
	 * @param int    $collection_id Collection to match.
	 */
	private static function content_depends_on_collection( string $content, int $collection_id ): bool {
		// FIXME: parse_blocks does not follow dynamic block references — synced
		// patterns (core/block), reusable blocks, and any future template-part-
		// style indirection won't be walked. Pages that depend on the collection
		// only through one of those will be missed.
		$found = false;
		$walk  = static function ( array $blocks ) use ( &$walk, $collection_id, &$found ): void {
			foreach ( $blocks as $block ) {
				if (
					( $block['blockName'] ?? null ) === 'cortext/data-view'
					&& (int) ( $block['attrs']['collectionId'] ?? 0 ) === $collection_id
				) {
					$found = true;
					return;
				}
				if ( ! empty( $block['innerBlocks'] ) ) {
					$walk( $block['innerBlocks'] );
					if ( $found ) {
						return;
					}
				}
			}
		};
		$walk( parse_blocks( $content ) );
		return $found;
	}

	/**
	 * Runs the standard `WP_REST_Posts_Controller` against the given document
	 * so the response payload matches what `useEntityRecord` already knows how
	 * to consume. Lets clients drop a follow-up GET after a successful restore.
	 *
	 * @param WP_Post $post Document post to render.
	 *
	 * @return mixed
	 */
	private function prepared_post( WP_Post $post ) {
		$post_type_object = get_post_type_object( $post->post_type );
		$rest_base        = $post_type_object && ! empty( $post_type_object->rest_base )
			? $post_type_object->rest_base
			: $post->post_type;

		$rest_request = new WP_REST_Request( 'GET', '/wp/v2/' . $rest_base . '/' . $post->ID );
		$rest_request->set_param( 'context', 'edit' );
		$response = rest_do_request( $rest_request );
		return $response->is_error() ? null : $response->get_data();
	}
}
