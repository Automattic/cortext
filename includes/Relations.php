<?php
/**
 * Shared helpers for Cortext relation fields.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
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

	public static function entry_post_type_for_collection( int $collection_id ): ?string {
		$collection = get_post( $collection_id );
		if ( ! $collection instanceof WP_Post || Collection::POST_TYPE !== $collection->post_type ) {
			return null;
		}
		$slug = (string) get_post_meta( $collection_id, 'slug', true );
		if ( '' === $slug ) {
			return null;
		}
		$post_type = CollectionEntries::CPT_PREFIX . $slug;
		return post_type_exists( $post_type ) ? $post_type : null;
	}

	/**
	 * Synchronizes a relation field update to its reverse field.
	 *
	 * @param int   $row_id   Row post ID being edited.
	 * @param int   $field_id Relation field post ID.
	 * @param mixed $value    Incoming relation value.
	 * @return true|WP_Error
	 */
	public static function sync_relation_value( int $row_id, int $field_id, mixed $value ): bool|WP_Error {
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
		$target_post_type     = self::entry_post_type_for_collection( $target_collection_id );
		if ( null === $target_post_type ) {
			return new WP_Error(
				'cortext_relation_target_missing',
				__( 'Relation target collection is missing.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$multiple         = self::relation_is_multiple( $field_id );
		$reverse_multiple = self::relation_is_multiple( $reverse_id );
		$desired          = self::normalize_row_ids( $value, $multiple );

		foreach ( $desired as $target_id ) {
			$target = get_post( $target_id );
			if ( ! $target instanceof WP_Post || $target_post_type !== $target->post_type ) {
				return new WP_Error(
					'cortext_relation_target_row_invalid',
					__( 'Relation target row is invalid.', 'cortext' ),
					array( 'status' => 400 )
				);
			}
		}

		$current = self::relation_values( $row_id, $field_id );
		$removed = array_values( array_diff( $current, $desired ) );

		foreach ( $removed as $target_id ) {
			$reverse_values = self::relation_values( $target_id, $reverse_id );
			self::set_relation_values(
				$target_id,
				$reverse_id,
				array_values( array_diff( $reverse_values, array( $row_id ) ) ),
				$reverse_multiple
			);
		}

		self::set_relation_values( $row_id, $field_id, $desired, $multiple );

		foreach ( $desired as $target_id ) {
			$reverse_values = self::relation_values( $target_id, $reverse_id );
			if ( ! $reverse_multiple ) {
				$conflicts = array_values( array_diff( $reverse_values, array( $row_id ) ) );
				foreach ( $conflicts as $conflict_row_id ) {
					$conflict_values = self::relation_values( $conflict_row_id, $field_id );
					self::set_relation_values(
						$conflict_row_id,
						$field_id,
						array_values( array_diff( $conflict_values, array( $target_id ) ) ),
						$multiple
					);
				}
				$reverse_values = array();
			}
			if ( ! in_array( $row_id, $reverse_values, true ) ) {
				$reverse_values[] = $row_id;
			}
			self::set_relation_values( $target_id, $reverse_id, $reverse_values, $reverse_multiple );
		}

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
