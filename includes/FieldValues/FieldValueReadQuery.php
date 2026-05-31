<?php
/**
 * Reads from the derived field-value index.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\FieldValues;

use Cortext\PostType\Document;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Post;

final class FieldValueReadQuery {

	private const TEXT_INDEX_LENGTH = 191;
	private const ACTIVE_STATUSES   = array( 'draft', 'private', 'publish' );

	private FieldValueIndex $index;

	public function __construct( ?FieldValueIndex $index = null ) {
		$this->index = $index ?? new FieldValueIndex();
	}

	/**
	 * Returns whether the field-value index can answer this request shape.
	 *
	 * This checks shape only. query_rows() still checks that the index is ready
	 * before it reads.
	 *
	 * @param array  $field_schema Field schema from RowsFilterQuery::field_schema_for().
	 * @param mixed  $filters      Raw REST filters parameter.
	 * @param mixed  $sort         Raw REST sort parameter.
	 * @param string $search       Raw REST search parameter.
	 * @param bool   $has_include  Whether the request includes include[].
	 */
	public function supports_query( array $field_schema, mixed $filters, mixed $sort, string $search = '', bool $has_include = false ): bool {
		return null !== $this->build_plan(
			1,
			0,
			$field_schema,
			$filters,
			$sort,
			$search,
			$has_include,
			self::ACTIVE_STATUSES
		);
	}

	/**
	 * Reads row IDs from the field-value index and hydrates posts in that order.
	 *
	 * Returns null when the index is unavailable, or when the request needs the
	 * postmeta path to keep the existing behaviour.
	 *
	 * @param int    $collection_id Collection (trait) post ID.
	 * @param array  $field_schema  Field schema from RowsFilterQuery::field_schema_for().
	 * @param mixed  $filters       Raw REST filters parameter.
	 * @param mixed  $sort          Raw REST sort parameter.
	 * @param string $search       Raw REST search parameter.
	 * @param bool   $has_include   Whether the request includes include[].
	 * @param int    $page          One-based page number.
	 * @param int    $per_page      Rows per page.
	 * @param array  $post_statuses Row post statuses visible to this request.
	 * @return array{posts:WP_Post[],total:int,totalPages:int}|null
	 */
	public function query_rows(
		int $collection_id,
		array $field_schema,
		mixed $filters,
		mixed $sort,
		string $search,
		bool $has_include,
		int $page,
		int $per_page,
		?array $post_statuses = null
	): ?array {
		if ( ! $this->index->can_read() ) {
			return null;
		}

		$trait_term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $trait_term_id < 1 ) {
			return null;
		}

		$plan = $this->build_plan(
			$collection_id,
			$trait_term_id,
			$field_schema,
			$filters,
			$sort,
			$search,
			$has_include,
			$this->visible_post_statuses( $post_statuses )
		);
		if ( null === $plan ) {
			return null;
		}

		$this->index->flush_pending_sync();
		return $this->run_plan( $plan, $page, $per_page );
	}

	private function build_plan(
		int $collection_id,
		int $trait_term_id,
		array $field_schema,
		mixed $filters,
		mixed $sort,
		string $search,
		bool $has_include,
		array $post_statuses
	): ?array {
		if ( $has_include || '' !== trim( $search ) ) {
			return null;
		}

		global $wpdb;

		$where = array(
			$wpdb->prepare( 'p.post_type = %s', Document::POST_TYPE ),
			$this->post_status_sql( 'p', $post_statuses ),
		);
		$joins = array();

		if ( $trait_term_id > 0 ) {
			$joins[] = "INNER JOIN {$wpdb->term_relationships} AS tr_doc ON tr_doc.object_id = p.ID";
			$joins[] = "INNER JOIN {$wpdb->term_taxonomy} AS tt_doc ON tt_doc.term_taxonomy_id = tr_doc.term_taxonomy_id";
			$where[] = $wpdb->prepare( 'tt_doc.taxonomy = %s', TraitTaxonomy::TAXONOMY );
			$where[] = $wpdb->prepare( 'tt_doc.term_id = %d', $trait_term_id );
		}

		$plan = array(
			'from'       => "{$wpdb->posts} AS p",
			'where'      => $where,
			'joins'      => $joins,
			'orderby'    => $this->manual_orderby( $trait_term_id ),
			'post_type'  => Document::POST_TYPE,
			'statuses'   => $post_statuses,
			'uses_index' => false,
		);

		$alias_counter = 0;
		if ( ! $this->append_filters( $plan, $filters, $field_schema, $collection_id, $alias_counter, $post_statuses ) ) {
			return null;
		}
		if ( ! $this->append_sort( $plan, $sort, $field_schema, $collection_id, $alias_counter, $post_statuses ) ) {
			return null;
		}

		return $plan['uses_index'] ? $plan : null;
	}

	private function append_filters( array &$plan, mixed $filters, array $field_schema, int $collection_id, int &$alias_counter, array $post_statuses ): bool {
		if ( ! is_array( $filters ) || count( $filters ) === 0 ) {
			return true;
		}

		$nodes = $this->is_filter_node( $filters ) ? array( $filters ) : array_values( $filters );
		foreach ( $nodes as $node ) {
			if ( ! $this->append_filter_node( $plan, $node, $field_schema, $collection_id, $alias_counter, $post_statuses ) ) {
				return false;
			}
		}
		return true;
	}

	private function append_filter_node( array &$plan, mixed $node, array $field_schema, int $collection_id, int &$alias_counter, array $post_statuses ): bool {
		if ( ! is_array( $node ) ) {
			return false;
		}

		$is_group = isset( $node['relation'] ) || isset( $node['filters'] );
		$is_leaf  = isset( $node['field'] ) || isset( $node['operator'] );
		if ( $is_group && $is_leaf ) {
			return false;
		}

		if ( $is_group ) {
			$relation = strtoupper( (string) ( $node['relation'] ?? 'AND' ) );
			if ( 'AND' !== $relation || ! isset( $node['filters'] ) || ! is_array( $node['filters'] ) ) {
				return false;
			}
			foreach ( $node['filters'] as $child ) {
				if ( ! $this->append_filter_node( $plan, $child, $field_schema, $collection_id, $alias_counter, $post_statuses ) ) {
					return false;
				}
			}
			return true;
		}

		if ( ! $is_leaf ) {
			return false;
		}
		return $this->append_filter_leaf( $plan, $node, $field_schema, $collection_id, $alias_counter, $post_statuses );
	}

	private function is_filter_node( array $value ): bool {
		return isset( $value['field'] ) || isset( $value['operator'] ) || isset( $value['relation'] ) || isset( $value['filters'] );
	}

	private function append_filter_leaf( array &$plan, array $filter, array $field_schema, int $collection_id, int &$alias_counter, array $post_statuses ): bool {
		$field_key = isset( $filter['field'] ) ? (string) $filter['field'] : '';
		$operator  = isset( $filter['operator'] ) ? (string) $filter['operator'] : '';
		if ( '' === $field_key || '' === $operator || ! isset( $field_schema[ $field_key ] ) ) {
			return false;
		}

		$field = $field_schema[ $field_key ];
		if ( empty( $field['filterable'] ) ) {
			return false;
		}

		if ( 'title' === $field_key ) {
			$where = $this->title_filter_where( $operator, $filter['value'] ?? null );
			if ( null === $where ) {
				return false;
			}
			$plan['where'][] = $where;
			return true;
		}

		if ( ! str_starts_with( $field_key, 'field-' ) ) {
			return false;
		}

		$join = $this->field_filter_join( $field, $operator, $filter['value'] ?? null, $collection_id, ++$alias_counter, $post_statuses );
		if ( null === $join ) {
			return false;
		}

		$plan['joins'][]    = $join;
		$plan['uses_index'] = true;
		return true;
	}

	private function title_filter_where( string $operator, mixed $value ): ?string {
		global $wpdb;

		if ( in_array( $operator, array( 'isEmpty', 'isNotEmpty' ), true ) ) {
			return 'isEmpty' === $operator ? "p.post_title = ''" : "p.post_title != ''";
		}

		$string = $this->string_value( $value );
		if ( null === $string ) {
			return null;
		}

		return match ( $operator ) {
			'is' => $wpdb->prepare( 'p.post_title = %s', $string ),
			'isNot' => $wpdb->prepare( 'p.post_title != %s', $string ),
			'contains' => $wpdb->prepare( 'p.post_title LIKE %s', '%' . $wpdb->esc_like( $string ) . '%' ),
			'notContains' => $wpdb->prepare( 'p.post_title NOT LIKE %s', '%' . $wpdb->esc_like( $string ) . '%' ),
			'startsWith' => $wpdb->prepare( 'p.post_title LIKE %s', $wpdb->esc_like( $string ) . '%' ),
			'endsWith' => $wpdb->prepare( 'p.post_title LIKE %s', '%' . $wpdb->esc_like( $string ) ),
			default => null,
		};
	}

	private function field_filter_join( array $field, string $operator, mixed $value, int $collection_id, int $index, array $post_statuses ): ?string {
		$type     = (string) ( $field['type'] ?? '' );
		$field_id = $this->field_id_from_schema( $field );
		if ( $field_id <= 0 ) {
			return null;
		}

		$predicate = match ( $type ) {
			'text', 'email', 'url' => $this->text_filter_predicate( $operator, $value ),
			'number' => $this->number_filter_predicate( $operator, $value ),
			'date', 'datetime' => $this->date_filter_predicate( $type, $operator, $value ),
			'select' => $this->select_filter_predicate( $operator, $value ),
			'multiselect' => $this->multiselect_filter_predicate( $operator, $value ),
			'checkbox' => $this->checkbox_filter_predicate( $operator ),
			default => null,
		};
		if ( null === $predicate ) {
			return null;
		}

		global $wpdb;

		$table         = $this->index->table_name();
		$alias         = 'fvf_' . $index;
		$predicate_sql = str_replace( 'fvf_PLACEHOLDER', $alias, $predicate['sql'] );
		$args          = array_merge( array( $collection_id, $field_id ), $predicate['args'] );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		return $wpdb->prepare(
			" INNER JOIN {$table} AS {$alias}
				ON ({$alias}.row_id = p.ID
				AND {$alias}.collection_id = %d
				AND {$alias}.field_id = %d
				AND {$this->post_status_sql( $alias, $post_statuses )}
				AND {$predicate_sql})",
			...$args
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
	}

	private function text_filter_predicate( string $operator, mixed $value ): ?array {
		if ( 'isNotEmpty' === $operator ) {
			return array(
				'sql'  => 'fvf_PLACEHOLDER.value_text != \'\'',
				'args' => array(),
			);
		}

		$string = $this->indexed_string_value( $value );
		if ( null === $string ) {
			return null;
		}

		return match ( $operator ) {
			'is' => $this->text_exact_predicate( $string ),
			'startsWith' => array(
				'sql'  => 'fvf_PLACEHOLDER.value_text LIKE %s',
				'args' => array( $this->like_prefix( $string ) ),
			),
			default => null,
		};
	}

	private function number_filter_predicate( string $operator, mixed $value ): ?array {
		if ( 'between' === $operator ) {
			$range = $this->number_range( $value );
			if ( null === $range ) {
				return null;
			}
			return array(
				'sql'  => 'fvf_PLACEHOLDER.value_number BETWEEN %f AND %f',
				'args' => $range,
			);
		}

		$number = $this->number_value( $value );
		if ( null === $number ) {
			return null;
		}

		return match ( $operator ) {
			'is' => array(
				'sql'  => 'fvf_PLACEHOLDER.value_number = %f',
				'args' => array( $number ),
			),
			'greaterThan' => array(
				'sql'  => 'fvf_PLACEHOLDER.value_number > %f',
				'args' => array( $number ),
			),
			'lessThan' => array(
				'sql'  => 'fvf_PLACEHOLDER.value_number < %f',
				'args' => array( $number ),
			),
			default => null,
		};
	}

	private function date_filter_predicate( string $type, string $operator, mixed $value ): ?array {
		if ( in_array( $operator, array( 'is', 'on' ), true ) ) {
			$range = $this->date_day_range( $value );
			if ( null === $range ) {
				return null;
			}
			return array(
				'sql'  => 'fvf_PLACEHOLDER.value_date >= %s AND fvf_PLACEHOLDER.value_date < %s',
				'args' => $range,
			);
		}

		if ( 'between' === $operator ) {
			$range = $this->date_range( $value, $type );
			if ( null === $range ) {
				return null;
			}
			return array(
				'sql'  => 'fvf_PLACEHOLDER.value_date BETWEEN %s AND %s',
				'args' => $range,
			);
		}

		$date = $this->date_value( $value, $type );
		if ( null === $date ) {
			return null;
		}

		return match ( $operator ) {
			'before' => array(
				'sql'  => 'fvf_PLACEHOLDER.value_date < %s',
				'args' => array( $date ),
			),
			'after' => array(
				'sql'  => 'fvf_PLACEHOLDER.value_date > %s',
				'args' => array( $date ),
			),
			default => null,
		};
	}

	private function select_filter_predicate( string $operator, mixed $value ): ?array {
		if ( 'is' === $operator ) {
			return $this->text_exact_predicate( $value );
		}

		if ( 'isAny' === $operator ) {
			return $this->text_in_predicate( $value );
		}

		return null;
	}

	private function multiselect_filter_predicate( string $operator, mixed $value ): ?array {
		if ( 'contains' === $operator ) {
			return $this->text_exact_predicate( $value );
		}

		if ( 'isAny' === $operator ) {
			return $this->text_in_predicate( $value );
		}

		return null;
	}

	private function checkbox_filter_predicate( string $operator ): ?array {
		if ( 'isChecked' !== $operator ) {
			return null;
		}

		return array(
			'sql'  => 'fvf_PLACEHOLDER.value_number = 1',
			'args' => array(),
		);
	}

	private function text_in_predicate( mixed $value ): ?array {
		$values = $this->indexed_string_values( $value );
		if ( null === $values || count( $values ) === 0 ) {
			return null;
		}

		$parts = array();
		$args  = array();
		foreach ( $values as $string ) {
			$parts[] = '(fvf_PLACEHOLDER.value_text = %s AND fvf_PLACEHOLDER.value_text_length <= %d)';
			$args[]  = $string;
			$args[]  = self::TEXT_INDEX_LENGTH;
		}

		return array(
			'sql'  => '(' . implode( ' OR ', $parts ) . ')',
			'args' => $args,
		);
	}

	private function text_exact_predicate( mixed $value ): ?array {
		$string = $this->indexed_string_value( $value );
		if ( null === $string ) {
			return null;
		}

		return array(
			'sql'  => 'fvf_PLACEHOLDER.value_text = %s AND fvf_PLACEHOLDER.value_text_length <= %d',
			'args' => array( $string, self::TEXT_INDEX_LENGTH ),
		);
	}

	private function append_sort( array &$plan, mixed $sort, array $field_schema, int $collection_id, int &$alias_counter, array $post_statuses ): bool {
		$trait_term_id = Relations::trait_term_id_for_collection( $collection_id );

		if ( ! is_array( $sort ) || empty( $sort['field'] ) ) {
			$plan['orderby'] = $this->manual_orderby( $trait_term_id );
			return true;
		}

		$field_key = (string) $sort['field'];
		$direction = ( $sort['direction'] ?? 'asc' ) === 'desc' ? 'DESC' : 'ASC';

		if ( 'title' === $field_key ) {
			$plan['orderby'] = "p.post_title {$direction}, p.ID ASC";
			return true;
		}
		if ( 'manual' === $field_key ) {
			$plan['orderby'] = $this->manual_orderby( $trait_term_id );
			return true;
		}
		if ( 'created_at' === $field_key ) {
			$plan['orderby'] = "p.post_date {$direction}, p.ID ASC";
			return true;
		}
		if ( 'modified_at' === $field_key ) {
			$plan['orderby'] = "p.post_modified {$direction}, p.ID ASC";
			return true;
		}

		if ( ! isset( $field_schema[ $field_key ] ) || ! str_starts_with( $field_key, 'field-' ) ) {
			return false;
		}

		$field = $field_schema[ $field_key ];
		$type  = (string) ( $field['type'] ?? '' );
		if ( empty( $field['sortable'] ) ) {
			return false;
		}
		if ( ! in_array( $type, array( 'number', 'date', 'datetime', 'checkbox', 'select' ), true ) ) {
			return false;
		}

		$field_id = $this->field_id_from_schema( $field );
		if ( $field_id <= 0 ) {
			return false;
		}

		global $wpdb;

		$table = $this->index->table_name();
		$alias = 'fv_sort_' . ( ++$alias_counter );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$plan['joins'][] = $wpdb->prepare(
			" LEFT JOIN {$table} AS {$alias}
				ON ({$alias}.row_id = p.ID
				AND {$alias}.collection_id = %d
				AND {$alias}.field_id = %d
				AND {$this->post_status_sql( $alias, $post_statuses )})",
			$collection_id,
			$field_id
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		if ( 'checkbox' === $type ) {
			$plan['orderby'] = "CASE WHEN {$alias}.value_number = 1 THEN 1 ELSE 0 END {$direction}, p.ID ASC";
		} elseif ( 'number' === $type ) {
			$plan['orderby'] = "CASE WHEN {$alias}.row_id IS NULL OR {$alias}.value_number IS NULL THEN 1 ELSE 0 END ASC, {$alias}.value_number {$direction}, p.ID ASC";
		} elseif ( 'select' === $type ) {
			$plan['orderby'] = "CASE WHEN {$alias}.row_id IS NULL OR {$alias}.value_text = '' THEN 1 ELSE 0 END ASC, {$alias}.value_text {$direction}, p.ID ASC";
		} else {
			$plan['orderby'] = "CASE WHEN {$alias}.row_id IS NULL OR {$alias}.value_date IS NULL THEN 1 ELSE 0 END ASC, {$alias}.value_date {$direction}, p.ID ASC";
		}

		$plan['uses_index'] = true;
		return true;
	}

	/**
	 * Manual order expression. A row's position is per collection, stored in the
	 * `term_order` of its `crtxt_trait` relationship; `tr_doc` is the membership
	 * join `build_plan` already adds for the collection's term, so its
	 * `term_order` is this collection's order. Falls back to ID order when there
	 * is no collection term scope (no `tr_doc` join in the plan).
	 *
	 * @param int $trait_term_id Collection mirror term id, or 0 when unscoped.
	 */
	private function manual_orderby( int $trait_term_id ): string {
		return $trait_term_id > 0
			? 'tr_doc.term_order ASC, p.ID ASC'
			: 'p.ID ASC';
	}

	private function run_plan( array $plan, int $page, int $per_page ): ?array {
		global $wpdb;

		$page     = max( 1, $page );
		$per_page = max( 1, $per_page );
		$where    = implode( ' AND ', $plan['where'] );
		$joins    = implode( ' ', $plan['joins'] );
		$from     = $plan['from'];

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$count_sql = "SELECT COUNT(DISTINCT p.ID) FROM {$from} {$joins} WHERE {$where}";
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- Reads from the field-value index by design.
		$total = $wpdb->get_var( $count_sql );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( null === $total && '' !== $wpdb->last_error ) {
			return null;
		}

		$total = (int) $total;
		if ( 0 === $total ) {
			return array(
				'posts'      => array(),
				'total'      => 0,
				'totalPages' => 0,
			);
		}

		$offset = ( $page - 1 ) * $per_page;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$id_sql = $wpdb->prepare(
			"SELECT DISTINCT p.ID FROM {$from} {$joins} WHERE {$where} ORDER BY {$plan['orderby']} LIMIT %d OFFSET %d",
			$per_page,
			$offset
		);
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- Reads from the field-value index by design.
		$ids = $wpdb->get_col( $id_sql );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( ! is_array( $ids ) && '' !== $wpdb->last_error ) {
			return null;
		}

		$ids = array_map( 'intval', (array) $ids );
		if ( count( $ids ) === 0 ) {
			return array(
				'posts'      => array(),
				'total'      => $total,
				'totalPages' => (int) ceil( $total / $per_page ),
			);
		}

		$posts = get_posts(
			array(
				'post_type'        => $plan['post_type'],
				'post_status'      => $plan['statuses'],
				'post__in'         => $ids,
				'orderby'          => 'post__in',
				'posts_per_page'   => count( $ids ),
				'suppress_filters' => true,
			)
		);

		return array(
			'posts'      => array_values(
				array_filter(
					$posts,
					static fn( $post ): bool => $post instanceof WP_Post
				)
			),
			'total'      => $total,
			'totalPages' => (int) ceil( $total / $per_page ),
		);
	}

	private function visible_post_statuses( ?array $post_statuses ): array {
		if ( null === $post_statuses ) {
			return self::ACTIVE_STATUSES;
		}

		$allowed = array_values(
			array_intersect(
				self::ACTIVE_STATUSES,
				array_map( 'strval', $post_statuses )
			)
		);
		return count( $allowed ) > 0 ? $allowed : self::ACTIVE_STATUSES;
	}

	private function post_status_sql( string $alias, array $post_statuses ): string {
		global $wpdb;

		$placeholders = implode(
			', ',
			array_fill( 0, count( $post_statuses ), '%s' )
		);

		return $wpdb->prepare(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
			"{$alias}.post_status IN ({$placeholders})",
			...$post_statuses
		);
	}

	private function field_id_from_schema( array $field ): int {
		if ( isset( $field['id'] ) ) {
			return (int) $field['id'];
		}
		return 0;
	}

	private function string_value( mixed $value ): ?string {
		if ( null === $value || is_array( $value ) || is_object( $value ) ) {
			return null;
		}
		return (string) $value;
	}

	private function indexed_string_value( mixed $value ): ?string {
		$string = $this->string_value( $value );
		if ( null === $string || '' === $string || strlen( $string ) > self::TEXT_INDEX_LENGTH ) {
			return null;
		}
		return $string;
	}

	private function indexed_string_values( mixed $value ): ?array {
		$raw_values = is_array( $value ) ? $value : array( $value );
		$values     = array();
		foreach ( $raw_values as $item ) {
			$raw_string = $this->string_value( $item );
			if ( null !== $raw_string && strlen( $raw_string ) > self::TEXT_INDEX_LENGTH ) {
				return null;
			}

			$string = $this->indexed_string_value( $item );
			if ( null === $string || '' === $string ) {
				continue;
			}
			$values[] = $string;
		}
		return array_values( array_unique( $values ) );
	}

	private function number_value( mixed $value ): ?float {
		return is_numeric( $value ) ? (float) $value : null;
	}

	private function number_range( mixed $value ): ?array {
		if ( ! is_array( $value ) || count( $value ) !== 2 ) {
			return null;
		}
		$min = $this->number_value( $value[0] );
		$max = $this->number_value( $value[1] );
		if ( null === $min || null === $max ) {
			return null;
		}
		return array( min( $min, $max ), max( $min, $max ) );
	}

	private function date_value( mixed $value, string $type ): ?string {
		$text = $this->string_value( $value );
		if ( null === $text ) {
			return null;
		}
		$timestamp = strtotime( $text );
		if ( false === $timestamp ) {
			return null;
		}
		return 'date' === $type
			? gmdate( 'Y-m-d 00:00:00', $timestamp )
			: gmdate( 'Y-m-d H:i:s', $timestamp );
	}

	private function date_range( mixed $value, string $type ): ?array {
		if ( ! is_array( $value ) || count( $value ) !== 2 ) {
			return null;
		}
		$start = $this->date_value( $value[0], $type );
		$end   = $this->date_value( $value[1], $type );
		if ( null === $start || null === $end ) {
			return null;
		}
		return $start <= $end ? array( $start, $end ) : array( $end, $start );
	}

	private function date_day_range( mixed $value ): ?array {
		$text = $this->string_value( $value );
		if ( null === $text ) {
			return null;
		}
		if ( preg_match( '/^(\d{4}-\d{2}-\d{2})/', $text, $matches ) ) {
			$day = $matches[1];
		} else {
			$timestamp = strtotime( $text );
			if ( false === $timestamp ) {
				return null;
			}
			$day = gmdate( 'Y-m-d', $timestamp );
		}

		$start_timestamp = strtotime( $day . ' 00:00:00 UTC' );
		if ( false === $start_timestamp ) {
			return null;
		}

		return array(
			gmdate( 'Y-m-d H:i:s', $start_timestamp ),
			gmdate( 'Y-m-d H:i:s', $start_timestamp + DAY_IN_SECONDS ),
		);
	}

	private function like_prefix( string $value ): string {
		global $wpdb;
		return $wpdb->esc_like( $value ) . '%';
	}
}
