<?php
/**
 * Shared helpers for Cortext relation fields.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\FieldValues\FieldValueIndex;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;

final class Relations {

	public static function meta_key( int $field_id ): string {
		return "field-{$field_id}";
	}

	public static function is_truthy( mixed $value ): bool {
		if ( is_bool( $value ) ) {
			return $value;
		}
		if ( is_int( $value ) ) {
			return 1 === $value;
		}
		$text = strtolower( trim( (string) $value ) );
		return in_array( $text, array( '1', 'true', 'yes', 'on' ), true );
	}

	public static function relation_is_multiple( int $field_id ): bool {
		$value = get_post_meta( $field_id, 'relation_multiple', true );
		if ( '' === $value || null === $value ) {
			return true;
		}
		return self::is_truthy( $value );
	}

	/**
	 * Normalizes a relation value payload into unique row IDs.
	 *
	 * @param mixed $value    Incoming relation value.
	 * @param bool  $multiple Whether more than one row ID is allowed.
	 * @return int[]
	 */
	public static function normalize_row_ids( mixed $value, bool $multiple = true ): array {
		$raw = is_array( $value ) ? $value : array( $value );
		$ids = array();
		foreach ( $raw as $entry ) {
			if ( is_array( $entry ) && isset( $entry['id'] ) ) {
				$entry = $entry['id'];
			}
			if ( is_object( $entry ) && isset( $entry->id ) ) {
				$entry = $entry->id;
			}
			$id = (int) $entry;
			if ( $id > 0 && ! in_array( $id, $ids, true ) ) {
				$ids[] = $id;
			}
		}
		if ( ! $multiple && count( $ids ) > 1 ) {
			return array_slice( $ids, 0, 1 );
		}
		return $ids;
	}

	/**
	 * Returns the stored row IDs for a relation field on a row.
	 *
	 * @param int $row_id   Row post ID.
	 * @param int $field_id Relation field post ID.
	 * @return int[]
	 */
	public static function relation_values( int $row_id, int $field_id ): array {
		return self::normalize_row_ids(
			get_post_meta( $row_id, self::meta_key( $field_id ), false )
		);
	}

	/**
	 * Replaces the stored row IDs for a relation field on a row.
	 *
	 * @param int   $row_id   Row post ID.
	 * @param int   $field_id Relation field post ID.
	 * @param int[] $values   Row post IDs.
	 * @param bool  $multiple Whether more than one row ID is allowed.
	 */
	public static function set_relation_values(
		int $row_id,
		int $field_id,
		array $values,
		bool $multiple
	): void {
		$key = self::meta_key( $field_id );
		$ids = self::normalize_row_ids( $values, $multiple );
		delete_post_meta( $row_id, $key );
		foreach ( $ids as $id ) {
			add_post_meta( $row_id, $key, (string) $id );
		}
	}

	/**
	 * Returns the mirror term id for a collection document, or 0 when the
	 * document does not define a schema or has no mirror term yet.
	 *
	 * @param int $collection_id Collection document id.
	 */
	public static function trait_term_id_for_collection( int $collection_id ): int {
		$collection = get_post( $collection_id );
		if (
			! $collection instanceof WP_Post
			|| Document::POST_TYPE !== $collection->post_type
			|| ! Document::is_collection( $collection_id )
		) {
			return 0;
		}
		return TraitTaxonomy::term_id_for_trait( $collection_id );
	}

	/**
	 * Whether a document is a row of the given collection (trait).
	 *
	 * @param int $document_id Document post id.
	 * @param int $collection_id Trait post id.
	 */
	public static function document_belongs_to_collection( int $document_id, int $collection_id ): bool {
		$term_id = self::trait_term_id_for_collection( $collection_id );
		if ( $term_id < 1 ) {
			return false;
		}
		return has_term( $term_id, TraitTaxonomy::TAXONOMY, $document_id );
	}

	/**
	 * Validates a relation update without writing anything. Returns the
	 * resolved configuration (reverse field, multiplicity, normalized desired
	 * ids, and the current stored value) so callers can perform the meta
	 * write first and then apply reverse pointer changes in a separate pass.
	 *
	 * @param int   $row_id   Row post ID being edited.
	 * @param int   $field_id Relation field post ID.
	 * @param mixed $value    Incoming relation value.
	 *
	 * @return array{reverse_id:int,multiple:bool,reverse_multiple:bool,desired:int[],current:int[],target_collection_id:int}|WP_Error
	 */
	public static function prepare_relation_update( int $row_id, int $field_id, mixed $value ): array|WP_Error {
		$field = get_post( $field_id );
		if ( ! $field instanceof WP_Post || Field::POST_TYPE !== $field->post_type ) {
			return new WP_Error(
				'cortext_relation_field_not_found',
				__( 'Relation field not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}
		if ( 'relation' !== (string) get_post_meta( $field_id, 'type', true ) ) {
			return new WP_Error(
				'cortext_field_not_relation',
				__( 'Field is not a relation.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$reverse_id = (int) get_post_meta( $field_id, 'relation_reverse_field_id', true );
		$reverse    = get_post( $reverse_id );
		if ( ! $reverse_id || ! $reverse instanceof WP_Post || Field::POST_TYPE !== $reverse->post_type ) {
			return new WP_Error(
				'cortext_relation_reverse_missing',
				__( 'Relation reverse field is missing.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$target_collection_id = (int) get_post_meta( $field_id, 'related_collection_id', true );
		$target_term_id       = self::trait_term_id_for_collection( $target_collection_id );
		if ( $target_term_id < 1 ) {
			return new WP_Error(
				'cortext_relation_target_missing',
				__( 'Relation target collection is missing.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$multiple         = self::relation_is_multiple( $field_id );
		$reverse_multiple = self::relation_is_multiple( $reverse_id );
		$desired          = self::normalize_row_ids( $value, $multiple );

		// Validate all desired targets in a single query: every target must be
		// a `crtxt_document` with the target trait's mirror term. Doing this
		// per-target with `has_term()` makes large relation updates pay N
		// extra queries; the batch query is one tax_query with `post__in`.
		if ( count( $desired ) > 0 ) {
			$valid_ids = get_posts(
				array(
					'post_type'      => Document::POST_TYPE,
					'post_status'    => 'any',
					'post__in'       => $desired,
					'fields'         => 'ids',
					'posts_per_page' => -1,
					'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
						array(
							'taxonomy' => TraitTaxonomy::TAXONOMY,
							'field'    => 'term_id',
							'terms'    => array( $target_term_id ),
						),
					),
				)
			);
			if ( count( $valid_ids ) !== count( $desired ) ) {
				return new WP_Error(
					'cortext_relation_target_row_invalid',
					__( 'Relation target row is invalid.', 'cortext' ),
					array( 'status' => 400 )
				);
			}
		}

		return array(
			'reverse_id'           => $reverse_id,
			'multiple'             => $multiple,
			'reverse_multiple'     => $reverse_multiple,
			'desired'              => $desired,
			'current'              => self::relation_values( $row_id, $field_id ),
			'target_collection_id' => $target_collection_id,
		);
	}

	/**
	 * Writes the forward relation meta in two batched statements, skipping
	 * WP REST's per-value diff loop in `update_multi_meta_value`. That loop
	 * fires `sanitize_meta` for every (current, desired) pair, which on a
	 * 250-target update is 62k+ filter invocations and dominates the request
	 * (~18s on the perf-bench dataset). Caller is responsible for clearing
	 * the same field from `$request->meta` afterwards so WP REST does not
	 * try to redo the write.
	 *
	 * @param int   $row_id   Row being edited.
	 * @param int   $field_id Forward relation field id.
	 * @param int[] $current  Current stored row IDs (from `prepare_relation_update`).
	 * @param int[] $desired  Desired row IDs (from `prepare_relation_update`).
	 */
	public static function fast_write_forward_meta( int $row_id, int $field_id, array $current, array $desired ): void {
		global $wpdb;

		$current = array_map( 'intval', $current );
		$desired = array_map( 'intval', $desired );
		$added   = array_values( array_diff( $desired, $current ) );
		$removed = array_values( array_diff( $current, $desired ) );

		if ( count( $added ) === 0 && count( $removed ) === 0 ) {
			return;
		}

		$key = self::meta_key( $field_id );

		FieldValueIndex::suspend_sync();

		try {
			if ( count( $removed ) > 0 ) {
				$placeholders = implode( ',', array_fill( 0, count( $removed ), '%d' ) );
				$args         = array_merge( array( $row_id, $key ), array_map( 'strval', $removed ) );
				// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQLPlaceholders
				$wpdb->query(
					$wpdb->prepare(
						"DELETE FROM {$wpdb->postmeta}
						 WHERE post_id = %d
						   AND meta_key = %s
						   AND meta_value IN ({$placeholders})",
						$args
					)
				);
				// phpcs:enable
			}

			if ( count( $added ) > 0 ) {
				$row_placeholder = '(%d, %s, %s)';
				$placeholders    = implode( ',', array_fill( 0, count( $added ), $row_placeholder ) );
				$args            = array();
				foreach ( $added as $value ) {
					$args[] = $row_id;
					$args[] = $key;
					$args[] = (string) $value;
				}
				// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQLPlaceholders
				$wpdb->query(
					$wpdb->prepare(
						"INSERT INTO {$wpdb->postmeta} (post_id, meta_key, meta_value) VALUES {$placeholders}",
						$args
					)
				);
				// phpcs:enable
			}

			wp_cache_delete( $row_id, 'post_meta' );
		} finally {
			FieldValueIndex::resume_sync();
		}
	}

	/**
	 * Applies the reverse pointer changes implied by `$prepared`. Callers
	 * either let `sync_relation_value` do the meta write before this runs, or
	 * (from a REST after-insert hook) rely on WP REST having written the meta
	 * already.
	 *
	 * Performance contract: a 250-target update with reverse_multiple=true is
	 * 4 SQL statements (one batched SELECT, one DELETE, one INSERT, one
	 * sidecar reindex pass), not 4N. (A) deltas, (B) cached reverse meta,
	 * (C) batched writes, and (D) suspended index sync make the cost
	 * proportional to what changed, not to the desired set's size.
	 *
	 * @param int   $row_id   Row whose forward field changed.
	 * @param int   $field_id Forward field id.
	 * @param array $prepared Output of `prepare_relation_update`.
	 */
	public static function apply_relation_pointers( int $row_id, int $field_id, array $prepared ): void {
		$reverse_id           = (int) $prepared['reverse_id'];
		$multiple             = (bool) $prepared['multiple'];
		$reverse_multiple     = (bool) $prepared['reverse_multiple'];
		$desired              = array_map( 'intval', $prepared['desired'] );
		$current              = array_map( 'intval', $prepared['current'] );
		$target_collection_id = (int) ( $prepared['target_collection_id'] ?? 0 );

		// (A) Only the deltas reach the wire.
		$added   = array_values( array_diff( $desired, $current ) );
		$removed = array_values( array_diff( $current, $desired ) );

		if ( count( $added ) === 0 && count( $removed ) === 0 ) {
			return;
		}

		// (D) Skip per-meta sidecar queueing during the batch; the explicit
		// re-index below covers the same rows in one pass.
		FieldValueIndex::suspend_sync();

		try {
			if ( ! $reverse_multiple && count( $added ) > 0 ) {
				// Conflict resolution can't be batched cleanly: each target may
				// already point at a different row, which must drop the target
				// from its forward field. Keep the slow path but limit it to
				// added (a no-op on unchanged targets) and let (D) keep the
				// sidecar quiet.
				self::resolve_reverse_conflicts( $row_id, $field_id, $reverse_id, $added, $multiple );
			}

			if ( count( $removed ) > 0 ) {
				self::detach_reverse_pointers( $reverse_id, $row_id, $removed );
			}

			if ( count( $added ) > 0 ) {
				self::attach_reverse_pointers( $reverse_id, $row_id, $added, $reverse_multiple );
			}
		} finally {
			FieldValueIndex::resume_sync();
		}

		// Bypassing the meta hooks above means the sidecar is unaware of the
		// reverse-pointer changes. Re-index the touched targets explicitly so
		// the field-value index stays in sync.
		self::reindex_targets( array_merge( $added, $removed ), $reverse_id, $target_collection_id );
	}

	/**
	 * For a single-valued reverse field, drops `$target_id` from any other row
	 * that previously pointed at it on the forward side. Mirrors the original
	 * loop in `apply_relation_pointers` but limited to newly added targets.
	 *
	 * @param int   $row_id       Row gaining the forward pointers.
	 * @param int   $field_id     Forward field id.
	 * @param int   $reverse_id   Reverse field id.
	 * @param int[] $added        Targets newly gaining `$row_id` on the reverse side.
	 * @param bool  $multiple     Whether the forward field accepts multiple values.
	 */
	private static function resolve_reverse_conflicts( int $row_id, int $field_id, int $reverse_id, array $added, bool $multiple ): void {
		// (B) Warm the meta cache for every target at once; subsequent reads
		// are cache hits instead of one SELECT per target.
		update_meta_cache( 'post', $added );

		foreach ( $added as $target_id ) {
			$existing  = self::relation_values( $target_id, $reverse_id );
			$conflicts = array_values( array_diff( $existing, array( $row_id ) ) );
			foreach ( $conflicts as $conflict_row_id ) {
				$conflict_values = self::relation_values( $conflict_row_id, $field_id );
				self::set_relation_values(
					$conflict_row_id,
					$field_id,
					array_values( array_diff( $conflict_values, array( $target_id ) ) ),
					$multiple
				);
			}
		}
	}

	/**
	 * Bulk-removes the `(target, reverse_key, row_id)` postmeta tuples that
	 * carry the reverse pointer when the row no longer references the target.
	 * One DELETE replaces N `delete_post_meta` calls.
	 *
	 * @param int   $reverse_id Reverse field id.
	 * @param int   $row_id     Row whose pointer is being dropped.
	 * @param int[] $targets    Targets losing the pointer.
	 */
	private static function detach_reverse_pointers( int $reverse_id, int $row_id, array $targets ): void {
		global $wpdb;

		$key          = self::meta_key( $reverse_id );
		$placeholders = implode( ',', array_fill( 0, count( $targets ), '%d' ) );
		$args         = array_merge( array( $key, (string) $row_id ), $targets );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQLPlaceholders
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->postmeta}
				 WHERE meta_key = %s
				   AND meta_value = %s
				   AND post_id IN ({$placeholders})",
				$args
			)
		);
		// phpcs:enable

		foreach ( $targets as $target_id ) {
			wp_cache_delete( $target_id, 'post_meta' );
		}
	}

	/**
	 * Bulk-inserts reverse pointer tuples. For single-valued reverse fields the
	 * caller has already cleared conflicting entries via
	 * `resolve_reverse_conflicts`, so the only postmeta rows that need to land
	 * are `(target, reverse_key, row_id)`. One multi-row INSERT replaces 2N
	 * statements.
	 *
	 * @param int   $reverse_id       Reverse field id.
	 * @param int   $row_id           Row gaining the pointer.
	 * @param int[] $targets          Targets to attach.
	 * @param bool  $reverse_multiple Whether the reverse field accepts multi values.
	 */
	private static function attach_reverse_pointers( int $reverse_id, int $row_id, array $targets, bool $reverse_multiple ): void {
		global $wpdb;

		$key   = self::meta_key( $reverse_id );
		$value = (string) $row_id;

		if ( ! $reverse_multiple ) {
			// Conflicts already resolved; clear any stale entry on the target
			// so the (target, reverse_key, row_id) row is the only one left.
			$placeholders = implode( ',', array_fill( 0, count( $targets ), '%d' ) );
			$args         = array_merge( array( $key ), $targets );
			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQLPlaceholders
			$wpdb->query(
				$wpdb->prepare(
					"DELETE FROM {$wpdb->postmeta}
					 WHERE meta_key = %s
					   AND post_id IN ({$placeholders})",
					$args
				)
			);
			// phpcs:enable
		} else {
			// (B) Pull every target's existing reverse values in one cached
			// pass; skip those already carrying $row_id.
			update_meta_cache( 'post', $targets );
			$targets = array_values(
				array_filter(
					$targets,
					static function ( int $target_id ) use ( $reverse_id, $row_id ): bool {
						return ! in_array( $row_id, self::relation_values( $target_id, $reverse_id ), true );
					}
				)
			);
			if ( count( $targets ) === 0 ) {
				return;
			}
		}

		// (C) One INSERT for the lot. `wpdb->prepare()` handles escaping.
		$row_placeholder = '(%d, %s, %s)';
		$placeholders    = implode( ',', array_fill( 0, count( $targets ), $row_placeholder ) );
		$args            = array();
		foreach ( $targets as $target_id ) {
			$args[] = $target_id;
			$args[] = $key;
			$args[] = $value;
		}

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQLPlaceholders
		$wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$wpdb->postmeta} (post_id, meta_key, meta_value) VALUES {$placeholders}",
				$args
			)
		);
		// phpcs:enable

		foreach ( $targets as $target_id ) {
			wp_cache_delete( $target_id, 'post_meta' );
		}
	}

	/**
	 * Pushes the new reverse-pointer state into the field-value index for
	 * every target we touched. Replaces the per-row queue the meta hooks would
	 * have populated; without it the sidecar would silently drift.
	 *
	 * @param int[] $targets              Touched target row ids.
	 * @param int   $reverse_id           Reverse field id.
	 * @param int   $target_collection_id Target rows' collection id.
	 */
	private static function reindex_targets( array $targets, int $reverse_id, int $target_collection_id ): void {
		if ( count( $targets ) === 0 ) {
			return;
		}
		$index = new FieldValueIndex();
		if ( ! $index->can_write() ) {
			return;
		}
		foreach ( array_unique( $targets ) as $target_id ) {
			$index->index_row_field( $target_id, $reverse_id, $target_collection_id );
		}
	}

	/**
	 * Synchronizes a relation field update end-to-end: validates the value,
	 * writes the forward meta, and updates reverse pointers. Direct PHP
	 * callers (CLI seeds, DocumentDuplicator) use this. The REST autosave path
	 * splits the two halves around WP's own meta write.
	 *
	 * @param int   $row_id   Row post ID being edited.
	 * @param int   $field_id Relation field post ID.
	 * @param mixed $value    Incoming relation value.
	 * @return true|WP_Error
	 */
	public static function sync_relation_value( int $row_id, int $field_id, mixed $value ): bool|WP_Error {
		$prepared = self::prepare_relation_update( $row_id, $field_id, $value );
		if ( $prepared instanceof WP_Error ) {
			return $prepared;
		}
		self::set_relation_values( $row_id, $field_id, $prepared['desired'], $prepared['multiple'] );
		self::apply_relation_pointers( $row_id, $field_id, $prepared );
		return true;
	}

	/**
	 * Removes reverse pointers for every relation field on a deleted row.
	 *
	 * @param int   $row_id    Deleted row post ID.
	 * @param int[] $field_ids Relation candidate fields on the row's collection.
	 */
	public static function remove_deleted_row_references( int $row_id, array $field_ids = array() ): void {
		if ( count( $field_ids ) === 0 ) {
			$all_meta = get_post_meta( $row_id );
			foreach ( array_keys( $all_meta ) as $meta_key ) {
				if ( str_starts_with( (string) $meta_key, 'field-' ) ) {
					$field_ids[] = (int) substr( (string) $meta_key, 6 );
				}
			}
		}

		foreach ( array_unique( array_map( 'intval', $field_ids ) ) as $field_id ) {
			if ( $field_id < 1 || 'relation' !== (string) get_post_meta( $field_id, 'type', true ) ) {
				continue;
			}

			$reverse_id = (int) get_post_meta( $field_id, 'relation_reverse_field_id', true );
			if ( $reverse_id < 1 || 'relation' !== (string) get_post_meta( $reverse_id, 'type', true ) ) {
				continue;
			}

			foreach ( self::relation_values( $row_id, $field_id ) as $related_id ) {
				$reverse_values = self::relation_values( $related_id, $reverse_id );
				self::set_relation_values(
					$related_id,
					$reverse_id,
					array_values( array_diff( $reverse_values, array( $row_id ) ) ),
					self::relation_is_multiple( $reverse_id )
				);
			}
		}
	}
}
