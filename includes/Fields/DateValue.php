<?php
/**
 * Date and date-range values for date and datetime properties.
 *
 * A value is a single date (`2026-03-01`, or RFC 3339 in UTC for datetime)
 * or an ISO 8601 interval joining a start and an end with a slash
 * (`2026-03-01/2026-06-30`). The start always comes first, so sorting and
 * prefix matching on the raw string still go by the start.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Fields;

defined( 'ABSPATH' ) || exit;

final class DateValue {

	public const SEPARATOR = '/';

	/**
	 * Splits a stored or incoming value into canonical start and end.
	 *
	 * Returns null for empty or unparseable values. `end` is null for a
	 * single date. A reversed range is swapped, and an end equal to the
	 * start collapses to a single date.
	 *
	 * @param mixed  $value Raw value.
	 * @param string $type  `date` or `datetime`.
	 * @return array{start: string, end: string|null}|null
	 */
	public static function parse( mixed $value, string $type ): ?array {
		if ( ! is_scalar( $value ) ) {
			return null;
		}

		$text = trim( (string) $value );
		if ( '' === $text ) {
			return null;
		}

		$start_text = $text;
		$end_text   = '';
		// Only canonical ISO starts can carry an end, so free-form input
		// like `03/01/2026` is never read as a range.
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}/', $text ) && 1 === substr_count( $text, self::SEPARATOR ) ) {
			list( $start_text, $end_text ) = array_map( 'trim', explode( self::SEPARATOR, $text ) );
		}

		$start = self::normalize_single( $start_text, $type );
		if ( null === $start ) {
			return null;
		}

		$end = '' === $end_text ? null : self::normalize_single( $end_text, $type );
		if ( null === $end || $end === $start ) {
			return array(
				'start' => $start,
				'end'   => null,
			);
		}

		if ( strtotime( $end ) < strtotime( $start ) ) {
			list( $start, $end ) = array( $end, $start );
		}

		return array(
			'start' => $start,
			'end'   => $end,
		);
	}

	/**
	 * Returns the canonical string to store, or `''` when empty.
	 *
	 * Unparseable text is kept as sanitized text so nothing the user typed
	 * is silently dropped.
	 *
	 * @param mixed  $value Raw value.
	 * @param string $type  `date` or `datetime`.
	 */
	public static function normalize( mixed $value, string $type ): string {
		$parts = self::parse( $value, $type );
		if ( null !== $parts ) {
			return self::join( $parts['start'], $parts['end'] );
		}

		return is_scalar( $value ) ? sanitize_text_field( trim( (string) $value ) ) : '';
	}

	/**
	 * The canonical start of a value, or `''` when it has none.
	 *
	 * @param mixed  $value Raw value.
	 * @param string $type  `date` or `datetime`.
	 */
	public static function start( mixed $value, string $type ): string {
		return self::parse( $value, $type )['start'] ?? '';
	}

	/**
	 * The canonical end of a value, falling back to the start for a single date.
	 *
	 * @param mixed  $value Raw value.
	 * @param string $type  `date` or `datetime`.
	 */
	public static function end( mixed $value, string $type ): string {
		$parts = self::parse( $value, $type );
		return $parts['end'] ?? $parts['start'] ?? '';
	}

	public static function join( string $start, ?string $end ): string {
		return null === $end ? $start : $start . self::SEPARATOR . $end;
	}

	private static function normalize_single( string $text, string $type ): ?string {
		if ( '' === $text ) {
			return null;
		}

		if ( 'date' === $type && preg_match( '/^(\d{4})-(\d{2})-(\d{2})/', $text, $matches ) ) {
			return checkdate( (int) $matches[2], (int) $matches[3], (int) $matches[1] ) ? $matches[0] : null;
		}

		$timestamp = strtotime( $text );
		if ( false === $timestamp ) {
			return null;
		}

		return 'date' === $type ? gmdate( 'Y-m-d', $timestamp ) : gmdate( DATE_RFC3339, $timestamp );
	}
}
