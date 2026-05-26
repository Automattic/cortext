<?php
/**
 * Type-aware field default helpers.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Fields;

use Cortext\FieldValues\FieldValueStore;
use Cortext\Relations;

final class FieldDefaults {

	public const META_KEY = 'default_value';

	private const SUPPORTED_TYPES = array(
		'text',
		'url',
		'email',
		'number',
		'date',
		'datetime',
		'checkbox',
		'select',
		'multiselect',
	);

	/**
	 * Sanitizes the raw REST/meta payload into the canonical JSON envelope.
	 *
	 * Type-specific validation happens when the field id is known.
	 *
	 * @param mixed $value Incoming meta value.
	 */
	public static function sanitize_meta_value( mixed $value ): string {
		$config = self::parse_config( $value );
		return null === $config ? '' : (string) wp_json_encode( $config );
	}

	/**
	 * Returns a canonical config for a concrete field, or null when unsupported.
	 *
	 * @param int   $field_id Field post id.
	 * @param mixed $raw      Optional raw config override.
	 */
	public static function normalize_for_field( int $field_id, mixed $raw = null ): ?array {
		$type = (string) get_post_meta( $field_id, 'type', true );
		return self::normalize(
			null === $raw ? get_post_meta( $field_id, self::META_KEY, true ) : $raw,
			$type,
			self::option_values_for_field( $field_id )
		);
	}

	/**
	 * Normalizes a default config for a specific field type.
	 *
	 * @param mixed                  $raw           Raw default config.
	 * @param string                 $type          Cortext field type.
	 * @param array<int,string>|null $option_values Current option values; null skips option membership checks.
	 * @return array{mode:string,value?:mixed}|null
	 */
	public static function normalize( mixed $raw, string $type, ?array $option_values = null ): ?array {
		if ( ! in_array( $type, self::SUPPORTED_TYPES, true ) ) {
			return null;
		}

		$config = self::parse_config( $raw );
		if ( null === $config ) {
			return null;
		}

		if ( 'today' === $config['mode'] ) {
			return in_array( $type, array( 'date', 'datetime' ), true )
				? array( 'mode' => 'today' )
				: null;
		}

		if ( ! array_key_exists( 'value', $config ) ) {
			return null;
		}

		$value = $config['value'];
		switch ( $type ) {
			case 'text':
			case 'url':
			case 'email':
				$value = sanitize_text_field( (string) $value );
				return '' === $value ? null : array(
					'mode'  => 'value',
					'value' => $value,
				);

			case 'number':
				if ( ! is_numeric( $value ) ) {
					return null;
				}
				$value = (float) $value;
				return is_finite( $value ) ? array(
					'mode'  => 'value',
					'value' => $value,
				) : null;

			case 'date':
				$value = trim( sanitize_text_field( (string) $value ) );
				if ( ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $value, $matches ) ) {
					return null;
				}
				return checkdate( (int) $matches[2], (int) $matches[3], (int) $matches[1] )
					? array(
						'mode'  => 'value',
						'value' => $value,
					)
					: null;

			case 'datetime':
				$value = trim( sanitize_text_field( (string) $value ) );
				if ( '' === $value ) {
					return null;
				}
				$timestamp = strtotime( $value );
				return false === $timestamp ? null : array(
					'mode'  => 'value',
					'value' => gmdate( DATE_RFC3339, $timestamp ),
				);

			case 'checkbox':
				return array(
					'mode'  => 'value',
					'value' => self::boolean_value( $value ),
				);

			case 'select':
				$value = sanitize_text_field( (string) $value );
				if ( '' === $value ) {
					return null;
				}
				if ( null !== $option_values && ! in_array( $value, $option_values, true ) ) {
					return null;
				}
				return array(
					'mode'  => 'value',
					'value' => $value,
				);

			case 'multiselect':
				$entries = is_array( $value ) ? $value : array( $value );
				$values  = array();
				foreach ( $entries as $entry ) {
					$entry = sanitize_text_field( (string) $entry );
					if ( '' === $entry || in_array( $entry, $values, true ) ) {
						continue;
					}
					if ( null !== $option_values && ! in_array( $entry, $option_values, true ) ) {
						continue;
					}
					$values[] = $entry;
				}
				return count( $values ) > 0 ? array(
					'mode'  => 'value',
					'value' => $values,
				) : null;
		}

		return null;
	}

	/**
	 * Applies all supported defaults for a collection to one newly-created row.
	 *
	 * @param int      $collection_id      Collection post id.
	 * @param int      $row_id             Row post id.
	 * @param string[] $explicit_meta_keys Field meta keys explicitly provided during creation.
	 */
	public static function apply_to_row( int $collection_id, int $row_id, array $explicit_meta_keys = array() ): void {
		$field_ids          = array_map( 'intval', get_post_meta( $collection_id, 'fields', false ) );
		$explicit_meta_keys = array_fill_keys( array_map( 'strval', $explicit_meta_keys ), true );
		$store              = new FieldValueStore();
		$status             = (string) get_post_status( $row_id );

		foreach ( $field_ids as $field_id ) {
			$type = (string) get_post_meta( $field_id, 'type', true );
			if ( ! in_array( $type, self::SUPPORTED_TYPES, true ) ) {
				continue;
			}

			$key = Relations::meta_key( $field_id );
			if ( isset( $explicit_meta_keys[ $key ] ) ) {
				continue;
			}

			if ( count( get_metadata( 'post', $row_id, $key, false ) ) > 0 ) {
				continue;
			}

			$config = self::normalize_for_field( $field_id );
			if ( null === $config ) {
				continue;
			}

			$value = self::value_for_creation( $config, $type );
			if ( null === $value ) {
				continue;
			}

			$store->write_value( $row_id, $field_id, $type, $value, $collection_id, $status );
		}
	}

	/**
	 * Returns option values for a select-like field.
	 *
	 * @param int $field_id Field post id.
	 * @return string[]
	 */
	public static function option_values_for_field( int $field_id ): array {
		$raw = (string) get_post_meta( $field_id, 'options', true );
		if ( '' === $raw ) {
			return array();
		}
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) {
			return array();
		}

		$values = array();
		foreach ( $decoded as $entry ) {
			if ( is_string( $entry ) ) {
				$value = sanitize_text_field( $entry );
			} elseif ( is_array( $entry ) && isset( $entry['value'] ) ) {
				$value = sanitize_text_field( (string) $entry['value'] );
			} else {
				continue;
			}
			if ( '' !== $value && ! in_array( $value, $values, true ) ) {
				$values[] = $value;
			}
		}

		return $values;
	}

	/**
	 * Encodes a normalized config for storage.
	 *
	 * @param array<string,mixed>|null $config Normalized config.
	 */
	public static function encode( ?array $config ): string {
		return null === $config ? '' : (string) wp_json_encode( $config );
	}

	/**
	 * Resolves a default config to the value written on a new row.
	 *
	 * @param array{mode:string,value?:mixed} $config Normalized config.
	 * @param string                          $type   Cortext field type.
	 */
	private static function value_for_creation( array $config, string $type ): mixed {
		if ( 'today' !== $config['mode'] ) {
			return $config['value'] ?? null;
		}

		if ( 'date' === $type ) {
			return wp_date( 'Y-m-d' );
		}
		if ( 'datetime' === $type ) {
			return wp_date( DATE_RFC3339 );
		}
		return null;
	}

	private static function parse_config( mixed $raw ): ?array {
		if ( is_string( $raw ) ) {
			$raw = trim( $raw );
			if ( '' === $raw ) {
				return null;
			}
			$decoded = json_decode( $raw, true );
			if ( ! is_array( $decoded ) ) {
				return null;
			}
			$raw = $decoded;
		} elseif ( is_object( $raw ) ) {
			$raw = (array) $raw;
		}

		if ( ! is_array( $raw ) || ! isset( $raw['mode'] ) ) {
			return null;
		}

		$mode = sanitize_key( (string) $raw['mode'] );
		if ( 'today' === $mode ) {
			return array( 'mode' => 'today' );
		}
		if ( 'value' !== $mode || ! array_key_exists( 'value', $raw ) ) {
			return null;
		}

		return array(
			'mode'  => 'value',
			'value' => self::sanitize_payload_value( $raw['value'] ),
		);
	}

	private static function sanitize_payload_value( mixed $value ): mixed {
		if ( is_array( $value ) ) {
			$values = array();
			foreach ( $value as $entry ) {
				if ( is_array( $entry ) || is_object( $entry ) ) {
					continue;
				}
				$values[] = sanitize_text_field( (string) $entry );
			}
			return $values;
		}
		if ( is_bool( $value ) || is_int( $value ) || is_float( $value ) ) {
			return $value;
		}
		return sanitize_text_field( (string) $value );
	}

	private static function boolean_value( mixed $value ): bool {
		if ( is_bool( $value ) ) {
			return $value;
		}
		if ( is_numeric( $value ) ) {
			return 0 !== (int) $value;
		}
		$value = strtolower( trim( (string) $value ) );
		return in_array( $value, array( '1', 'true', 'yes', 'on' ), true );
	}
}
