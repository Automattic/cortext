<?php
/**
 * Classifies how a row value behaves when a field's type changes.
 *
 * The converter never writes anything. It tells callers, per stored value,
 * whether the cell will render under the target type ("displays"), render
 * empty ("hidden"), or was already empty ("empty"). The commit handler
 * uses these counts to drive the preview UI; the actual conversion at
 * commit time is just `update_post_meta` on the field's `type` (plus an
 * option-list extension for select / multiselect targets).
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
	 * Whether a type-change conversion is supported.
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
	 * Classifies a stored row value under a type change.
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

		// Checkbox target always renders (truthy → checked, falsy → unchecked).
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

		// text/number/email/url → select / multiselect always displays (commit auto-adds options).
		if ( in_array( $to, array( 'select', 'multiselect' ), true ) && in_array( $from, self::TEXT_LIKE_SOURCES, true ) ) {
			return self::STATUS_DISPLAYS;
		}

		// select → anything else falls through to the target-specific check below.

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
			return '' !== esc_url_raw( $text ) ? self::STATUS_DISPLAYS : self::STATUS_HIDDEN;
		}

		// text / select target: any non-empty source renders.
		return self::STATUS_DISPLAYS;
	}

	/**
	 * Splits a text-like value into tokens on `\n`, `,`, `;`.
	 *
	 * Used when converting text/number/email/url into select or multiselect:
	 * a row value like `"Open, Closed"` contributes both `Open` and `Closed`
	 * as options, and a multiselect cell renders two chips.
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
	 * Whether the conversion auto-extends the field's option list at commit.
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
