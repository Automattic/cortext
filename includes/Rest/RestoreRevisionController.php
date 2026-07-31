<?php
/**
 * REST endpoint for restoring Cortext document revisions.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\Editor\RevisionMetaFormat;
use Cortext\Editor\RevisionThrottle;
use Cortext\FieldValues\FieldValueIndex;
use Cortext\Formula\Materializer as FormulaMaterializer;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class RestoreRevisionController {

	private const NAMESPACE = 'cortext/v1';

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

		if ( ! current_user_can( 'edit_post', $id ) ) {
			return false;
		}

		$lock_error = $this->post_lock_error( $id );
		return $lock_error ?? true;
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

		$lock_error = $this->post_lock_error( $post_id );
		if ( $lock_error instanceof WP_Error ) {
			return $lock_error;
		}

		$revision = $this->get_revision_for_post( $post_id, $revision_id );
		if ( $revision instanceof WP_Error ) {
			return $revision;
		}

		// Load and validate every revision value before the safety snapshot. At
		// the revision cap, that snapshot can prune the selected revision; relation
		// validation must also finish before any part of the document is mutated.
		$restore_plan = $this->prepare_restore_plan( $post_id, $revision );
		if ( $restore_plan instanceof WP_Error ) {
			return $restore_plan;
		}

		$snapshot_id = $this->snapshot_current_state( $post_id );
		if ( $snapshot_id instanceof WP_Error ) {
			return $snapshot_id;
		}

		// Revision fields come unslashed from get_post(), and wp_update_post()
		// unslashes its input, so re-slash to keep backslashes intact. Mirrors
		// core's wp_restore_post_revision() ("Since data is from DB.").
		//
		// Suppress WordPress's own post_updated revision: it would land between
		// the content write and the meta write, recording restored content
		// against pre-restore metadata. The explicit snapshots on either side of
		// this call already cover the before and after states.
		$updated = RevisionThrottle::with_suppression(
			static fn() => wp_update_post(
				wp_slash(
					array(
						'ID'           => $post_id,
						'post_title'   => $restore_plan['post']['post_title'],
						'post_content' => $restore_plan['post']['post_content'],
						'post_excerpt' => $restore_plan['post']['post_excerpt'],
					)
				),
				true
			)
		);
		if ( $updated instanceof WP_Error ) {
			return $updated;
		}

		$meta_result = $this->apply_restore_plan( $post_id, $restore_plan );

		$restored_snapshot_id = $this->snapshot_current_state( $post_id );
		if ( $restored_snapshot_id instanceof WP_Error ) {
			return $restored_snapshot_id;
		}

		return new WP_REST_Response(
			array(
				'restored'         => $post_id,
				'revision'         => $revision_id,
				'snapshot'         => $snapshot_id,
				'restoredSnapshot' => $restored_snapshot_id,
				'post'             => $this->prepared_post( $post_id ),
				'metaRestored'     => $meta_result,
				'contentOnly'      => $restore_plan['content_only'],
			),
			200
		);
	}

	/**
	 * Returns an error when another user owns the document's active post lock.
	 *
	 * @param int $post_id Document ID.
	 */
	private function post_lock_error( int $post_id ): ?WP_Error {
		$this->ensure_post_lock_functions();
		$locked_user_id = wp_check_post_lock( $post_id );
		if ( ! $locked_user_id ) {
			return null;
		}

		return new WP_Error(
			'cortext_revision_restore_locked_document',
			__( 'Another user is editing this document.', 'cortext' ),
			array(
				'status' => 409,
				'user'   => (int) $locked_user_id,
			)
		);
	}

	private function ensure_post_lock_functions(): void {
		if ( function_exists( 'wp_check_post_lock' ) ) {
			return;
		}

		require_once ABSPATH . 'wp-admin/includes/post.php';
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
	 * Reads and validates a revision without mutating the live document.
	 *
	 * @param int     $post_id  Document being restored.
	 * @param WP_Post $revision Revision post.
	 * @return array{
	 *     post:array{post_title:string,post_content:string,post_excerpt:string},
	 *     schema:array<string,mixed[]>,
	 *     identity:array<string,mixed[]>,
	 *     fields:array<int,array{type:string,values:mixed[],collection_id:int,relation?:array}>,
	 *     collections:int[]
	 * }|WP_Error
	 */
	private function prepare_restore_plan( int $post_id, WP_Post $revision ): array|WP_Error {
		$schema_keys   = array( 'cortext_fields', 'cortext_detail_layout' );
		$identity_keys = array( DocumentIdentity::META_KEY, '_thumbnail_id' );
		$revision_id   = (int) $revision->ID;
		$plan          = array(
			'post'         => array(
				'post_title'   => (string) $revision->post_title,
				'post_content' => (string) $revision->post_content,
				'post_excerpt' => (string) $revision->post_excerpt,
			),
			'schema'       => array(),
			'identity'     => array(),
			'fields'       => array(),
			'collections'  => array(),
			'content_only' => false,
		);

		// A revision stored before Cortext revisioned metadata knows nothing
		// about the icon, cover, schema or field values. Treating that silence
		// as "empty" would clear all of them on the live document, so restore
		// the content it does know and leave everything else alone.
		if ( ! RevisionMetaFormat::carries_meta( $revision_id ) ) {
			$plan['content_only'] = true;
			return $plan;
		}

		foreach ( $schema_keys as $key ) {
			// Revisions taken before these keys became revisioned carry no copy
			// at all, and restoring from an absent value would delete a
			// collection's live field schema. An empty list is how an absent key
			// reads, so only replace what the revision actually holds.
			$values = get_post_meta( $revision_id, $key, false );
			if ( array() !== $values ) {
				$plan['schema'][ $key ] = $values;
			}
		}
		$plan['schema'] = $this->filter_revision_schema( $post_id, $plan['schema'] );

		foreach ( $identity_keys as $key ) {
			$plan['identity'][ $key ] = get_post_meta( $revision_id, $key, false );
		}

		foreach ( $this->field_contexts_for_document( $post_id ) as $field_id => $collection_id ) {
			$plan['collections'][ $collection_id ] = $collection_id;

			$field_type = (string) get_post_meta( $field_id, 'type', true );
			// Rollups and formulas are derived, not authored: their stored value
			// is materialised output. Writing a revision's copy back would
			// resurrect a stale result, so they get recomputed after the fields
			// they depend on land.
			if ( '' === $field_type || 'rollup' === $field_type || 'formula' === $field_type ) {
				continue;
			}

			$key    = Relations::meta_key( $field_id );
			$values = get_post_meta( $revision_id, $key, false );
			$field  = array(
				'type'          => $field_type,
				'values'        => $values,
				'collection_id' => $collection_id,
			);
			if ( 'relation' === $field_type ) {
				$prepared = Relations::prepare_relation_update( $post_id, $field_id, $values );
				if ( $prepared instanceof WP_Error ) {
					return $prepared;
				}
				$field['relation'] = $prepared;
			}
			$plan['fields'][ $field_id ] = $field;
		}

		return $plan;
	}

	/**
	 * Applies a prevalidated restore plan and keeps relation/index side effects in sync.
	 *
	 * @param int   $post_id Document being restored.
	 * @param array $plan    Output from prepare_restore_plan().
	 * @return array{fields:int,relations:int,schema:int,identity:int,formulas:int}
	 */
	private function apply_restore_plan( int $post_id, array $plan ): array {
		$restored = array(
			'fields'    => 0,
			'relations' => 0,
			'schema'    => 0,
			'identity'  => 0,
			'formulas'  => 0,
		);

		foreach ( $plan['schema'] as $key => $values ) {
			$this->replace_meta_values( $post_id, $key, $values );
			++$restored['schema'];
		}

		foreach ( $plan['identity'] as $key => $values ) {
			$this->replace_meta_values( $post_id, $key, $values );
			++$restored['identity'];
		}

		$index = new FieldValueIndex();
		foreach ( $plan['fields'] as $field_id => $field ) {
			if ( 'relation' === $field['type'] ) {
				$prepared = $field['relation'];
				Relations::set_relation_values(
					$post_id,
					$field_id,
					$prepared['desired'],
					$prepared['multiple']
				);
				Relations::apply_relation_pointers( $post_id, $field_id, $prepared );
				++$restored['relations'];
			} else {
				$this->replace_meta_values(
					$post_id,
					Relations::meta_key( $field_id ),
					$field['values']
				);
				++$restored['fields'];
			}

			$index->index_row_field( $post_id, $field_id, $field['collection_id'] );
		}

		// Mirrors Document::apply_meta_updates(): formulas are materialised from
		// the values that just landed, then indexed from the fresh result.
		foreach ( $plan['collections'] as $collection_id ) {
			FormulaMaterializer::recompute_row( $collection_id, $post_id );
			foreach ( Document::collection_field_ids( $collection_id ) as $field_id ) {
				if ( 'formula' === (string) get_post_meta( $field_id, 'type', true ) ) {
					$index->index_row_field( $post_id, $field_id, $collection_id );
					++$restored['formulas'];
				}
			}
		}

		return $restored;
	}

	/**
	 * Drops field IDs whose field posts no longer exist from historical schema.
	 *
	 * Keys the revision does not carry are absent here; a layout restored on its
	 * own is validated against the document's live field list instead.
	 *
	 * @param int                   $post_id Document being restored.
	 * @param array<string,mixed[]> $schema  Historical schema metadata.
	 * @return array<string,mixed[]>
	 */
	private function filter_revision_schema( int $post_id, array $schema ): array {
		$field_ids = $schema['cortext_fields'] ?? Document::collection_field_ids( $post_id );
		$valid_ids = array();
		foreach ( $field_ids as $value ) {
			$field_id = (int) $value;
			$field    = get_post( $field_id );
			if ( $field_id > 0 && $field instanceof WP_Post && Field::POST_TYPE === $field->post_type ) {
				$valid_ids[] = $field_id;
			}
		}
		$valid_ids = array_values( array_unique( $valid_ids ) );
		if ( isset( $schema['cortext_fields'] ) ) {
			$schema['cortext_fields'] = array_map( 'strval', $valid_ids );
		}

		if ( ! isset( $schema['cortext_detail_layout'] ) ) {
			return $schema;
		}

		$layouts = array();
		foreach ( $schema['cortext_detail_layout'] as $value ) {
			$layout           = Document::sanitize_detail_layout( $value );
			$layout['fields'] = array_values(
				array_filter(
					$layout['fields'],
					static function ( array $entry ) use ( $valid_ids ): bool {
						if ( ! str_starts_with( $entry['field'], 'field-' ) ) {
							return true;
						}
						return in_array( (int) substr( $entry['field'], 6 ), $valid_ids, true );
					}
				)
			);
			$layouts[]        = $layout;
		}
		$schema['cortext_detail_layout'] = $layouts;

		return $schema;
	}

	/**
	 * Returns every non-deleted field from every trait applied to a row.
	 *
	 * @param int $post_id Document ID.
	 * @return array<int,int> Map of field ID to collection ID.
	 */
	private function field_contexts_for_document( int $post_id ): array {
		$terms = wp_get_object_terms(
			$post_id,
			TraitTaxonomy::TAXONOMY,
			array( 'fields' => 'all' )
		);
		if ( ! is_array( $terms ) ) {
			return array();
		}

		$contexts = array();
		foreach ( $terms as $term ) {
			$collection_id = TraitTaxonomy::trait_id_from_slug( (string) $term->slug );
			$collection    = get_post( $collection_id );
			if (
				$collection_id < 1
				|| ! $collection instanceof WP_Post
				|| Document::POST_TYPE !== $collection->post_type
				|| ! Document::is_collection( $collection_id )
			) {
				continue;
			}

			foreach ( Document::collection_field_ids( $collection_id ) as $field_id ) {
				$field = get_post( $field_id );
				if ( $field instanceof WP_Post && Field::POST_TYPE === $field->post_type ) {
					$contexts[ $field_id ] ??= $collection_id;
				}
			}
		}

		return $contexts;
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
