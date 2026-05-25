<?php
/**
 * Postmeta-backed field-value store with optional index maintenance.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\FieldValues;

use Cortext\Relations;

final class FieldValueStore {

	private FieldValueIndex $index;

	public function __construct( ?FieldValueIndex $index = null ) {
		$this->index = $index ?? new FieldValueIndex();
	}

	public function write_value( int $row_id, int $field_id, string $field_type, mixed $value, ?int $collection_id = null, ?string $post_status = null ): void {
		FieldValueIndex::suspend_sync();
		try {
			$stored_value = $this->write_postmeta_value( $row_id, $field_id, $field_type, $value );
		} finally {
			FieldValueIndex::resume_sync();
		}

		$this->index->index_known_value( $row_id, $field_id, $field_type, $stored_value, $collection_id, $post_status );
	}

	private function write_postmeta_value( int $row_id, int $field_id, string $field_type, mixed $value ): mixed {
		$key = Relations::meta_key( $field_id );

		if ( 'multiselect' === $field_type ) {
			$this->delete_row_meta( $row_id, $key );
			$entries = is_array( $value ) ? $value : array( $value );
			$stored  = array();
			foreach ( $entries as $entry ) {
				$text = sanitize_text_field( (string) $entry );
				if ( '' !== $text ) {
					$this->add_row_meta( $row_id, $key, $text );
					$stored[] = $text;
				}
			}
			return $stored;
		}

		if ( null === $value || '' === $value ) {
			$this->delete_row_meta( $row_id, $key );
			return null;
		}

		$existing = get_post_meta( $row_id, $key, false );
		if ( is_array( $existing ) && count( $existing ) > 1 ) {
			$this->delete_row_meta( $row_id, $key );
		}

		if ( 'number' === $field_type ) {
			$stored = is_numeric( $value ) ? (float) $value : $value;
			$this->update_row_meta( $row_id, $key, $stored );
			return $stored;
		}

		if ( 'checkbox' === $field_type ) {
			$stored = (bool) $value;
			$this->update_row_meta( $row_id, $key, $stored );
			return $stored;
		}

		if ( 'date' === $field_type || 'datetime' === $field_type ) {
			$stored = $this->normalize_date_field_value( $value, $field_type );
			$this->update_row_meta( $row_id, $key, $stored );
			return $stored;
		}

		$stored = sanitize_text_field( (string) $value );
		$this->update_row_meta( $row_id, $key, $stored );
		return $stored;
	}

	private function update_row_meta( int $row_id, string $key, mixed $value ): void {
		update_metadata( 'post', $row_id, $key, $value );
	}

	private function add_row_meta( int $row_id, string $key, mixed $value ): void {
		add_metadata( 'post', $row_id, $key, $value );
	}

	private function delete_row_meta( int $row_id, string $key ): void {
		delete_metadata( 'post', $row_id, $key );
	}

	private function normalize_date_field_value( mixed $value, string $field_type ): string {
		$text = trim( (string) $value );
		if ( '' === $text ) {
			return '';
		}

		if ( preg_match( '/^(\d{4}-\d{2}-\d{2})/', $text, $matches ) ) {
			if ( 'date' === $field_type ) {
				return $matches[1];
			}
			$timestamp = strtotime( $text );
			return false === $timestamp ? sanitize_text_field( $text ) : gmdate( DATE_RFC3339, $timestamp );
		}

		$timestamp = strtotime( $text );
		if ( false === $timestamp ) {
			return sanitize_text_field( $text );
		}

		return 'date' === $field_type ? gmdate( 'Y-m-d', $timestamp ) : gmdate( DATE_RFC3339, $timestamp );
	}
}
