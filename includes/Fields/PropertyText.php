<?php
/**
 * Turns a row's property values into display text.
 *
 * The editor formats the same values in `src/utils/propertyText.js`. Both
 * sides run `tests/fixtures/property-text.json`, so a change to one side
 * needs the same change on the other.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Fields;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use Cortext\Rest\RowsController;
use DateTimeZone;
use IntlDateFormatter;
use IntlDatePatternGenerator;
use NumberFormatter;
use WP_Post;

final class PropertyText {

	/**
	 * Keys for the system fields every row has, in the order the editor lists them.
	 */
	public const SYSTEM_KEYS = array( 'created_at', 'created_by', 'modified_at', 'modified_by' );

	private const FORMULA_RESULT_TYPES       = array( 'text', 'number', 'date', 'datetime', 'checkbox' );
	private const ROLLUP_VALUE_AGGREGATORS   = array( 'show_original', 'show_unique' );
	private const ROLLUP_DATE_AGGREGATORS    = array( 'earliest', 'latest' );
	private const ROLLUP_PERCENT_AGGREGATORS = array( 'percent_empty', 'percent_not_empty' );
	private const SYSTEM_DATE_KEYS           = array( 'created_at', 'modified_at' );
	private const SYSTEM_DATE_DISPLAY_FORMAT = 'M j, Y g:i a';
	private const MAX_DECIMALS               = 6;
	private const DEFAULT_DECIMAL_PRECISION  = 3;

	/**
	 * Typed row values, cached per row for the current request.
	 *
	 * @var array<int,array|null>
	 */
	private array $rows = array();

	public function __construct( private RowsController $rows_controller = new RowsController() ) {}

	/**
	 * Display text for one of a row's properties, or '' when the row has no
	 * such property or the value is empty.
	 *
	 * @param int    $row_id Row post ID.
	 * @param string $key    Field post ID, or one of `SYSTEM_KEYS`.
	 * @param bool   $raw    Return the stored value without locale formatting,
	 *                       for attributes such as an image URL or ID.
	 */
	public function for_row( int $row_id, string $key, bool $raw = false ): string {
		$values = $this->typed_values( $row_id );
		if ( null === $values ) {
			return '';
		}

		if ( in_array( $key, self::SYSTEM_KEYS, true ) ) {
			$value = $values['system'][ $key ] ?? '';
			if ( $raw || '' === $value || ! in_array( $key, self::SYSTEM_DATE_KEYS, true ) ) {
				return (string) $value;
			}
			$timestamp = strtotime( $value );
			return false === $timestamp ? '' : wp_date( self::SYSTEM_DATE_DISPLAY_FORMAT, $timestamp );
		}

		$field_id = ctype_digit( $key ) ? (int) $key : 0;
		if ( $field_id < 1 || ! array_key_exists( $field_id, $values['fields'] ) ) {
			return '';
		}

		$config = self::config_for_field( $field_id );
		$value  = $values['fields'][ $field_id ];
		if ( 'relation' === $config['type'] ) {
			$value = self::visible_relation_refs( $value );
		}

		return $raw ? self::raw_text( $value, $config ) : self::format( $value, $config );
	}

	/**
	 * Formats a typed value for display.
	 *
	 * @param mixed $value  Typed value, as found in `cortext_hydrated_meta`.
	 * @param array $config `type` (display type), optional `format` and `elements`.
	 */
	public static function format( mixed $value, array $config ): string {
		$type = (string) ( $config['type'] ?? 'text' );

		// An unset checkbox is unchecked, not empty.
		if ( 'checkbox' === $type && ! is_array( $value ) ) {
			return self::is_checked( $value ?? '' ) ? __( 'Yes', 'cortext' ) : __( 'No', 'cortext' );
		}

		if ( null === $value || '' === $value ) {
			return '';
		}

		if ( 'rollup-date-range' === $type ) {
			return self::format_date_range( $value, $config['format'] ?? array() );
		}

		if ( 'relation' === $type ) {
			$titles = array();
			foreach ( is_array( $value ) ? $value : array() as $ref ) {
				$title    = is_array( $ref ) ? (string) ( $ref['title']['raw'] ?? '' ) : '';
				$titles[] = '' === $title ? __( '(untitled)', 'cortext' ) : $title;
			}
			return implode( ', ', $titles );
		}

		if ( is_array( $value ) ) {
			$scalar_config = 'multiselect' === $type ? array( 'type' => 'select' ) + $config : $config;
			$parts         = array();
			foreach ( $value as $item ) {
				$text = self::format( $item, $scalar_config );
				if ( '' !== $text ) {
					$parts[] = $text;
				}
			}
			return implode( ', ', $parts );
		}

		switch ( $type ) {
			case 'number':
				return self::format_number( $value, $config['format'] ?? array() );
			case 'date':
			case 'datetime':
				return self::format_date( (string) $value, $type, $config['format'] ?? array() );
			case 'select':
			case 'multiselect':
				return self::option_label( (string) $value, $config['elements'] ?? array() );
			default:
				return is_scalar( $value ) ? trim( (string) $value ) : '';
		}
	}

	/**
	 * Builds the `format()` config for a stored field, the way the editor's
	 * `mapField` does in `src/hooks/fieldMapping.js`.
	 *
	 * @param int $field_id Field post ID.
	 * @return array{type:string,format?:array,elements?:array}
	 */
	public static function config_for_field( int $field_id ): array {
		$type = (string) get_post_meta( $field_id, 'type', true );

		if ( 'formula' === $type ) {
			$result = (string) get_post_meta( $field_id, 'formula_result_type', true );
			return array( 'type' => in_array( $result, self::FORMULA_RESULT_TYPES, true ) ? $result : 'text' );
		}

		if ( 'rollup' === $type ) {
			return self::rollup_config( $field_id );
		}

		$config = array( 'type' => '' === $type ? 'text' : $type );
		if ( 'number' === $type ) {
			$config['format'] = self::json_meta( $field_id, 'number_format' );
		} elseif ( 'date' === $type || 'datetime' === $type ) {
			$config['format'] = self::json_meta( $field_id, 'date_format' );
		} elseif ( 'select' === $type || 'multiselect' === $type ) {
			$config['elements'] = self::json_meta( $field_id, 'options' );
		}
		return $config;
	}

	private function typed_values( int $row_id ): ?array {
		if ( ! array_key_exists( $row_id, $this->rows ) ) {
			$post                  = get_post( $row_id );
			$this->rows[ $row_id ] = $post instanceof WP_Post
				? $this->rows_controller->typed_values_for_row( $post )
				: null;
		}
		return $this->rows[ $row_id ];
	}

	private static function rollup_config( int $field_id ): array {
		$aggregator  = (string) get_post_meta( $field_id, 'rollup_aggregator', true );
		$aggregator  = '' === $aggregator ? 'count' : $aggregator;
		$target_type = (string) get_post_meta( $field_id, 'rollup_target_type', true );

		$format = array();
		if ( 'number' === $target_type ) {
			$format = self::json_meta( $field_id, 'rollup_target_number_format' );
		} elseif ( 'date' === $target_type || 'datetime' === $target_type ) {
			$format = self::json_meta( $field_id, 'rollup_target_date_format' );
		}
		if ( in_array( $aggregator, self::ROLLUP_PERCENT_AGGREGATORS, true ) ) {
			$format['style']    = 'percent';
			$format['decimals'] = $format['decimals'] ?? 0;
		}
		$format['rollup_target_type'] = $target_type;

		if ( 'date_range' === $aggregator ) {
			$type = 'rollup-date-range';
		} elseif ( in_array( $aggregator, self::ROLLUP_VALUE_AGGREGATORS, true ) ) {
			$type = '' === $target_type ? 'text' : $target_type;
			$type = 'select' === $type ? 'multiselect' : $type;
		} elseif ( in_array( $aggregator, self::ROLLUP_DATE_AGGREGATORS, true ) ) {
			$type = 'datetime' === $target_type ? 'datetime' : 'date';
		} else {
			$type = 'number';
		}

		return array(
			'type'     => $type,
			'format'   => $format,
			'elements' => self::json_meta( $field_id, 'rollup_target_options' ),
		);
	}

	private static function json_meta( int $field_id, string $key ): array {
		$decoded = json_decode( (string) get_post_meta( $field_id, $key, true ), true );
		return is_array( $decoded ) ? $decoded : array();
	}

	/**
	 * Drops relation targets the viewer may not see, so a private document's
	 * title never reaches a public page.
	 *
	 * @param mixed $refs Hydrated relation references.
	 */
	private static function visible_relation_refs( mixed $refs ): array {
		if ( ! is_array( $refs ) ) {
			return array();
		}
		return array_values(
			array_filter(
				$refs,
				static fn( $ref ): bool => is_array( $ref )
					&& Documents::is_visible_to_viewer( get_post( (int) ( $ref['id'] ?? 0 ) ) )
			)
		);
	}

	private static function raw_text( mixed $value, array $config ): string {
		if ( is_array( $value ) ) {
			return 'relation' === $config['type'] ? '' : implode( ', ', array_map( 'strval', array_filter( $value, 'is_scalar' ) ) );
		}
		if ( is_bool( $value ) ) {
			return $value ? '1' : '';
		}
		return is_scalar( $value ) ? trim( (string) $value ) : '';
	}

	private static function is_checked( mixed $value ): bool {
		return is_bool( $value ) ? $value : in_array( strtolower( trim( (string) $value ) ), array( '1', 'true', 'yes', 'on' ), true );
	}

	private static function option_label( string $value, array $elements ): string {
		foreach ( $elements as $element ) {
			if ( is_string( $element ) && $element === $value ) {
				return $element;
			}
			if ( is_array( $element ) && (string) ( $element['value'] ?? '' ) === $value ) {
				return (string) ( $element['label'] ?? $element['value'] );
			}
		}
		return $value;
	}

	private static function format_date_range( mixed $value, array $format ): string {
		if ( ! is_array( $value ) ) {
			return '';
		}
		$type  = 'datetime' === ( $format['rollup_target_type'] ?? '' ) ? 'datetime' : 'date';
		$start = empty( $value['start'] ) ? '' : self::format_date( (string) $value['start'], $type, $format );
		$end   = empty( $value['end'] ) ? '' : self::format_date( (string) $value['end'], $type, $format );
		if ( '' !== $start && '' !== $end && $start !== $end ) {
			return "{$start} - {$end}";
		}
		return '' !== $start ? $start : $end;
	}

	/**
	 * Mirrors `formatNumberValue` in `src/components/EditableCell.js`.
	 *
	 * @param mixed $value  Number.
	 * @param array $format Stored `number_format` config.
	 */
	private static function format_number( mixed $value, array $format ): string {
		if ( ! is_numeric( $value ) ) {
			return (string) $value;
		}
		$number   = (float) $value;
		$style    = (string) ( $format['style'] ?? 'plain' );
		$decimals = isset( $format['decimals'] ) && is_numeric( $format['decimals'] )
			? max( 0, min( self::MAX_DECIMALS, (int) $format['decimals'] ) )
			: null;
		$currency = (string) ( $format['currency'] ?? '' );
		$currency = '' === $currency ? 'USD' : $currency;

		if ( class_exists( NumberFormatter::class ) ) {
			$intl_style = match ( $style ) {
				'percent'  => NumberFormatter::PERCENT,
				'currency' => NumberFormatter::CURRENCY,
				default    => NumberFormatter::DECIMAL,
			};
			$formatter = new NumberFormatter( get_locale(), $intl_style );
			if ( 'percent' !== $style && 'currency' !== $style ) {
				$formatter->setAttribute( NumberFormatter::GROUPING_USED, 'comma' === $style ? 1 : 0 );
			}
			if ( null !== $decimals ) {
				$formatter->setAttribute( NumberFormatter::MIN_FRACTION_DIGITS, $decimals );
				$formatter->setAttribute( NumberFormatter::MAX_FRACTION_DIGITS, $decimals );
			}
			$text = 'currency' === $style
				? $formatter->formatCurrency( $number, $currency )
				: $formatter->format( $number );
			if ( false !== $text ) {
				return $text;
			}
		}

		// Without intl, get close with WordPress's locale number format.
		global $wp_locale;
		$decimal_point = $wp_locale->number_format['decimal_point'] ?? '.';
		$thousands     = $wp_locale->number_format['thousands_sep'] ?? ',';
		if ( 'percent' === $style ) {
			$number *= 100;
		}
		$places = $decimals ?? self::DEFAULT_DECIMAL_PRECISION;
		$text   = number_format( $number, $places, $decimal_point, 'plain' === $style ? '' : $thousands );
		if ( null === $decimals && str_contains( $text, $decimal_point ) ) {
			$text = rtrim( rtrim( $text, '0' ), $decimal_point );
		}
		if ( 'percent' === $style ) {
			return $text . '%';
		}
		return 'currency' === $style ? "{$text} {$currency}" : $text;
	}

	/**
	 * Mirrors `formatDateValue` in `src/components/EditableCell.js`.
	 *
	 * @param string $value  `Y-m-d` date or RFC3339 datetime.
	 * @param string $type   `date` or `datetime`.
	 * @param array  $format Stored `date_format` config.
	 */
	private static function format_date( string $value, string $type, array $format ): string {
		$style  = (string) ( $format['style'] ?? 'locale' );
		$hour12 = (bool) ( $format['hour12'] ?? true );
		$locale = match ( $style ) {
			'us'    => 'en_US',
			'eu'    => 'en_GB',
			default => get_locale(),
		};

		// A date-only value is a calendar day, so format it in UTC to keep
		// the day from shifting.
		$is_day    = 'date' === $type && 1 === preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value );
		$show_time = ! $is_day && (bool) ( $format['time'] ?? 'datetime' === $type );
		$timezone  = $is_day ? new DateTimeZone( 'UTC' ) : wp_timezone();
		$timestamp = strtotime( $is_day ? "{$value} 00:00:00 UTC" : $value );
		if ( false === $timestamp ) {
			return $value;
		}

		if ( class_exists( IntlDatePatternGenerator::class ) ) {
			$skeleton = 'yyyyMMdd' . ( $show_time ? ( $hour12 ? 'hhmm' : 'HHmm' ) : '' );
			$pattern  = ( new IntlDatePatternGenerator( $locale ) )->getBestPattern( $skeleton );
			// Intl in the browser keeps two-digit hours, but the pattern
			// generator shortens them to one.
			$pattern   = false === $pattern ? false : preg_replace( '/(?<![hHkK])([hHkK])(?![hHkK])/', '$1$1', $pattern );
			$formatter = false === $pattern
				? false
				: IntlDateFormatter::create( $locale, IntlDateFormatter::NONE, IntlDateFormatter::NONE, $timezone, null, $pattern );
			if ( $formatter ) {
				$text = $formatter->format( $timestamp );
				if ( false !== $text ) {
					return $text;
				}
			}
		}

		$date_format = match ( $style ) {
			'us'    => 'm/d/Y',
			'eu'    => 'd/m/Y',
			default => (string) get_option( 'date_format', 'Y-m-d' ),
		};
		$time_format = $hour12 ? 'h:i A' : 'H:i';
		return wp_date( $show_time ? "{$date_format}, {$time_format}" : $date_format, $timestamp, $timezone );
	}
}
