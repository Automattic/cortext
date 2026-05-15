<?php
/**
 * REST endpoints for Cortext documents.
 *
 * Lists every post type that opts into the `cortext-document` trait (pages
 * plus collection rows) from one endpoint, so callers do not need to rebuild
 * the post-type list. Also owns restore and permanent-delete for documents in
 * trash; both walk the `PageTrashCascade` marker chain so descendants come
 * along with their root.
 *
 * Single-resource reads still go through `DocumentLocatorController` plus
 * `/wp/v2/<rest_base>/<id>`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Documents;
use Cortext\PostType\Page;
use Cortext\PostType\PageTrashCascade;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class DocumentsController {

	private const NAMESPACE = 'cortext/v1';

	private Documents $documents;

	private PageTrashCascade $cascade;

	public function __construct( ?Documents $documents = null, ?PageTrashCascade $cascade = null ) {
		$this->documents = $documents ?? new Documents();
		$this->cascade   = $cascade ?? new PageTrashCascade();
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
							'enum'    => array( '', Documents::KIND_PAGE, Documents::KIND_ROW ),
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
				'include_excerpt' => true,
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

		// Record the subtree, then delete leaves-first so WP's
		// hierarchical-delete reparenting has nothing to do for any non-leaf.
		$descendants = $this->cascade->descendants_for_root( $id );

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
