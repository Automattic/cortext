<?php
/**
 * REST endpoint for restoring Cortext document revisions.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use Cortext\Editor\RevisionThrottle;
use Cortext\FieldValues\FieldValueIndex;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\Relations;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class RestoreRevisionController {

	private const NAMESPACE = 'cortext/v1';

	private Documents $documents;

	public function __construct( ?Documents $documents = null ) {
		$this->documents = $documents ?? new Documents();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)/restore-revision',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'restore' ),
					'permission_callback' => array( $this, 'can_restore' ),
					'args'                => array(
						'id'          => array(
							'type'     => 'integer',
							'required' => true,
						),
						'revision_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	public function can_restore( WP_REST_Request $request ): bool|WP_Error {
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

	public function restore( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$post_id     = (int) $request->get_param( 'id' );
		$revision_id = (int) $request->get_param( 'revision_id' );
		$post        = get_post( $post_id );

		if ( ! $post instanceof WP_Post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( 'trash' === $post->post_status ) {
			return new WP_Error(
				'cortext_revision_restore_trashed_document',
				__( 'Take the document out of Trash before restoring a revision.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$revision = $this->get_revision_for_post( $post_id, $revision_id );
		if ( $revision instanceof WP_Error ) {
			return $revision;
		}

		$snapshot_id = $this->snapshot_current_state( $post_id );
		if ( $snapshot_id instanceof WP_Error ) {
			return $snapshot_id;
		}

		// Revision fields come unslashed from get_post(), and wp_update_post()
		// unslashes its input, so re-slash to keep backslashes intact. Mirrors
		// core's wp_restore_post_revision() ("Since data is from DB.").
		$updated = wp_update_post(
			wp_slash(
				array(
					'ID'           => $post_id,
					'post_title'   => $revision->post_title,
					'post_content' => $revision->post_content,
					'post_excerpt' => $revision->post_excerpt,
				)
			),
			true
		);
		if ( $updated instanceof WP_Error ) {
			return $updated;
		}

		$meta_result = $this->restore_revision_meta( $post_id, $revision );
		if ( $meta_result instanceof WP_Error ) {
			return $meta_result;
		}

		return new WP_REST_Response(
			array(
				'restored'     => $post_id,
				'revision'     => $revision_id,
				'snapshot'     => $snapshot_id,
				'post'         => $this->prepared_post( $post_id ),
				'metaRestored' => $meta_result,
			),
			200
		);
	}

	private function get_revision_for_post( int $post_id, int $revision_id ): WP_Post|WP_Error {
		$revision = get_post( $revision_id );
		if ( ! $revision instanceof WP_Post || 'revision' !== $revision->post_type ) {
			return new WP_Error(
				'cortext_revision_not_found',
				__( 'Revision not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$parent_id = (int) wp_is_post_revision( $revision_id );
		if ( $parent_id !== $post_id ) {
			return new WP_Error(
				'cortext_revision_not_for_document',
				__( 'Revision does not belong to this document.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		return $revision;
	}

	private function snapshot_current_state( int $post_id ): int|WP_Error {
		if ( ! function_exists( 'wp_save_post_revision' ) ) {
			return 0;
		}

		$snapshot_id = RevisionThrottle::with_bypass(
			static fn() => wp_save_post_revision( $post_id )
		);

		if ( $snapshot_id instanceof WP_Error ) {
			return $snapshot_id;
		}

		return (int) $snapshot_id;
	}

	/**
	 * Restores revisioned Cortext meta and keeps relation/index side effects in sync.
	 *
	 * @param int     $post_id  Document being restored.
	 * @param WP_Post $revision Revision post.
	 * @return array{fields:int,relations:int,schema:int,identity:int}|WP_Error
	 */
	private function restore_revision_meta( int $post_id, WP_Post $revision ): array|WP_Error {
		$schema_keys   = array( 'cortext_fields', 'cortext_detail_layout' );
		$identity_keys = array( DocumentIdentity::META_KEY, '_thumbnail_id' );
		$restored      = array(
			'fields'    => 0,
			'relations' => 0,
			'schema'    => 0,
			'identity'  => 0,
		);

		foreach ( $schema_keys as $key ) {
			$this->replace_meta_values( $post_id, $key, get_post_meta( (int) $revision->ID, $key, false ) );
			++$restored['schema'];
		}

		foreach ( $identity_keys as $key ) {
			$this->replace_meta_values( $post_id, $key, get_post_meta( (int) $revision->ID, $key, false ) );
			++$restored['identity'];
		}

		$field_ids = $this->field_ids_for_document( $post_id );
		if ( count( $field_ids ) === 0 ) {
			return $restored;
		}

		$collection_id = $this->collection_id_for_row( $post_id );
		$index         = new FieldValueIndex();

		foreach ( $field_ids as $field_id ) {
			$field_type = (string) get_post_meta( $field_id, 'type', true );
			if ( '' === $field_type || 'rollup' === $field_type ) {
				continue;
			}

			$key    = Relations::meta_key( $field_id );
			$values = get_post_meta( (int) $revision->ID, $key, false );
			if ( 'relation' === $field_type ) {
				$result = Relations::sync_relation_value( $post_id, $field_id, $values );
				if ( $result instanceof WP_Error ) {
					return $result;
				}
				++$restored['relations'];
			} else {
				$this->replace_meta_values( $post_id, $key, $values );
				++$restored['fields'];
			}

			$index->index_row_field( $post_id, $field_id, $collection_id );
		}

		return $restored;
	}

	/**
	 * Returns row field IDs for the document's collection.
	 *
	 * @param int $post_id Document ID.
	 * @return int[]
	 */
	private function field_ids_for_document( int $post_id ): array {
		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post ) {
			return array();
		}

		$collection = $this->documents->find_trait_for_document( $post );
		if ( ! $collection instanceof WP_Post ) {
			return array();
		}

		return Document::collection_field_ids( (int) $collection->ID );
	}

	private function collection_id_for_row( int $post_id ): ?int {
		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post ) {
			return null;
		}

		$collection = $this->documents->find_trait_for_document( $post );
		return $collection instanceof WP_Post ? (int) $collection->ID : null;
	}

	/**
	 * Replaces all values for one meta key.
	 *
	 * @param int     $post_id Document ID.
	 * @param string  $key     Meta key.
	 * @param mixed[] $values Revision meta values.
	 */
	private function replace_meta_values( int $post_id, string $key, array $values ): void {
		delete_post_meta( $post_id, $key );
		foreach ( $values as $value ) {
			// $values are already unserialized by get_post_meta(); re-slash so
			// add_post_meta()'s internal unslashing preserves backslashes. No
			// second maybe_unserialize(): that would double-decode a value whose
			// string form looks serialized.
			add_post_meta( $post_id, $key, wp_slash( $value ) );
		}
	}

	/**
	 * Runs the core posts controller so the response can hydrate core-data.
	 *
	 * @param int $post_id Document ID.
	 * @return mixed
	 */
	private function prepared_post( int $post_id ) {
		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post ) {
			return null;
		}

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
