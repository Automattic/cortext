<?php
/**
 * Duplicates a document. The duplicate always inherits title, content,
 * excerpt, status, parent, icon, and thumbnail. If the source has
 * `cortext_fields` meta, its field posts are cloned and rollup references
 * remapped. If the source belongs to a collection (carries a trait term),
 * the term and field values are copied so the duplicate lands in the same
 * collection.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Documents;

use Cortext\Documents;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;

final class DocumentDuplicator {

	/**
	 * Field meta keys carried over when cloning a schema. Relation-specific
	 * keys travel only for rollups that point at copied fields, since the
	 * relation field itself is skipped (see `clone_schema`).
	 */
	private const FIELD_META_WHITELIST = array(
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

	public function __construct( private Documents $documents ) {}

	/**
	 * Duplicates `$source` and returns the new document.
	 *
	 * @param WP_Post $source Source document post.
	 *
	 * @return array{document: WP_Post, collection_id: int, skipped_fields: array<int, array{id: int, title: string, reason: string}>}|WP_Error
	 */
	public function duplicate( WP_Post $source ): array|WP_Error {
		if ( Document::POST_TYPE !== $source->post_type ) {
			return new WP_Error(
				'cortext_duplicate_invalid_post_type',
				__( 'Only documents can be duplicated through this path.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$new_id = wp_insert_post(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_status'  => 'auto-draft' === $source->post_status ? 'private' : $source->post_status,
				'post_title'   => $this->copy_title( $source ),
				'post_content' => $source->post_content,
				'post_excerpt' => $source->post_excerpt,
				'post_parent'  => (int) $source->post_parent,
			),
			true
		);
		if ( $new_id instanceof WP_Error ) {
			return $new_id;
		}
		$new_id = (int) $new_id;

		$skipped_fields = array();
		if ( Document::is_collection_post( $source ) ) {
			$skipped_fields = $this->clone_schema( (int) $source->ID, $new_id );
			// Designate the duplicate a collection through its own mirror term.
			// Cloning fields creates the term as a side effect of the
			// `cortext_fields` write, but an empty source (or one whose only
			// fields are skipped relations) clones no field meta, so create it
			// explicitly. This also seeds the self-referencing data-view body
			// and drops the copied source one.
			( new TraitTaxonomy() )->ensure_mirror_term( $new_id );
		}

		$collection_id   = 0;
		$collection_post = $this->documents->find_trait_for_document( $source );
		if ( $collection_post instanceof WP_Post ) {
			$collection_id = (int) $collection_post->ID;
			$result        = $this->copy_membership_and_values( $source, $new_id, $collection_id );
			if ( $result instanceof WP_Error ) {
				$this->delete_partial_duplicate( $new_id );
				return $result;
			}
		}

		$this->copy_icon( $source, $new_id );
		$this->copy_thumbnail( $source, $new_id );

		$document = get_post( $new_id );
		if ( ! $document instanceof WP_Post ) {
			return new WP_Error(
				'cortext_duplicate_failed',
				__( 'Document could not be created.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		return array(
			'document'       => $document,
			'collection_id'  => $collection_id,
			'skipped_fields' => $skipped_fields,
		);
	}

	private function copy_title( WP_Post $source ): string {
		$source_title = trim( (string) $source->post_title );
		if ( '' === $source_title ) {
			return __( 'Copy of Untitled', 'cortext' );
		}
		return sprintf(
			/* translators: %s: source document title */
			__( 'Copy of %s', 'cortext' ),
			$source_title
		);
	}

	/**
	 * Clones the source's `cortext_fields` schema onto the target. Relations
	 * are reported in `skipped_fields`; see tech-debt.md#54.
	 *
	 * @param int $source_id Source document id.
	 * @param int $target_id Newly created document id.
	 *
	 * @return array<int, array{id: int, title: string, reason: string}>
	 */
	private function clone_schema( int $source_id, int $target_id ): array {
		$source_field_ids = Document::collection_field_ids( $source_id );
		$field_id_map     = array();
		$skipped          = array();

		foreach ( $source_field_ids as $source_field_id ) {
			$source_field = get_post( $source_field_id );
			if ( ! $source_field instanceof WP_Post || Field::POST_TYPE !== $source_field->post_type ) {
				continue;
			}

			$source_type = (string) get_post_meta( $source_field_id, 'type', true );
			// Skip relations: a safe copy must clone forward + reverse fields
			// together. See tech-debt.md#54.
			if ( 'relation' === $source_type ) {
				$skipped[] = array(
					'id'     => $source_field_id,
					'title'  => $source_field->post_title,
					'reason' => 'relation_unsupported',
				);
				continue;
			}

			$meta = array();
			foreach ( self::FIELD_META_WHITELIST as $key ) {
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
				$skipped[] = array(
					'id'     => $source_field_id,
					'title'  => $source_field->post_title,
					'reason' => 'insert_failed',
				);
				continue;
			}

			add_post_meta( $target_id, 'cortext_fields', (string) $new_field_id );
			$field_id_map[ (string) $source_field_id ] = (int) $new_field_id;
		}

		$this->remap_rollup_references( $field_id_map );
		return $skipped;
	}

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

	/**
	 * Reuses the source's trait term so the duplicate joins the same
	 * collection, then copies each field value defined by that collection.
	 *
	 * @param WP_Post $source        Source document.
	 * @param int     $target_id     Newly created document id.
	 * @param int     $collection_id Collection the source belongs to.
	 */
	private function copy_membership_and_values( WP_Post $source, int $target_id, int $collection_id ): bool|WP_Error {
		$trait_term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $trait_term_id > 0 ) {
			wp_set_object_terms( $target_id, array( $trait_term_id ), TraitTaxonomy::TAXONOMY );
		}

		$field_ids = Document::collection_field_ids( $collection_id );
		foreach ( $field_ids as $field_id ) {
			$field_type = (string) get_post_meta( $field_id, 'type', true );

			if ( 'rollup' === $field_type ) {
				continue;
			}

			if ( 'relation' === $field_type ) {
				$reverse_id = (int) get_post_meta( $field_id, 'relation_reverse_field_id', true );
				if ( $reverse_id < 1 || ! Relations::relation_is_multiple( $reverse_id ) ) {
					continue;
				}
				$values = Relations::relation_values( (int) $source->ID, $field_id );
				if ( count( $values ) === 0 ) {
					continue;
				}
				$synced = Relations::sync_relation_value( $target_id, $field_id, $values );
				if ( $synced instanceof WP_Error ) {
					return $synced;
				}
				continue;
			}

			$key = Relations::meta_key( $field_id );
			if ( 'multiselect' === $field_type ) {
				foreach ( get_post_meta( (int) $source->ID, $key, false ) as $value ) {
					if ( '' !== $value && null !== $value ) {
						add_post_meta( $target_id, $key, $value );
					}
				}
				continue;
			}

			$value = get_post_meta( (int) $source->ID, $key, true );
			if ( '' !== $value && null !== $value ) {
				update_post_meta( $target_id, $key, $value );
			}
		}

		return true;
	}

	/**
	 * Removes a partially-built duplicate after a failure: the cloned field
	 * posts (if any) and the document itself, so a failed duplicate leaves
	 * nothing behind.
	 *
	 * @param int $new_id Newly created duplicate document id.
	 */
	private function delete_partial_duplicate( int $new_id ): void {
		foreach ( Document::collection_field_ids( $new_id ) as $field_id ) {
			wp_delete_post( $field_id, true );
		}
		wp_delete_post( $new_id, true );
	}

	private function copy_icon( WP_Post $source, int $target_id ): void {
		$icon = (string) get_post_meta( (int) $source->ID, 'cortext_document_icon', true );
		if ( '' !== $icon ) {
			update_post_meta( $target_id, 'cortext_document_icon', $icon );
		}
	}

	private function copy_thumbnail( WP_Post $source, int $target_id ): void {
		$thumbnail_id = (int) get_post_thumbnail_id( (int) $source->ID );
		if ( $thumbnail_id > 0 ) {
			set_post_thumbnail( $target_id, $thumbnail_id );
		}
	}
}
