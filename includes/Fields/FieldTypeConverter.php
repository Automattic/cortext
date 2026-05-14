<?php
/**
 * Classifies how a row value behaves when a field's type changes.
 *
 * The converter does not write row data. It only tells callers whether a
 * stored value would show under the new type, render empty, or was empty
 * already. The commit path changes the field type and, for select-like
 * targets, adds any missing options.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Fields;

final class FieldTypeConverter {

	public const STATUS_DISPLAYS = 'displays';
	public const STATUS_HIDDEN   = 'hidden';
	public const STATUS_EMPTY    = 'empty';

	private const UNSUPPORTED = array( 'relation', 'rollup', 'formula' );

	private const TEXT_LIKE_SOURCES = array( 'text', 'number', 'email', 'url' );

	/**
	 * Whether a field can move from one type to another.
	 *
	 * @param string $from Source Cortext field type.
	 * @param string $to   Target Cortext field type.
	 */
	public static function supports( string $from, string $to ): bool {
		if ( $from === $to ) {
			return false;
		}
		if ( ! FieldTypeRegistry::exists( $from ) || ! FieldTypeRegistry::exists( $to ) ) {
			return false;
		}
		if ( in_array( $from, self::UNSUPPORTED, true ) ) {
			return false;
		}
		if ( in_array( $to, self::UNSUPPORTED, true ) ) {
			return false;
		}
		return true;
	}

	/**
	 * Classifies one stored row value for a type change.
	 *
	 * @param string $from         Source Cortext field type.
	 * @param string $to           Target Cortext field type.
	 * @param mixed  $stored_value Raw stored meta value. For multiselect
	 *                             sources, an array of strings (the full
	 *                             multi-meta-row fetch). Otherwise the single
	 *                             scalar from `get_post_meta(..., true)`.
	 */
	public static function classify( string $from, string $to, mixed $stored_value ): string {
		if ( ! self::supports( $from, $to ) ) {
			return self::STATUS_HIDDEN;
		}

		// Checkboxes can render any stored value as checked or unchecked.
		if ( 'checkbox' === $to ) {
			return self::STATUS_DISPLAYS;
		}

		if ( 'multiselect' === $from ) {
			$values = is_array( $stored_value )
				? array_values( array_filter( $stored_value, static fn( $v ): bool => '' !== (string) $v ) )
				: array();
			return count( $values ) === 0 ? self::STATUS_EMPTY : self::STATUS_DISPLAYS;
		}

		$text = is_array( $stored_value ) ? '' : trim( (string) $stored_value );
		if ( '' === $text ) {
			return self::STATUS_EMPTY;
		}

		// Text-like values become options during the commit.
		if ( in_array( $to, array( 'select', 'multiselect' ), true ) && in_array( $from, self::TEXT_LIKE_SOURCES, true ) ) {
			return self::STATUS_DISPLAYS;
		}

		if ( 'number' === $to ) {
			return is_numeric( $text ) ? self::STATUS_DISPLAYS : self::STATUS_HIDDEN;
		}

		if ( 'date' === $to || 'datetime' === $to ) {
			return false !== strtotime( $text ) ? self::STATUS_DISPLAYS : self::STATUS_HIDDEN;
		}

		if ( 'email' === $to ) {
			return false !== is_email( $text ) ? self::STATUS_DISPLAYS : self::STATUS_HIDDEN;
		}

		if ( 'url' === $to ) {
			return false !== wp_http_validate_url( $text ) ? self::STATUS_DISPLAYS : self::STATUS_HIDDEN;
		}

		// Text and select targets can show any non-empty value.
		return self::STATUS_DISPLAYS;
	}

	/**
	 * Splits text into option tokens.
	 *
	 * A value like `"Open, Closed"` becomes two options: `Open` and `Closed`.
	 *
	 * @param string $value Raw stored value to split.
	 * @return string[]
	 */
	public static function split_tokens( string $value ): array {
		$value = trim( $value );
		if ( '' === $value ) {
			return array();
		}
		$parts  = preg_split( '/[\n,;]/', $value );
		$tokens = array();
		if ( false === $parts ) {
			return array();
		}
		foreach ( $parts as $part ) {
			$token = trim( (string) $part );
			if ( '' !== $token ) {
				$tokens[] = $token;
			}
		}
		return $tokens;
	}

	/**
	 * Whether this type change should add options during commit.
	 *
	 * @param string $from Source Cortext field type.
	 * @param string $to   Target Cortext field type.
	 */
	public static function extends_options( string $from, string $to ): bool {
		if ( ! self::supports( $from, $to ) ) {
			return false;
		}
		if ( ! in_array( $to, array( 'select', 'multiselect' ), true ) ) {
			return false;
		}
		return in_array( $from, self::TEXT_LIKE_SOURCES, true );
	}
}
