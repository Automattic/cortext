<?php
/**
 * Per-type policy table for Cortext field types.
 *
 * Single source of truth for which capabilities each field type has —
 * whether it can be sorted or filtered, which filter operators it accepts,
 * whether it is included in full-text search, and how its values are typed
 * in WP postmeta. Consumers (`FieldsController`, `Document::register_field_meta`,
 * `RowsFilterQuery`) read from here instead of re-listing types in scattered
 * constants.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Fields;

final class FieldTypeRegistry {

	private const TEXT_OPERATORS = array(
		'is',
		'isNot',
		'contains',
		'notContains',
		'startsWith',
		'endsWith',
		'isEmpty',
		'isNotEmpty',
	);

	private const NUMBER_OPERATORS = array(
		'is',
		'greaterThan',
		'lessThan',
		'between',
		'isEmpty',
	);

	private const DATE_OPERATORS = array(
		'is',
		'on',
		'before',
		'after',
		'between',
		'isEmpty',
	);

	private const SELECT_OPERATORS = array(
		'is',
		'isNot',
		'isAny',
		'isNone',
	);

	private const MULTISELECT_OPERATORS = array(
		'contains',
		'notContains',
		'isAny',
		'isNone',
	);

	private const CHECKBOX_OPERATORS = array(
		'isChecked',
		'isUnchecked',
	);

	/**
	 * Per-type policy. `wp_meta_type` matches the values accepted by
	 * `register_post_meta`'s `type` option ('string'|'number'|'boolean').
	 */
	private const TYPES = array(
		'text'        => array(
			'sortable'     => true,
			'filterable'   => true,
			'text_like'    => true,
			'wp_meta_type' => 'string',
			'operators'    => self::TEXT_OPERATORS,
		),
		'email'       => array(
			'sortable'     => true,
			'filterable'   => true,
			'text_like'    => true,
			'wp_meta_type' => 'string',
			'operators'    => self::TEXT_OPERATORS,
		),
		'url'         => array(
			'sortable'     => true,
			'filterable'   => true,
			'text_like'    => true,
			'wp_meta_type' => 'string',
			'operators'    => self::TEXT_OPERATORS,
		),
		'number'      => array(
			'sortable'     => true,
			'filterable'   => true,
			'text_like'    => false,
			'wp_meta_type' => 'number',
			'operators'    => self::NUMBER_OPERATORS,
		),
		'date'        => array(
			'sortable'     => true,
			'filterable'   => true,
			'text_like'    => false,
			'wp_meta_type' => 'string',
			'operators'    => self::DATE_OPERATORS,
		),
		'datetime'    => array(
			'sortable'     => true,
			'filterable'   => true,
			'text_like'    => false,
			'wp_meta_type' => 'string',
			'operators'    => self::DATE_OPERATORS,
		),
		'checkbox'    => array(
			'sortable'     => true,
			'filterable'   => true,
			'text_like'    => false,
			'wp_meta_type' => 'boolean',
			'operators'    => self::CHECKBOX_OPERATORS,
		),
		'select'      => array(
			'sortable'     => true,
			'filterable'   => true,
			'text_like'    => false,
			'wp_meta_type' => 'string',
			'operators'    => self::SELECT_OPERATORS,
		),
		'multiselect' => array(
			'sortable'     => false,
			'filterable'   => true,
			'text_like'    => false,
			'wp_meta_type' => 'string',
			'operators'    => self::MULTISELECT_OPERATORS,
		),
		'relation'    => array(
			'sortable'     => false,
			'filterable'   => false,
			'text_like'    => false,
			'wp_meta_type' => 'string',
			'operators'    => array(),
		),
		'rollup'      => array(
			'sortable'     => false,
			'filterable'   => false,
			'text_like'    => false,
			'wp_meta_type' => 'string',
			'operators'    => array(),
		),
	);

	/**
	 * Per-type policy. `wp_meta_type` matches the values accepted by
	 * `register_post_meta`'s `type` option ('string'|'number'|'boolean').
	 *
	 * @return array<string,array{sortable:bool,filterable:bool,text_like:bool,wp_meta_type:string,operators:string[]}>
	 */
	public static function all(): array {
		return self::TYPES;
	}

	/**
	 * Returns all known field type keys.
	 *
	 * @return string[]
	 */
	public static function types(): array {
		return array_keys( self::all() );
	}

	public static function exists( string $type ): bool {
		return isset( self::all()[ $type ] );
	}

	public static function is_sortable( string $type ): bool {
		return self::all()[ $type ]['sortable'] ?? false;
	}

	public static function is_filterable( string $type ): bool {
		return self::all()[ $type ]['filterable'] ?? false;
	}

	public static function is_text_like( string $type ): bool {
		return self::all()[ $type ]['text_like'] ?? false;
	}

	public static function wp_meta_type( string $type ): string {
		return self::all()[ $type ]['wp_meta_type'] ?? 'string';
	}

	/**
	 * Returns the client-facing filter operators supported by a field type.
	 *
	 * @param string $type Cortext field type.
	 * @return string[]
	 */
	public static function operators_for( string $type ): array {
		return self::all()[ $type ]['operators'] ?? array();
	}

	/**
	 * Returns the REST-safe query capabilities for a field type.
	 *
	 * @param string $type Cortext field type.
	 * @return array{sortable:bool,filterable:bool,operators:string[]}
	 */
	public static function capabilities_for( string $type ): array {
		return array(
			'sortable'   => self::is_sortable( $type ),
			'filterable' => self::is_filterable( $type ),
			'operators'  => self::operators_for( $type ),
		);
	}
}
