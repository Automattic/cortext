<?php
/**
 * Query helpers for collection row sorting, filtering, and search.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Fields\FieldTypeRegistry;
use WP_Error;

final class RowsFilterQuery {

	private const MAX_GROUP_DEPTH = 2;

	/**
	 * Field schema cache keyed by collection post ID.
	 *
	 * @var array<int,array<string,array{id:int,key:string,type:string,sortable:bool,filterable:bool,operators:string[],system?:bool}>>
	 */
	private array $schema_cache = array();

	/**
	 * Builds a row-query field schema for one collection.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return array<string,array{id:int,key:string,type:string,sortable:bool,filterable:bool,operators:string[],system?:bool}>
	 */
	public function field_schema_for( int $collection_id ): array {
		if ( isset( $this->schema_cache[ $collection_id ] ) ) {
			return $this->schema_cache[ $collection_id ];
		}

		$schema = array(
			'title'       => array(
				'id'         => 0,
				'key'        => 'title',
				'type'       => 'title',
				'sortable'   => true,
				'filterable' => true,
				'operators'  => FieldTypeRegistry::operators_for( 'text' ),
				'system'     => true,
			),
			'created_at'  => array(
				'id'         => 0,
				'key'        => 'created_at',
				'type'       => 'datetime',
				'sortable'   => true,
				'filterable' => false,
				'operators'  => array(),
				'system'     => true,
			),
			'modified_at' => array(
				'id'         => 0,
				'key'        => 'modified_at',
				'type'       => 'datetime',
				'sortable'   => true,
				'filterable' => false,
				'operators'  => array(),
				'system'     => true,
			),
			'manual'      => array(
				'id'         => 0,
				'key'        => 'manual',
				'type'       => 'manual',
				'sortable'   => true,
				'filterable' => false,
				'operators'  => array(),
				'system'     => true,
			),
		);

		foreach ( get_post_meta( $collection_id, 'fields', false ) as $raw_field_id ) {
			$field_id = (int) $raw_field_id;
			if ( $field_id < 1 ) {
				continue;
			}
			$type = (string) get_post_meta( $field_id, 'type', true );
			$key  = "field-{$field_id}";

			$schema[ $key ] = array(
				'id'         => $field_id,
				'key'        => $key,
				'type'       => $type,
				'sortable'   => FieldTypeRegistry::is_sortable( $type ),
				'filterable' => FieldTypeRegistry::is_filterable( $type ),
				'operators'  => FieldTypeRegistry::operators_for( $type ),
			);
		}

		$this->schema_cache[ $collection_id ] = $schema;
		return $schema;
	}

	/**
	 * Validates a sort request against the collection schema.
	 *
	 * @param mixed $sort          Sort request value.
	 * @param array $field_schema  Field schema from field_schema_for().
	 * @param int   $collection_id Collection post ID for errors.
	 * @return bool|WP_Error
	 */
	public function validate_sort( mixed $sort, array $field_schema, int $collection_id ): bool|WP_Error {
		if ( ! is_array( $sort ) || empty( $sort['field'] ) ) {
			return true;
		}

		$field = (string) $sort['field'];
		if ( ! isset( $field_schema[ $field ] ) || ! $field_schema[ $field ]['sortable'] ) {
			return new WP_Error(
				'cortext_invalid_sort_field',
				sprintf(
					/* translators: 1: field key, 2: collection ID */
					__( 'Field "%1$s" cannot be used to sort collection %2$d.', 'cortext' ),
					$field,
					$collection_id
				),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * Validates and compiles a filter tree into prepared JOIN/WHERE SQL.
	 *
	 * @param mixed $filters       REST filters param.
	 * @param array $field_schema  Field schema from field_schema_for().
	 * @param int   $collection_id Collection post ID for errors.
	 * @return array{join:string,where:string}|WP_Error SQL fragments, or empty strings.
	 */
	public function compile_filters( mixed $filters, array $field_schema, int $collection_id ): array|WP_Error {
		if ( ! is_array( $filters ) || count( $filters ) === 0 ) {
			return $this->empty_sql_clauses();
		}

		$query = array( 'relation' => 'AND' );
		foreach ( $filters as $filter ) {
			$compiled = $this->compile_filter_node( $filter, $field_schema, $collection_id, 0 );
			if ( is_wp_error( $compiled ) ) {
				return $compiled;
			}
			if ( count( $compiled ) > 0 ) {
				$query[] = $compiled;
			}
		}

		if ( count( $query ) === 1 ) {
			return $this->empty_sql_clauses();
		}

		return $this->meta_query_sql( $query );
	}

	/**
	 * Compiles split-term search across title plus text-like meta fields.
	 *
	 * @param string $search       Search string.
	 * @param array  $field_schema Field schema from field_schema_for().
	 * @return string SQL fragment without leading AND, or empty string.
	 */
	public function compile_search( string $search, array $field_schema ): string {
		$terms = preg_split( '/\s+/', trim( $search ) );
		$terms = is_array( $terms ) ? $terms : array();
		$terms = array_values(
			array_filter(
				$terms,
				static fn( $term ) => '' !== $term
			)
		);
		if ( count( $terms ) === 0 ) {
			return '';
		}

		$text_keys = array();
		foreach ( $field_schema as $field ) {
			if ( empty( $field['system'] ) && FieldTypeRegistry::is_text_like( $field['type'] ) ) {
				$text_keys[] = $field['key'];
			}
		}

		$parts = array();
		foreach ( $terms as $term ) {
			$parts[] = $this->search_term_sql( (string) $term, $text_keys );
		}
		return '( ' . implode( ' AND ', $parts ) . ' )';
	}

	/**
	 * Applies custom sort clauses for row-field sorts that need LEFT JOIN.
	 *
	 * @param array $clauses      WP_Query SQL clauses.
	 * @param mixed $sort         Sort request value.
	 * @param array $field_schema Field schema from field_schema_for().
	 * @return array
	 */
	public function apply_sort_clauses( array $clauses, mixed $sort, array $field_schema ): array {
		if ( ! is_array( $sort ) || empty( $sort['field'] ) ) {
			return $clauses;
		}

		$field_key = (string) $sort['field'];
		if ( ! str_starts_with( $field_key, 'field-' ) || empty( $field_schema[ $field_key ] ) ) {
			return $clauses;
		}

		global $wpdb;

		$direction = ( $sort['direction'] ?? 'asc' ) === 'desc' ? 'DESC' : 'ASC';
		$field     = $field_schema[ $field_key ];
		$alias     = 'cortext_sort_meta';

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$clauses['join'] .= $wpdb->prepare(
			" LEFT JOIN {$wpdb->postmeta} AS {$alias} ON ({$alias}.post_id = {$wpdb->posts}.ID AND {$alias}.meta_key = %s)",
			$field_key
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		if ( 'checkbox' === $field['type'] ) {
			$clauses['orderby'] = "CASE WHEN {$alias}.meta_value = '1' THEN 1 ELSE 0 END {$direction}, {$wpdb->posts}.ID ASC";
			return $clauses;
		}

		$empty_order = "CASE WHEN {$alias}.meta_id IS NULL OR {$alias}.meta_value = '' THEN 1 ELSE 0 END ASC";
		$value_expr  = 'number' === $field['type']
			? "CAST({$alias}.meta_value AS DECIMAL(20,6))"
			: "{$alias}.meta_value";

		$clauses['orderby'] = "{$empty_order}, {$value_expr} {$direction}, {$wpdb->posts}.ID ASC";
		return $clauses;
	}

	/**
	 * Adds compiled filter JOINs and de-duplicates joined rows.
	 *
	 * WP_Query normally adds `GROUP BY posts.ID` when its own `meta_query`
	 * object introduces meta joins. RSM-1459 builds SQL through RowsMetaQuery
	 * and injects it as scoped clause filters, so we need to add the same
	 * de-duplication ourselves for multi-value meta filters.
	 *
	 * @param array  $clauses WP_Query SQL clauses.
	 * @param string $join    Compiled filter JOIN SQL.
	 * @return array
	 */
	public function apply_filter_join_clauses( array $clauses, string $join ): array {
		if ( '' === $join ) {
			return $clauses;
		}

		global $wpdb;

		$clauses['join'] = (string) ( $clauses['join'] ?? '' ) . $join;

		$post_id = "{$wpdb->posts}.ID";
		$groupby = trim( (string) ( $clauses['groupby'] ?? '' ) );
		if ( '' === $groupby ) {
			$clauses['groupby'] = $post_id;
		} elseif ( ! str_contains( $groupby, $post_id ) ) {
			$clauses['groupby'] = "{$groupby}, {$post_id}";
		}

		return $clauses;
	}

	/**
	 * Compiles one leaf or group node.
	 *
	 * @param mixed $node          Filter node.
	 * @param array $field_schema  Field schema from field_schema_for().
	 * @param int   $collection_id Collection post ID for errors.
	 * @param int   $depth         Group depth; top-level leaves are 0.
	 * @return array|WP_Error
	 */
	private function compile_filter_node( mixed $node, array $field_schema, int $collection_id, int $depth ): array|WP_Error {
		if ( ! is_array( $node ) ) {
			return $this->invalid_filter( __( 'Filter must be an object.', 'cortext' ) );
		}

		$is_group = isset( $node['relation'] ) || isset( $node['filters'] );
		$is_leaf  = isset( $node['field'] ) || isset( $node['operator'] );

		if ( $is_group && $is_leaf ) {
			return $this->invalid_filter( __( 'Filter cannot be both a group and a leaf.', 'cortext' ) );
		}

		if ( $is_group ) {
			return $this->compile_filter_group( $node, $field_schema, $collection_id, $depth );
		}

		if ( ! $is_leaf ) {
			return $this->invalid_filter( __( 'Filter must include a field and operator.', 'cortext' ) );
		}

		return $this->compile_filter_leaf( $node, $field_schema, $collection_id );
	}

	/**
	 * Compiles an AND/OR filter group.
	 *
	 * @param array $group         Filter group.
	 * @param array $field_schema  Field schema from field_schema_for().
	 * @param int   $collection_id Collection post ID for errors.
	 * @param int   $depth         Group depth.
	 * @return array|WP_Error
	 */
	private function compile_filter_group( array $group, array $field_schema, int $collection_id, int $depth ): array|WP_Error {
		if ( $depth > self::MAX_GROUP_DEPTH ) {
			return new WP_Error(
				'cortext_filter_depth_exceeded',
				__( 'Filter groups cannot be nested more than two levels deep.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$relation = strtoupper( (string) ( $group['relation'] ?? 'AND' ) );
		if ( ! in_array( $relation, array( 'AND', 'OR' ), true ) ) {
			return new WP_Error(
				'cortext_invalid_filter_relation',
				__( 'Filter group relation must be AND or OR.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( ! isset( $group['filters'] ) || ! is_array( $group['filters'] ) || count( $group['filters'] ) === 0 ) {
			return $this->invalid_filter( __( 'Filter group must include child filters.', 'cortext' ) );
		}

		$query = array( 'relation' => $relation );
		foreach ( $group['filters'] as $child ) {
			$compiled = $this->compile_filter_node( $child, $field_schema, $collection_id, $depth + 1 );
			if ( is_wp_error( $compiled ) ) {
				return $compiled;
			}
			if ( count( $compiled ) > 0 ) {
				$query[] = $compiled;
			}
		}

		if ( count( $query ) === 1 ) {
			return array();
		}
		return $query;
	}

	/**
	 * Compiles one field/operator/value filter.
	 *
	 * @param array $filter        Filter leaf.
	 * @param array $field_schema  Field schema from field_schema_for().
	 * @param int   $collection_id Collection post ID for errors.
	 * @return array|WP_Error
	 */
	private function compile_filter_leaf( array $filter, array $field_schema, int $collection_id ): array|WP_Error {
		$field_key = isset( $filter['field'] ) ? (string) $filter['field'] : '';
		$operator  = isset( $filter['operator'] ) ? (string) $filter['operator'] : '';

		if ( '' === $field_key || '' === $operator ) {
			return $this->invalid_filter( __( 'Filter must include a field and operator.', 'cortext' ) );
		}

		if ( ! isset( $field_schema[ $field_key ] ) || ! $field_schema[ $field_key ]['filterable'] ) {
			return new WP_Error(
				'cortext_invalid_filter_field',
				sprintf(
					/* translators: 1: field key, 2: collection ID */
					__( 'Field "%1$s" cannot be used to filter collection %2$d.', 'cortext' ),
					$field_key,
					$collection_id
				),
				array( 'status' => 400 )
			);
		}

		$field = $field_schema[ $field_key ];
		$type  = $field['type'];
		$value = $filter['value'] ?? null;
		if ( ! in_array( $operator, $field['operators'], true ) ) {
			return $this->invalid_filter_operator( $operator, $field_key );
		}
		if ( 'title' === $field_key ) {
			return $this->title_filter_sql( $operator, $value );
		}

		return match ( $type ) {
			'text', 'email', 'url' => $this->text_filter_sql( $field_key, $operator, $value ),
			'number' => $this->number_filter_sql( $field_key, $operator, $value ),
			'date', 'datetime' => $this->date_filter_sql( $field_key, $type, $operator, $value ),
			'select' => $this->select_filter_sql( $field_key, $operator, $value ),
			'multiselect' => $this->multiselect_filter_sql( $field_key, $operator, $value ),
			'checkbox' => $this->checkbox_filter_sql( $field_key, $operator ),
			default => $this->invalid_filter_field_type(),
		};
	}

	private function title_filter_sql( string $operator, mixed $value ): array|WP_Error {
		return match ( $operator ) {
			'is' => $this->title_clause( '=', $this->string_value( $value, $operator ) ),
			'isNot' => $this->title_clause( '!=', $this->string_value( $value, $operator ) ),
			'contains' => $this->title_clause( 'LIKE', $this->string_value( $value, $operator ) ),
			'notContains' => $this->title_clause( 'NOT_CONTAINS', $this->string_value( $value, $operator ) ),
			'startsWith' => $this->title_clause( 'STARTS_WITH', $this->string_value( $value, $operator ) ),
			'endsWith' => $this->title_clause( 'ENDS_WITH', $this->string_value( $value, $operator ) ),
			'isEmpty' => $this->title_clause( '=', '' ),
			'isNotEmpty' => $this->title_clause( '!=', '' ),
			default => $this->invalid_filter_operator( $operator, 'title' ),
		};
	}

	private function text_filter_sql( string $key, string $operator, mixed $value ): array|WP_Error {
		return match ( $operator ) {
			'is' => $this->meta_clause( $key, '=', $this->string_value( $value, $operator ) ),
			'isNot' => $this->meta_clause( $key, 'NOT_EQUALS', $this->string_value( $value, $operator ) ),
			'contains' => $this->meta_clause( $key, 'LIKE', $this->string_value( $value, $operator ) ),
			'notContains' => $this->meta_clause( $key, 'NOT_CONTAINS', $this->string_value( $value, $operator ) ),
			'startsWith' => $this->meta_clause( $key, 'STARTS_WITH', $this->string_value( $value, $operator ) ),
			'endsWith' => $this->meta_clause( $key, 'ENDS_WITH', $this->string_value( $value, $operator ) ),
			'isEmpty' => $this->empty_meta_clause( $key ),
			'isNotEmpty' => $this->meta_clause( $key, '!=', '' ),
			default => $this->invalid_filter_operator( $operator, $key ),
		};
	}

	private function number_filter_sql( string $key, string $operator, mixed $value ): array|WP_Error {
		if ( 'isEmpty' === $operator ) {
			return $this->empty_meta_clause( $key );
		}
		if ( 'between' === $operator ) {
			$range = $this->numeric_range_value( $value, $operator );
			if ( is_wp_error( $range ) ) {
				return $range;
			}
			return $this->meta_clause( $key, 'BETWEEN', $range, 'DECIMAL(20,6)' );
		}

		$number = $this->numeric_value( $value, $operator );
		if ( is_wp_error( $number ) ) {
			return $number;
		}

		return match ( $operator ) {
			'is' => $this->meta_clause( $key, '=', $number, 'DECIMAL(20,6)' ),
			'greaterThan' => $this->meta_clause( $key, '>', $number, 'DECIMAL(20,6)' ),
			'lessThan' => $this->meta_clause( $key, '<', $number, 'DECIMAL(20,6)' ),
			default => $this->invalid_filter_operator( $operator, $key ),
		};
	}

	private function date_filter_sql( string $key, string $type, string $operator, mixed $value ): array|WP_Error {
		if ( 'isEmpty' === $operator ) {
			return $this->empty_meta_clause( $key );
		}
		if ( 'between' === $operator ) {
			$range = $this->date_range_value( $value, $type, $operator );
			if ( is_wp_error( $range ) ) {
				return $range;
			}
			return $this->meta_clause( $key, 'BETWEEN', $range );
		}
		if ( 'on' === $operator || 'is' === $operator ) {
			$day = $this->date_day_value( $value, $operator );
			if ( is_wp_error( $day ) ) {
				return $day;
			}
			return array(
				'relation' => 'OR',
				$this->meta_clause( $key, '=', $day ),
				$this->meta_clause( $key, 'STARTS_WITH', $day ),
			);
		}

		$date = $this->date_compare_value( $value, $type, $operator );
		if ( is_wp_error( $date ) ) {
			return $date;
		}

		return match ( $operator ) {
			'before' => $this->meta_clause( $key, '<', $date ),
			'after' => $this->meta_clause( $key, '>', $date ),
			default => $this->invalid_filter_operator( $operator, $key ),
		};
	}

	private function select_filter_sql( string $key, string $operator, mixed $value ): array|WP_Error {
		return match ( $operator ) {
			'is' => $this->meta_clause( $key, '=', $this->string_value( $value, $operator ) ),
			'isNot' => $this->meta_clause( $key, 'NOT_EQUALS', $this->string_value( $value, $operator ) ),
			'isAny' => $this->meta_clause( $key, 'IN', $this->array_value( $value, $operator ) ),
			'isNone' => $this->meta_clause( $key, 'NONE_IN', $this->array_value( $value, $operator ) ),
			default => $this->invalid_filter_operator( $operator, $key ),
		};
	}

	private function multiselect_filter_sql( string $key, string $operator, mixed $value ): array|WP_Error {
		return match ( $operator ) {
			'contains' => $this->meta_clause( $key, '=', $this->string_value( $value, $operator ) ),
			'notContains' => $this->meta_clause( $key, 'NOT_EQUALS', $this->string_value( $value, $operator ) ),
			'isAny' => $this->meta_clause( $key, 'IN', $this->array_value( $value, $operator ) ),
			'isNone' => $this->meta_clause( $key, 'NONE_IN', $this->array_value( $value, $operator ) ),
			default => $this->invalid_filter_operator( $operator, $key ),
		};
	}

	private function checkbox_filter_sql( string $key, string $operator ): array|WP_Error {
		return match ( $operator ) {
			'isChecked' => $this->meta_clause( $key, '=', '1' ),
			'isUnchecked' => $this->empty_meta_clause( $key ),
			default => $this->invalid_filter_operator( $operator, $key ),
		};
	}

	private function title_clause( string $compare, string|WP_Error $value ): array|WP_Error {
		if ( is_wp_error( $value ) ) {
			return $value;
		}

		return array(
			'key'     => RowsMetaQuery::TITLE_KEY,
			'compare' => $compare,
			'value'   => $value,
		);
	}

	private function meta_clause( string $key, string $compare, mixed $value, string $type = 'CHAR' ): array|WP_Error {
		if ( is_wp_error( $value ) ) {
			return $value;
		}

		return array(
			'key'     => $key,
			'compare' => $compare,
			'value'   => $value,
			'type'    => $type,
		);
	}

	private function empty_meta_clause( string $key ): array {
		return array(
			'relation' => 'OR',
			array(
				'key'     => $key,
				'compare' => 'NOT EXISTS',
			),
			array(
				'key'     => $key,
				'compare' => '=',
				'value'   => '',
			),
		);
	}

	/**
	 * Runs the compiled filter tree through RowsMetaQuery.
	 *
	 * @param array $query WP_Meta_Query-style query tree.
	 * @return array{join:string,where:string}
	 */
	private function meta_query_sql( array $query ): array {
		global $wpdb;

		$meta_query = new RowsMetaQuery( $query );
		$sql        = $meta_query->get_sql( 'post', $wpdb->posts, 'ID' );
		if ( ! is_array( $sql ) ) {
			return $this->empty_sql_clauses();
		}

		return array(
			'join'  => (string) ( $sql['join'] ?? '' ),
			'where' => preg_replace( '/^\s*AND\s+/i', '', (string) ( $sql['where'] ?? '' ) ) ?? '',
		);
	}

	/**
	 * Returns empty SQL clauses.
	 *
	 * @return array{join:string,where:string}
	 */
	private function empty_sql_clauses(): array {
		return array(
			'join'  => '',
			'where' => '',
		);
	}

	private function search_term_sql( string $term, array $text_keys ): string {
		global $wpdb;

		$like  = '%' . $wpdb->esc_like( $term ) . '%';
		$parts = array(
			$wpdb->prepare( "{$wpdb->posts}.post_title LIKE %s", $like ), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		);

		if ( count( $text_keys ) > 0 ) {
			$parts[] = $this->meta_search_sql( $text_keys, $like );
		}

		return '( ' . implode( ' OR ', $parts ) . ' )';
	}

	/**
	 * Builds an `EXISTS` subquery for matching one of the given meta keys on
	 * the current post. Returns an empty string when there are no keys.
	 *
	 * The caller should pass a LIKE pattern that is already wrapped in `%` and
	 * escaped with `esc_like()`.
	 *
	 * @param string[] $keys Meta keys to scan, e.g. row text-like field keys.
	 * @param string   $like Prepared LIKE pattern, e.g. `%foo%`.
	 */
	public function meta_search_sql( array $keys, string $like ): string {
		if ( count( $keys ) === 0 ) {
			return '';
		}

		global $wpdb;

		$placeholders = implode( ', ', array_fill( 0, count( $keys ), '%s' ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$sql = $wpdb->prepare(
			"EXISTS (SELECT 1 FROM {$wpdb->postmeta} AS cortext_search_meta WHERE cortext_search_meta.post_id = {$wpdb->posts}.ID AND cortext_search_meta.meta_key IN ({$placeholders}) AND cortext_search_meta.meta_value LIKE %s)",
			array_merge( $keys, array( $like ) )
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		return $sql;
	}

	private function string_value( mixed $value, string $operator ): string|WP_Error {
		if ( is_array( $value ) || is_object( $value ) || null === $value ) {
			return $this->invalid_filter(
				sprintf(
					/* translators: %s: filter operator */
					__( 'Operator "%s" requires a scalar value.', 'cortext' ),
					$operator
				)
			);
		}
		return (string) $value;
	}

	private function array_value( mixed $value, string $operator ): array|WP_Error {
		$values = is_array( $value ) ? $value : array( $value );
		$values = array_values(
			array_filter(
				array_map(
					static fn( $item ) => is_scalar( $item ) ? (string) $item : '',
					$values
				),
				static fn( $item ) => '' !== $item
			)
		);

		if ( count( $values ) === 0 ) {
			return $this->invalid_filter(
				sprintf(
					/* translators: %s: filter operator */
					__( 'Operator "%s" requires at least one value.', 'cortext' ),
					$operator
				)
			);
		}
		return $values;
	}

	private function numeric_value( mixed $value, string $operator ): float|WP_Error {
		if ( ! is_numeric( $value ) ) {
			return $this->invalid_filter(
				sprintf(
					/* translators: %s: filter operator */
					__( 'Operator "%s" requires a numeric value.', 'cortext' ),
					$operator
				)
			);
		}
		return (float) $value;
	}

	/**
	 * Normalizes a two-number filter range.
	 *
	 * @param mixed  $value    Raw filter value.
	 * @param string $operator Filter operator.
	 * @return array{0:float,1:float}|WP_Error
	 */
	private function numeric_range_value( mixed $value, string $operator ): array|WP_Error {
		if ( ! is_array( $value ) || count( $value ) !== 2 ) {
			return $this->invalid_filter(
				sprintf(
					/* translators: %s: filter operator */
					__( 'Operator "%s" requires exactly two values.', 'cortext' ),
					$operator
				)
			);
		}
		$min = $this->numeric_value( $value[0], $operator );
		$max = $this->numeric_value( $value[1], $operator );
		if ( is_wp_error( $min ) ) {
			return $min;
		}
		if ( is_wp_error( $max ) ) {
			return $max;
		}
		return array( min( $min, $max ), max( $min, $max ) );
	}

	/**
	 * Normalizes a two-date filter range.
	 *
	 * @param mixed  $value    Raw filter value.
	 * @param string $type     Field type.
	 * @param string $operator Filter operator.
	 * @return array{0:string,1:string}|WP_Error
	 */
	private function date_range_value( mixed $value, string $type, string $operator ): array|WP_Error {
		if ( ! is_array( $value ) || count( $value ) !== 2 ) {
			return $this->invalid_filter(
				sprintf(
					/* translators: %s: filter operator */
					__( 'Operator "%s" requires exactly two values.', 'cortext' ),
					$operator
				)
			);
		}
		$start = $this->date_compare_value( $value[0], $type, $operator );
		$end   = $this->date_compare_value( $value[1], $type, $operator );
		if ( is_wp_error( $start ) ) {
			return $start;
		}
		if ( is_wp_error( $end ) ) {
			return $end;
		}
		return $start <= $end ? array( $start, $end ) : array( $end, $start );
	}

	private function date_day_value( mixed $value, string $operator ): string|WP_Error {
		$text = $this->string_value( $value, $operator );
		if ( is_wp_error( $text ) ) {
			return $text;
		}
		if ( preg_match( '/^(\d{4}-\d{2}-\d{2})/', $text, $matches ) ) {
			return $matches[1];
		}
		$timestamp = strtotime( $text );
		if ( false === $timestamp ) {
			return $this->invalid_filter( __( 'Date filter value must be parseable.', 'cortext' ) );
		}
		return gmdate( 'Y-m-d', $timestamp );
	}

	private function date_compare_value( mixed $value, string $type, string $operator ): string|WP_Error {
		$day = $this->date_day_value( $value, $operator );
		if ( is_wp_error( $day ) ) {
			return $day;
		}
		if ( 'date' === $type ) {
			return $day;
		}

		$text = $this->string_value( $value, $operator );
		if ( is_wp_error( $text ) ) {
			return $text;
		}
		$timestamp = strtotime( $text );
		if ( false === $timestamp ) {
			return $this->invalid_filter( __( 'Datetime filter value must be parseable.', 'cortext' ) );
		}
		return gmdate( DATE_RFC3339, $timestamp );
	}

	private function invalid_filter( string $message ): WP_Error {
		return new WP_Error(
			'cortext_invalid_filter',
			$message,
			array( 'status' => 400 )
		);
	}

	private function invalid_filter_operator( string $operator, string $field_key ): WP_Error {
		return new WP_Error(
			'cortext_invalid_filter_operator',
			sprintf(
				/* translators: 1: operator, 2: field key */
				__( 'Operator "%1$s" cannot be used to filter field "%2$s".', 'cortext' ),
				$operator,
				$field_key
			),
			array( 'status' => 400 )
		);
	}

	private function invalid_filter_field_type(): WP_Error {
		return new WP_Error(
			'cortext_invalid_filter_field',
			__( 'Unsupported filter field type.', 'cortext' ),
			array( 'status' => 400 )
		);
	}
}
