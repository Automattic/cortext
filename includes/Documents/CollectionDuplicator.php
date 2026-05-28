<?php
/**
 * Duplicates a full-page collection's schema into a new collection. Rows are
 * not copied. Fields with local metadata are copied; relation fields are
 * reported in `skipped_fields` until tech-debt.md#td-collection-duplication-relations handles reverse-field
 * copies.
 *
 * Internal to the Documents layer. `Documents::duplicate()` is the public
 * entry point; external code should call that instead.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Documents;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use WP_Error;
use WP_Post;

final class CollectionDuplicator {

	/**
	 * Duplicates `$source`. Returns the new collection plus any fields skipped
	 * along the way: relation fields for now, and individual insert failures.
	 *
	 * @param WP_Post $source Source collection post.
	 *
	 * @return array{collection: WP_Post, slug: string, skipped_fields: array<int, array{id: int, title: string, reason: string}>}|WP_Error
	 */
	public function duplicate( WP_Post $source ) {
		if ( Collection::is_inline( (int) $source->ID ) ) {
			return new WP_Error(
				'cortext_collection_duplicate_inline_unsupported',
				__( "Inline collections can't be duplicated from the workspace.", 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$source_title = trim( (string) $source->post_title );
		if ( '' === $source_title ) {
			$copy_title = __( 'Copy of Untitled', 'cortext' );
		} else {
			$copy_title = sprintf(
				/* translators: %s: source collection title */
				__( 'Copy of %s', 'cortext' ),
				$source_title
			);
		}

		$new_slug = Collection::unique_slug( $copy_title );

		$new_collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $copy_title,
				'post_parent' => (int) $source->post_parent,
				'meta_input'  => array(
					'slug'                    => $new_slug,
					Collection::MODE_META_KEY => Collection::MODE_FULL_PAGE,
				),
			),
			true
		);

		if ( is_wp_error( $new_collection_id ) ) {
			return $new_collection_id;
		}

		$new_collection = get_post( (int) $new_collection_id );
		if ( ! $new_collection instanceof WP_Post ) {
			wp_delete_post( (int) $new_collection_id, true );
			return new WP_Error(
				'cortext_collection_create_failed',
				__( 'Could not create the collection.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		( new CollectionEntries() )->register_for_collection( $new_collection );

		$rest_base = CollectionEntries::CPT_PREFIX . $new_slug;
		if ( ! post_type_exists( $rest_base ) ) {
			wp_delete_post( (int) $new_collection_id, true );
			return new WP_Error(
				'cortext_collection_cpt_failed',
				__( 'Could not register rows for the collection.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		[ $field_id_map, $skipped_fields ] = $this->clone_fields( (int) $source->ID, (int) $new_collection_id );
		$this->remap_rollup_references( $field_id_map );

		return array(
			'collection'     => $new_collection,
			'slug'           => $new_slug,
			'skipped_fields' => $skipped_fields,
		);
	}

	/**
	 * Copies non-relation fields into the new collection and appends each new
	 * field id to `fields` in the original order. Relation fields are skipped
	 * so the caller can warn the user.
	 *
	 * @param int $source_collection_id Source collection post id.
	 * @param int $target_collection_id Target (newly created) collection post id.
	 *
	 * @return array{0: array<string, int>, 1: array<int, array{id: int, title: string, reason: string}>}
	 *               Field id map (source id string => new id) and skipped fields.
	 */
	private function clone_fields( int $source_collection_id, int $target_collection_id ): array {
		$source_field_ids = get_post_meta( $source_collection_id, 'fields', false );
		if ( ! is_array( $source_field_ids ) ) {
			return array( array(), array() );
		}

		$meta_whitelist = array(
			'type',
			'description',
			'default_value',
			'options',
			'number_format',
			'date_format',
			'expression',
			'related_collection_id',
			'relation_multiple',
			'rollup_relation_field_id',
			'rollup_target_field_id',
			'rollup_aggregator',
			'rollup_target_type',
			'rollup_target_options',
			'rollup_target_number_format',
			'rollup_target_date_format',
			'rollup_target_related_collection_id',
			'rollup_target_relation_multiple',
		);

		$field_id_map   = array();
		$skipped_fields = array();

		foreach ( $source_field_ids as $source_field_id ) {
			$source_field_id = (int) $source_field_id;
			$source_field    = get_post( $source_field_id );

			if ( ! $source_field instanceof WP_Post || Field::POST_TYPE !== $source_field->post_type ) {
				continue;
			}

			$source_type = (string) get_post_meta( $source_field_id, 'type', true );
			// tech-debt.md#td-collection-duplication-relations: skip relations until duplication can copy and
			// remap the forward and reverse fields together.
			if ( 'relation' === $source_type ) {
				$skipped_fields[] = array(
					'id'     => $source_field_id,
					'title'  => $source_field->post_title,
					'reason' => 'relation_unsupported',
				);
				continue;
			}

			$meta = array();
			foreach ( $meta_whitelist as $key ) {
				$value = get_post_meta( $source_field_id, $key, true );
				if ( '' !== $value && null !== $value ) {
					$meta[ $key ] = (string) $value;
				}
			}

			/* translators: %s: source field title */
			$clone_title = trim( sprintf( __( 'Copy of %s', 'cortext' ), $source_field->post_title ) );

			$new_field_id = wp_insert_post(
				array(
					'post_type'   => Field::POST_TYPE,
					'post_status' => 'private',
					'post_title'  => $clone_title,
					'meta_input'  => $meta,
				),
				true
			);

			if ( is_wp_error( $new_field_id ) ) {
				$skipped_fields[] = array(
					'id'     => $source_field_id,
					'title'  => $source_field->post_title,
					'reason' => 'insert_failed',
				);
				continue;
			}

			add_post_meta( $target_collection_id, 'fields', (string) $new_field_id );
			$field_id_map[ (string) $source_field_id ] = (int) $new_field_id;
		}

		return array( $field_id_map, $skipped_fields );
	}

	/**
	 * Rewrites rollup meta when the referenced field was copied too. If a
	 * rollup points to a skipped relation, the old reference stays for now;
	 * tech-debt.md#td-collection-duplication-relations tracks the remaining skip/remap work.
	 *
	 * @param array<string, int> $field_id_map Source field id (string) => new field id.
	 */
	private function remap_rollup_references( array $field_id_map ): void {
		foreach ( $field_id_map as $new_field_id ) {
			foreach ( array( 'rollup_relation_field_id', 'rollup_target_field_id' ) as $meta_key ) {
				$existing = (string) get_post_meta( $new_field_id, $meta_key, true );
				if ( '' === $existing ) {
					continue;
				}
				if ( isset( $field_id_map[ $existing ] ) ) {
					update_post_meta( $new_field_id, $meta_key, (string) $field_id_map[ $existing ] );
				}
			}
		}
	}
}
