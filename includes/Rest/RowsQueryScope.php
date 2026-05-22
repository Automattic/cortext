<?php
/**
 * Scoped WP_Query runner for the rows endpoint.
 *
 * Wires the filter/search/sort SQL fragments produced by
 * `RowsFilterQuery` into a single `WP_Query` execution and tears the
 * hooks back down when the query finishes. Callers see a `run()`
 * method instead of token-guarded callbacks and magic query vars.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use WP_Query;

final class RowsQueryScope {

	private const TOKEN_QUERY_VAR = 'cortext_rows_query_token';

	private string $token;
	private string $where_sql;
	private string $join_sql;
	private mixed $sort;
	private string $search;
	private array $field_schema;
	private RowsFilterQuery $row_query;

	public function __construct(
		RowsFilterQuery $row_query,
		array $field_schema,
		string $where_sql,
		string $join_sql,
		mixed $sort,
		string $search = ''
	) {
		$this->row_query    = $row_query;
		$this->field_schema = $field_schema;
		$this->where_sql    = $where_sql;
		$this->join_sql     = $join_sql;
		$this->sort         = $sort;
		$this->search       = $search;
		$this->token        = uniqid( 'cortext_rows_', true );
	}

	/**
	 * Runs WP_Query with the scope's SQL fragments installed for the
	 * duration of the query. The fragments come off the filter chain
	 * before the method returns, even on exception.
	 *
	 * @param array $query_args Base WP_Query arguments.
	 * @return WP_Query
	 */
	public function run( array $query_args ): WP_Query {
		$query_args[ self::TOKEN_QUERY_VAR ] = $this->token;

		$where_callback   = function ( string $where, WP_Query $query ): string {
			if ( ! $this->owns( $query ) ) {
				return $where;
			}
			return '' === $this->where_sql ? $where : "{$where} AND {$this->where_sql}";
		};
		$clauses_callback = function ( array $clauses, WP_Query $query ): array {
			if ( ! $this->owns( $query ) ) {
				return $clauses;
			}
			$clauses = $this->row_query->apply_filter_join_clauses( $clauses, $this->join_sql );
			$clauses = $this->row_query->apply_sort_clauses( $clauses, $this->sort, $this->field_schema );
			return $this->row_query->apply_search_order_clauses( $clauses, $this->sort, $this->search );
		};

		add_filter( 'posts_where', $where_callback, 10, 2 );
		add_filter( 'posts_clauses', $clauses_callback, 10, 2 );
		try {
			return new WP_Query( $query_args );
		} finally {
			remove_filter( 'posts_where', $where_callback, 10 );
			remove_filter( 'posts_clauses', $clauses_callback, 10 );
		}
	}

	private function owns( WP_Query $query ): bool {
		return $query->get( self::TOKEN_QUERY_VAR ) === $this->token;
	}
}
