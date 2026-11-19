<?php
/**
 * REST endpoints for Cortext documents.
 *
 * Handles listing, archive, restore, permanent delete, duplicate, and
 * collection create through the `Documents` service.
 *
 * Restore and permanent-delete walk descendants via `TrashCascade` so the
 * subtree moves with its root. Single-resource reads still go through
 * `DocumentLocatorController` plus `/wp/v2/<rest_base>/<id>`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use Cortext\FieldValues\FieldValueIndex;
use Cortext\Formula\Materializer as FormulaMaterializer;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentFreeze;
use Cortext\PostType\DocumentWriteGuard;
use Cortext\PostType\TrashCascade;
use Cortext\Relations;
use Cortext\Rest\RowsManualOrder;
use Cortext\Runtime\Experiments;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class DocumentsController {

	private const NAMESPACE = 'cortext/v1';

	private Documents $documents;

	private TrashCascade $cascade;

	private ArchiveCascade $archive_cascade;

	public function __construct(
		?Documents $documents = null,
		?TrashCascade $cascade = null,
		?ArchiveCascade $archive_cascade = null
	) {
		$this->documents       = $documents ?? new Documents();
		$this->cascade         = $cascade ?? new TrashCascade();
		$this->archive_cascade = $archive_cascade ?? new ArchiveCascade();
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
						'status'   => array(
							'type'    => 'string',
							'default' => '',
							'enum'    => array( '', Documents::STATUS_ARCHIVED, Documents::STATUS_TRASH ),
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
			'/documents/(?P<id>\d+)/archive',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'archive' ),
					'permission_callback' => array( $this, 'check_archive_permission' ),
					'args'                => $id_arg,
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/unarchive',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'unarchive' ),
					'permission_callback' => array( $this, 'check_unarchive_permission' ),
					'args'                => $id_arg,
				),
			)
		);

		foreach ( array( 'freeze', 'unfreeze' ) as $action ) {
			register_rest_route(
				self::NAMESPACE,
				'/documents/(?P<id>\d+)/' . $action,
				array(
					array(
						'methods'             => 'POST',
						'callback'            => array( $this, $action ),
						'permission_callback' => array( $this, 'check_freeze_permission' ),
						'args'                => $id_arg,
					),
				)
			);
		}

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
			'/documents/empty-trash',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'empty_trash' ),
					'permission_callback' => array( $this, 'can_empty_trash' ),
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

		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/traits',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_traits' ),
					'permission_callback' => array( $this, 'check_document_membership' ),
					'args'                => $id_arg,
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( $this, 'update_traits' ),
					'permission_callback' => array( $this, 'can_update_document_membership' ),
					'args'                => array(
						'id'             => array(
							'type'     => 'integer',
							'required' => true,
						),
						'collection_ids' => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array( 'type' => 'integer' ),
						),
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/reorder',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'reorder' ),
					'permission_callback' => array( $this, 'can_reorder' ),
					'args'                => array(
						'id'            => array(
							'type'     => 'integer',
							'required' => true,
						),
						'collection_id' => array(
							'type'     => 'integer',
							'required' => false,
						),
						'before_id'     => array(
							'type'     => array( 'integer', 'null' ),
							'required' => false,
						),
						'after_id'      => array(
							'type'     => array( 'integer', 'null' ),
							'required' => false,
						),
						'current_sort'  => array(
							'type'     => array( 'object', 'null' ),
							'required' => false,
						),
					),
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
				'status'          => '' === $status ? null : $status,
				'page'            => (int) $request->get_param( 'page' ),
				'per_page'        => (int) $request->get_param( 'per_page' ),
				'include_excerpt' => ! in_array( $status, array( Documents::STATUS_ARCHIVED, Documents::STATUS_TRASH ), true ),
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

	/**
	 * Checks permission to archive a document and its active descendants.
	 *
	 * Archive does not delete the document, so it requires edit permission
	 * rather than the delete permission used by Trash.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 * @return bool|WP_Error
	 */
	public function check_archive_permission( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post instanceof WP_Post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $this->archive_cascade->current_user_can_archive( $id );
	}

	/**
	 * Checks permission to restore an archived document and its descendants.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 * @return bool|WP_Error
	 */
	public function check_unarchive_permission( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post instanceof WP_Post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $this->archive_cascade->current_user_can_unarchive( $id );
	}

	public function archive( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$id       = (int) $request->get_param( 'id' );
		$archived = $this->archive_cascade->archive( $id );
		if ( $archived instanceof WP_Error ) {
			return $archived;
		}

		$post = get_post( $id );
		return new WP_REST_Response(
			array(
				'archived' => $archived,
				'post'     => $post instanceof WP_Post ? $this->prepared_post( $post ) : null,
			),
			200
		);
	}

	public function unarchive( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$id       = (int) $request->get_param( 'id' );
		$restored = $this->archive_cascade->unarchive( $id );
		if ( $restored instanceof WP_Error ) {
			return $restored;
		}

		$post = get_post( $id );
		return new WP_REST_Response(
			array(
				'restored'  => $restored,
				'published' => $this->published_ids( $restored ),
				'post'      => $post instanceof WP_Post ? $this->prepared_post( $post ) : null,
			),
			200
		);
	}

	/**
	 * Checks permission to freeze or unfreeze a document. Anyone who can edit
	 * the document can toggle it.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 * @return bool|WP_Error
	 */
	public function check_freeze_permission( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post instanceof WP_Post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return current_user_can( 'edit_post', $id );
	}

	public function freeze( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		return $this->toggle_freeze( (int) $request->get_param( 'id' ), true );
	}

	public function unfreeze( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		return $this->toggle_freeze( (int) $request->get_param( 'id' ), false );
	}

	private function toggle_freeze( int $id, bool $frozen ): WP_REST_Response|WP_Error {
		$post = get_post( $id );

		// Archived and trashed documents are already read-only; restore them first.
		$lifecycle_error = DocumentWriteGuard::lifecycle_error( $post );
		if ( $lifecycle_error instanceof WP_Error ) {
			return $lifecycle_error;
		}

		if ( $frozen ) {
			DocumentFreeze::freeze( $id );
		} else {
			DocumentFreeze::unfreeze( $id );
		}

		return new WP_REST_Response( array( 'post' => $this->prepared_post( $post ) ), 200 );
	}

	/**
	 * Permission gate for the traits (memberships) endpoint. The document must
	 * be a `crtxt_document` that is not itself a collection, and the user must be
	 * able to edit it. A collection cannot be a member of another collection, so
	 * that returns 400 rather than letting the write through.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 *
	 * @return bool|WP_Error
	 */
	public function check_document_membership( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( Document::is_collection_post( $post ) ) {
			return new WP_Error(
				'cortext_membership_unsupported',
				__( 'Collections cannot belong to collections.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		return current_user_can( 'edit_post', $id );
	}

	/**
	 * Permission gate for changing collection memberships. Reading the current
	 * memberships stays available so existing multi-collection data remains
	 * understandable if the experiment is later disabled.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 *
	 * @return bool|WP_Error
	 */
	public function can_update_document_membership( WP_REST_Request $request ) {
		if ( ! ( new Experiments() )->is_enabled( Experiments::TRAITS_ID ) ) {
			return new WP_Error(
				'cortext_experiment_disabled',
				__( 'Traits are not enabled.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $this->check_document_membership( $request );
	}

	/**
	 * GET /documents/<id>/traits: the collections a document currently belongs to.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 */
	public function get_traits( WP_REST_Request $request ): WP_REST_Response {
		$id = (int) $request->get_param( 'id' );

		return new WP_REST_Response(
			array( 'collections' => $this->documents->get_memberships( $id ) ),
			200
		);
	}

	/**
	 * PUT /documents/<id>/traits: replaces a document's collection memberships
	 * with `collection_ids`. Rejects an empty set so the UI cannot strip the last
	 * membership in v1.
	 *
	 * After the write it reconciles derived state for the collections that
	 * actually changed:
	 *   - Left collections: detach relation reverse pointers their fields hold on
	 *     other rows (so those rows stop pointing back), then drop the row's
	 *     field-value index rows for that collection. Forward field meta is kept,
	 *     so re-adding the collection restores the row's values.
	 *   - Joined collections: rebuild the index and relation reverse pointers for
	 *     the row's existing values of that collection's fields, so indexed reads
	 *     and related rows reflect the membership immediately instead of waiting
	 *     for a field edit or a full rebuild.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 */
	public function update_traits( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$id  = (int) $request->get_param( 'id' );
		$raw = $request->get_param( 'collection_ids' );

		$collection_ids = is_array( $raw )
			? array_values(
				array_unique(
					array_filter(
						array_map( 'intval', $raw ),
						static fn( int $collection_id ): bool => $collection_id > 0
					)
				)
			)
			: array();

		if ( count( $collection_ids ) === 0 ) {
			return new WP_Error(
				'cortext_membership_empty',
				__( 'A row must belong to at least one active collection.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		// Only rows change memberships here. Giving a page its first collection
		// would turn it into a row and drop it, with its child pages, out of the
		// page tree.
		$before = $this->documents->membership_ids( $id );
		if ( count( $before ) === 0 ) {
			return new WP_Error(
				'cortext_membership_unsupported',
				__( 'Only rows can change collection memberships.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$allowed = $this->authorize_membership_changes( $before, $collection_ids );
		if ( $allowed instanceof WP_Error ) {
			return $allowed;
		}

		$result = $this->documents->set_memberships( $id, $collection_ids );
		if ( $result instanceof WP_Error ) {
			return $result;
		}

		$removed = array_values( array_diff( $before, $result ) );
		$added   = array_values( array_diff( $result, $before ) );
		$index   = new FieldValueIndex();

		foreach ( $removed as $removed_collection_id ) {
			$removed_collection_id = (int) $removed_collection_id;
			$detached_field_ids    = $this->relation_field_ids( $removed_collection_id, $result );
			if ( count( $detached_field_ids ) > 0 ) {
				Relations::remove_deleted_row_references( $id, $detached_field_ids );
			}
			$index->delete_row_for_collection( $id, $removed_collection_id );
		}

		foreach ( $added as $added_collection_id ) {
			$added_collection_id = (int) $added_collection_id;
			FormulaMaterializer::recompute_row( $added_collection_id, $id );
			foreach ( Document::collection_field_ids( $added_collection_id ) as $field_id ) {
				$field_id   = (int) $field_id;
				$field_type = (string) get_post_meta( $field_id, 'type', true );
				if ( 'relation' === $field_type ) {
					$this->restore_relation_pointers( $id, $field_id );
				}
				if ( '' !== $field_type && 'rollup' !== $field_type ) {
					$index->index_row_field( $id, $field_id, $added_collection_id );
				}
			}
		}

		return new WP_REST_Response(
			array( 'collections' => $this->documents->get_memberships( $id ) ),
			200
		);
	}

	/**
	 * Validates every requested membership before a write, then requires edit
	 * permission for each collection whose membership would actually change.
	 * Unchanged memberships do not mutate their collection and need no extra
	 * capability check.
	 *
	 * @param int[] $before         Current collection ids.
	 * @param int[] $collection_ids Requested collection ids.
	 * @return true|WP_Error
	 */
	private function authorize_membership_changes( array $before, array $collection_ids ): bool|WP_Error {
		$has_active_membership = false;
		foreach ( $collection_ids as $collection_id ) {
			$collection = get_post( $collection_id );
			if (
				! $collection instanceof WP_Post
				|| (
					Documents::STATUS_TRASH === $collection->post_status
					&& ! in_array( $collection_id, $before, true )
				)
				|| ! Document::is_collection_post( $collection )
				|| TraitTaxonomy::term_id_for_trait( $collection_id ) < 1
			) {
				return new WP_Error(
					'cortext_trait_not_found',
					__( 'Collection not found.', 'cortext' ),
					array(
						'status'        => 404,
						'collection_id' => $collection_id,
					)
				);
			}

			if ( Documents::STATUS_TRASH !== $collection->post_status ) {
				$has_active_membership = true;
			}
		}

		// A lifecycle-preserved membership in a trashed collection is not enough
		// to keep a live row addressable. Require at least one collection that can
		// actually surface the row before changing any taxonomy relationships.
		if ( ! $has_active_membership ) {
			return new WP_Error(
				'cortext_membership_empty',
				__( 'A row must belong to at least one active collection.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$changed = array_values(
			array_unique(
				array_merge(
					array_diff( $before, $collection_ids ),
					array_diff( $collection_ids, $before )
				)
			)
		);
		foreach ( $changed as $collection_id ) {
			if ( ! current_user_can( 'edit_post', $collection_id ) ) {
				return new WP_Error(
					'cortext_membership_collection_forbidden',
					__( 'You are not allowed to change membership for this collection.', 'cortext' ),
					array( 'status' => rest_authorization_required_code() )
				);
			}
		}

		return true;
	}

	/**
	 * Restores reverse pointers for a retained forward relation value when its
	 * collection membership returns. The normal relation update preparer sees
	 * the retained forward value as both current and desired and therefore has
	 * no delta to apply, so this recovery path explicitly starts from an empty
	 * reverse-pointer state.
	 *
	 * A single-valued reverse slot that another row took while this row was out
	 * of the collection keeps that newer link. The target is dropped from this
	 * row's retained forward value instead of being taken back.
	 *
	 * @param int $row_id   Row whose membership was restored.
	 * @param int $field_id Relation field id.
	 */
	private function restore_relation_pointers( int $row_id, int $field_id ): void {
		$reverse_id = (int) get_post_meta( $field_id, 'relation_reverse_field_id', true );
		if ( $reverse_id < 1 || 'relation' !== (string) get_post_meta( $reverse_id, 'type', true ) ) {
			return;
		}

		$target_collection_id = (int) get_post_meta( $field_id, 'related_collection_id', true );
		$multiple             = Relations::relation_is_multiple( $field_id );
		$reverse_multiple     = Relations::relation_is_multiple( $reverse_id );
		$desired              = array_values(
			array_filter(
				Relations::normalize_row_ids(
					Relations::relation_values( $row_id, $field_id ),
					$multiple
				),
				static fn( int $target_id ): bool => Relations::document_belongs_to_collection(
					$target_id,
					$target_collection_id
				)
			)
		);

		if ( ! $reverse_multiple ) {
			$claimed = array_values(
				array_filter(
					$desired,
					static fn( int $target_id ): bool => count(
						array_diff( Relations::relation_values( $target_id, $reverse_id ), array( $row_id ) )
					) > 0
				)
			);
			if ( count( $claimed ) > 0 ) {
				$desired = array_values( array_diff( $desired, $claimed ) );
				Relations::set_relation_values(
					$row_id,
					$field_id,
					array_values( array_diff( Relations::relation_values( $row_id, $field_id ), $claimed ) ),
					$multiple
				);
			}
		}

		Relations::apply_relation_pointers(
			$row_id,
			$field_id,
			array(
				'reverse_id'       => $reverse_id,
				'multiple'         => $multiple,
				'reverse_multiple' => $reverse_multiple,
				'desired'          => $desired,
				'current'          => array(),
			)
		);

		// Verify through the public meta API that the batch write is visible.
		// This also repairs a genuinely missing pointer without duplicating one
		// that `apply_relation_pointers` already restored.
		$index = null;
		foreach ( $desired as $target_id ) {
			$reverse_values = Relations::relation_values( $target_id, $reverse_id );
			if ( in_array( $row_id, $reverse_values, true ) ) {
				continue;
			}
			Relations::set_relation_values(
				$target_id,
				$reverse_id,
				$reverse_multiple ? array_merge( $reverse_values, array( $row_id ) ) : array( $row_id ),
				$reverse_multiple
			);
			$index ??= new FieldValueIndex();
			$index->index_row_field( $target_id, $reverse_id );
		}
	}

	/**
	 * Relation field ids in a collection's schema that no retained collection
	 * still owns. A field definition may be shared by two schemas; leaving one
	 * must not detach reverse pointers while the row still exposes that same
	 * field through another membership.
	 *
	 * @param int   $collection_id          Collection document id.
	 * @param int[] $retained_collection_ids Memberships that remain on the row.
	 * @return int[]
	 */
	private function relation_field_ids( int $collection_id, array $retained_collection_ids = array() ): array {
		$retained_fields = array();
		foreach ( $retained_collection_ids as $retained_collection_id ) {
			foreach ( Document::collection_field_ids( (int) $retained_collection_id ) as $field_id ) {
				$retained_fields[ (int) $field_id ] = true;
			}
		}

		$ids = array();
		foreach ( Document::collection_field_ids( $collection_id ) as $field_id ) {
			if (
				! isset( $retained_fields[ (int) $field_id ] )
				&& 'relation' === (string) get_post_meta( (int) $field_id, 'type', true )
			) {
				$ids[] = (int) $field_id;
			}
		}
		return $ids;
	}

	public function restore( WP_REST_Request $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );

		if ( 'trash' !== $post->post_status ) {
			return new WP_Error(
				'cortext_document_not_trashed',
				__( 'Document is not in Trash.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		// Record the tagged subtree before the cascade runs. The
		// `untrashed_post` action fires synchronously inside `wp_untrash_post`,
		// so a post-call query alone could not tell which descendants this
		// restore brought back versus which were already out of trash.
		$candidates           = $this->cascade->restore_candidates_for_root( $id );
		$restoring_active_ids = array_values(
			array_filter(
				array_merge( array( $id ), $candidates ),
				static fn( int $post_id ): bool => Documents::STATUS_ARCHIVED
					!== (string) get_post_meta( $post_id, '_wp_trash_meta_status', true )
			)
		);
		$container_error      = $this->archive_cascade->container_error_for_documents(
			$restoring_active_ids,
			$restoring_active_ids
		);
		if ( $container_error instanceof WP_Error ) {
			return $container_error;
		}

		$result = wp_untrash_post( $id );
		if ( ! $result ) {
			return new WP_Error(
				'cortext_document_restore_failed',
				__( 'Couldn\'t restore the document.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		$revived = array();
		foreach ( $candidates as $candidate_id ) {
			if ( 'trash' !== get_post_status( $candidate_id ) ) {
				$revived[] = $candidate_id;
			}
		}

		$restored = array_values( array_unique( array_merge( array( $id ), $revived ) ) );
		return new WP_REST_Response(
			array(
				'restored'  => $restored,
				'published' => $this->published_ids( $restored ),
				'post'      => $this->prepared_post( $post ),
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
				__( 'Document is not in Trash.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$root_deleted = false;
		$deleted      = $this->capture_deleted_ids(
			function () use ( $id, &$root_deleted ): void {
				$root_deleted = $this->delete_trashed_tree( $id );
			}
		);

		if ( ! $root_deleted ) {
			return new WP_Error(
				'cortext_document_delete_failed',
				__( 'Couldn\'t delete the document.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => $deleted,
			),
			200
		);
	}

	public function can_empty_trash(): bool {
		return current_user_can( 'delete_posts' );
	}

	/**
	 * Permanently deletes every trashed document the current user may delete.
	 * Works root by root, so each cascade is deleted the same way as a single
	 * permanent delete. Like that endpoint, the capability check covers the
	 * roots, not each descendant a root's cascade marked.
	 *
	 * @return WP_REST_Response
	 */
	public function empty_trash(): WP_REST_Response {
		$deletable_ids = array_values(
			array_filter(
				array_map(
					'intval',
					get_posts(
						array(
							'post_type'      => Document::POST_TYPE,
							'post_status'    => Documents::STATUS_TRASH,
							'fields'         => 'ids',
							'posts_per_page' => -1,
							'no_found_rows'  => true,
						)
					)
				),
				static fn( int $post_id ): bool => current_user_can( 'delete_post', $post_id )
			)
		);
		$deletable     = array_flip( $deletable_ids );

		// A document is a root unless its marker points at another document
		// this user can delete, which takes it along. When the marker points
		// at someone else's document, the user's own document is a root.
		$root_ids = array_filter(
			$deletable_ids,
			static function ( int $post_id ) use ( $deletable ): bool {
				foreach ( array( TrashCascade::PARENT_MARKER_META, TrashCascade::COLLECTION_MARKER_META ) as $marker ) {
					if ( isset( $deletable[ (int) get_post_meta( $post_id, $marker, true ) ] ) ) {
						return false;
					}
				}
				return true;
			}
		);

		$deleted = $this->capture_deleted_ids(
			function () use ( $root_ids ): void {
				foreach ( $root_ids as $root_id ) {
					// An earlier root may have taken this one with it, e.g.
					// a collection deletes all of its rows.
					if ( Documents::STATUS_TRASH === get_post_status( $root_id ) ) {
						$this->delete_trashed_tree( $root_id );
					}
				}
			}
		);

		return new WP_REST_Response( array( 'deleted' => $deleted ), 200 );
	}

	/**
	 * Deletes a trashed document and the descendants its trash cascade marked.
	 * Descendants go leaves-first so WordPress's hierarchical delete
	 * reparenting has no non-leaf pages left to move.
	 *
	 * @param int $root_id Trashed document.
	 * @return bool Whether the root itself was deleted.
	 */
	private function delete_trashed_tree( int $root_id ): bool {
		foreach ( array_reverse( $this->cascade->descendants_for_root( $root_id ) ) as $descendant_id ) {
			wp_delete_post( $descendant_id, true );
		}

		return (bool) wp_delete_post( $root_id, true );
	}

	/**
	 * Runs a delete and returns every post id that disappeared while it ran:
	 * explicit descendants, the roots, and posts removed by other cascades
	 * (collection rows or owned collections deleted on `before_delete_post`).
	 *
	 * @param callable $delete Performs the deletes.
	 * @return int[]
	 */
	private function capture_deleted_ids( callable $delete ): array {
		$deleted = array();
		$capture = static function ( $deleted_post_id ) use ( &$deleted ): void {
			$deleted[] = (int) $deleted_post_id;
		};
		add_action( 'deleted_post', $capture );

		try {
			$delete();
		} finally {
			remove_action( 'deleted_post', $capture );
		}

		return array_values( array_unique( $deleted ) );
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

		if ( ! current_user_can( 'edit_posts' ) || ! current_user_can( 'edit_post', $id ) ) {
			return false;
		}

		// Duplicating a row creates a new member in every copied collection, so
		// enforce the same collection capability boundary as PUT /traits. Use the
		// full term-backed set, including lifecycle-preserved trash memberships;
		// otherwise duplication would be a back door into a protected collection.
		foreach ( $this->documents->find_traits_for_document( $post ) as $collection ) {
			if ( ! current_user_can( 'edit_post', $collection->ID ) ) {
				return new WP_Error(
					'cortext_duplicate_collection_forbidden',
					__( 'You are not allowed to duplicate a row into one of its collections.', 'cortext' ),
					array( 'status' => rest_authorization_required_code() )
				);
			}
		}

		return true;
	}

	public function duplicate( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$result = $this->documents->duplicate( (int) $request->get_param( 'id' ) );

		if ( $result instanceof WP_Error ) {
			return $result;
		}

		// Costs one internal REST request that runs the full row enrichment
		// (relations, rollups, formula materialization) for the new row. That
		// buys clients a canonical record they can cache instead of the
		// envelope, so a null here still leaves the duplicate successful.
		$post           = get_post( (int) $result['id'] );
		$result['post'] = $post instanceof WP_Post
			? $this->prepared_post( $post )
			: null;

		return new WP_REST_Response( $result, 201 );
	}

	/**
	 * Permission gate for reorder. Both the row and the resolved collection must
	 * be editable because manual order mutates their scoped taxonomy relationship
	 * and may seed state on the collection.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 *
	 * @return bool|WP_Error
	 */
	public function can_reorder( WP_REST_Request $request ) {
		$scope = $this->validate_reorder_scope( $request );
		if ( $scope instanceof WP_Error ) {
			return $scope;
		}

		return current_user_can( 'edit_post', $scope['row']->ID )
			&& current_user_can( 'edit_post', $scope['collection']->ID );
	}

	public function reorder( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$scope = $this->validate_reorder_scope( $request );
		if ( $scope instanceof WP_Error ) {
			return $scope;
		}

		$row_id        = (int) $scope['row']->ID;
		$collection_id = (int) $scope['collection']->ID;
		$before_id     = $this->nullable_id( $request->get_param( 'before_id' ) );
		$after_id      = $this->nullable_id( $request->get_param( 'after_id' ) );
		$current_sort  = $request->get_param( 'current_sort' );
		$current_sort  = is_array( $current_sort ) ? $current_sort : null;

		if ( null === $before_id && null === $after_id ) {
			return new WP_Error(
				'cortext_reorder_neighbor_required',
				__( 'Choose a position for the row.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$manual_order = new RowsManualOrder();
		if (
			! $manual_order->is_seeded( $collection_id ) &&
			! array_key_exists( 'current_sort', $request->get_params() )
		) {
			return new WP_Error(
				'cortext_reorder_current_sort_required',
				__( 'Send the current sort before starting manual order.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$result = $manual_order->move_row(
			$collection_id,
			$row_id,
			$before_id,
			$after_id,
			$current_sort
		);
		if ( $result instanceof WP_Error ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	/**
	 * Resolves and validates the collection-scoped row relationship requested by
	 * a reorder call. New clients send `collection_id` so a shared row can be
	 * ordered independently in each collection; legacy clients omit it and fall
	 * back to the row's first active trait.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 * @return array{row:WP_Post,collection:WP_Post}|WP_Error
	 */
	private function validate_reorder_scope( WP_REST_Request $request ): array|WP_Error {
		$row_id = (int) $request->get_param( 'id' );
		$row    = get_post( $row_id );
		if ( ! $row instanceof WP_Post || Document::POST_TYPE !== $row->post_type ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( Document::is_collection_post( $row ) || count( $this->documents->find_traits_for_document( $row ) ) === 0 ) {
			return new WP_Error(
				'cortext_reorder_unsupported',
				__( 'Reordering is only supported for rows.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$has_explicit_collection = $request->has_param( 'collection_id' );
		$collection_id           = (int) $request->get_param( 'collection_id' );
		// Without an explicit collection, fall back to a hidden membership so the
		// manual-order service can ask for that collection to be restored.
		$collection = $has_explicit_collection
			? get_post( $collection_id )
			: (
				$this->documents->find_trait_for_document( $row )
				?? ( $this->documents->find_traits_for_document( $row )[0] ?? null )
			);
		if ( ! $has_explicit_collection && ! $collection instanceof WP_Post ) {
			return new WP_Error(
				'cortext_reorder_unsupported',
				__( 'Reordering is only supported for rows.', 'cortext' ),
				array( 'status' => 400 )
			);
		}
		if ( $collection instanceof WP_Post ) {
			$collection_id = (int) $collection->ID;
		}
		if ( ! $collection instanceof WP_Post || ! Document::is_collection_post( $collection ) ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( ! Relations::document_belongs_to_collection( $row_id, $collection_id ) ) {
			return new WP_Error(
				'cortext_row_not_found',
				__( 'Row not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return array(
			'row'        => $row,
			'collection' => $collection,
		);
	}

	private function nullable_id( mixed $value ): ?int {
		if ( null === $value ) {
			return null;
		}
		$id = (int) $value;
		return $id > 0 ? $id : null;
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

		if ( ! $post instanceof WP_Post || ! Document::is_collection_post( $post ) ) {
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
	 * @see DocumentPublishToggle for use case.
	 *
	 * For speed, search in two stages:
	 *
	 * 1. Match `"collectionId":%d,` or `"collectionId":%d}` in post_content.
	 *    This rules out prefix collisions (e.g. id 12 matching
	 *    `"collectionId":123`).
	 *
	 * 2. Run matching posts through `parse_blocks` to remove any false
	 *    positives (e.g. the fragment appearing inside a string value).
	 *
	 * @param WP_REST_Request $request Inbound request.
	 */
	public function dependent_pages( WP_REST_Request $request ): WP_REST_Response {
		$collection_id = (int) $request->get_param( 'id' );

		global $wpdb;

		$prefix       = sprintf( '"collectionId":%d', $collection_id );
		$needle_comma = '%' . $wpdb->esc_like( $prefix . ',' ) . '%';
		$needle_brace = '%' . $wpdb->esc_like( $prefix . '}' ) . '%';

		// An arbitrarily high LIMIT on SELECT, just to be safe. We never
		// expect it to be hit, because it would either mean that the same
		// collection is embedded in way too many different pages (at which
		// point it's irrelevant to the user whether we can list them all), or
		// it would mean that there are impossibly many false positives (such
		// as the string `"collectionId":123,` as plain text in post content).
		//
		// Let's not stress too much over this.
		$limit = 200;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$candidate_ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts}
				WHERE post_type = %s
					AND post_status = 'publish'
					AND ID != %d
					AND ( post_content LIKE %s OR post_content LIKE %s )
				LIMIT %d",
				Document::POST_TYPE,
				$collection_id,
				$needle_comma,
				$needle_brace,
				$limit
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
	 * Returns the given document IDs whose status is `publish`.
	 *
	 * @param int[] $ids Document IDs.
	 * @return int[]
	 */
	private function published_ids( array $ids ): array {
		return array_values(
			array_filter(
				$ids,
				static fn( int $post_id ): bool => 'publish' === get_post_status( $post_id )
			)
		);
	}

	/**
	 * Returns the document in the REST post shape expected by `useEntityRecord`.
	 * Restore and duplicate responses can include it instead of requiring
	 * another GET.
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
