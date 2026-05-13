<?php
/**
 * WP_Meta_Query extension for collection row filters.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use WP_Meta_Query;

final class RowsMetaQuery extends WP_Meta_Query {

	public const TITLE_KEY = '__cortext_title';

	private const STARTS_WITH  = 'STARTS_WITH';
	private const ENDS_WITH    = 'ENDS_WITH';
	private const NOT_EQUALS   = 'NOT_EQUALS';
	private const NOT_CONTAINS = 'NOT_CONTAINS';
	private const NONE_IN      = 'NONE_IN';

	/**
	 * Generates SQL for one first-order clause.
	 *
	 * @param array  $clause       Query clause passed by reference.
	 * @param array  $parent_query Parent query array.
	 * @param string $clause_key   Optional clause key.
	 * @return array{join:string[],where:string[]}
	 */
	public function get_sql_for_clause( &$clause, $parent_query, $clause_key = '' ) {
		$compare = strtoupper( trim( (string) ( $clause['compare'] ?? ( isset( $clause['value'] ) && is_array( $clause['value'] ) ? 'IN' : '=' ) ) ) );
		$key     = (string) ( $clause['key'] ?? '' );

		if ( self::TITLE_KEY === $key ) {
			return $this->title_clause_sql( $clause, $compare );
		}

		if ( in_array( $compare, array( self::STARTS_WITH, self::ENDS_WITH ), true ) ) {
			return $this->positive_like_meta_clause_sql( $clause, $compare );
		}

		if ( in_array( $compare, array( self::NOT_EQUALS, self::NOT_CONTAINS, self::NONE_IN ), true ) ) {
			return $this->negative_meta_clause_sql( $clause, $compare );
		}

		return parent::get_sql_for_clause( $clause, $parent_query, $clause_key );
	}

	/**
	 * Builds a post-title SQL clause.
	 *
	 * @param array  $clause Filter clause.
	 * @param string $compare Uppercase compare operator.
	 * @return array{join:string[],where:string[]}
	 */
	private function title_clause_sql( array $clause, string $compare ): array {
		global $wpdb;

		$value  = (string) ( $clause['value'] ?? '' );
		$column = "{$this->primary_table}.post_title";

		if ( '=' === $compare || '!=' === $compare ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$where = $wpdb->prepare( "{$column} {$compare} %s", $value );
			return array(
				'join'  => array(),
				'where' => array( $where ),
			);
		}

		$like = match ( $compare ) {
			self::STARTS_WITH => $wpdb->esc_like( $value ) . '%',
			self::ENDS_WITH => '%' . $wpdb->esc_like( $value ),
			default => '%' . $wpdb->esc_like( $value ) . '%',
		};
		$operator = self::NOT_CONTAINS === $compare ? 'NOT LIKE' : 'LIKE';

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$where = $wpdb->prepare( "{$column} {$operator} %s", $like );
		return array(
			'join'  => array(),
			'where' => array( $where ),
		);
	}

	/**
	 * Builds a one-sided meta LIKE SQL clause.
	 *
	 * @param array  $clause Filter clause.
	 * @param string $compare Uppercase compare operator.
	 * @return array{join:string[],where:string[]}
	 */
	private function positive_like_meta_clause_sql( array $clause, string $compare ): array {
		global $wpdb;

		$key   = (string) ( $clause['key'] ?? '' );
		$value = (string) ( $clause['value'] ?? '' );
		$alias = $this->next_table_alias();
		$like  = self::STARTS_WITH === $compare
			? $wpdb->esc_like( $value ) . '%'
			: '%' . $wpdb->esc_like( $value );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$where = $wpdb->prepare(
			"( {$alias}.meta_key = %s AND {$alias}.meta_value LIKE %s )",
			$key,
			$like
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array(
			'join'  => array( $this->inner_join_for_alias( $alias ) ),
			'where' => array( $where ),
		);
	}

	/**
	 * Builds a negative value SQL clause using NOT EXISTS.
	 *
	 * @param array  $clause Filter clause.
	 * @param string $compare Uppercase compare operator.
	 * @return array{join:string[],where:string[]}
	 */
	private function negative_meta_clause_sql( array $clause, string $compare ): array {
		global $wpdb;

		$key = (string) ( $clause['key'] ?? '' );
		if ( self::NONE_IN === $compare ) {
			$values = is_array( $clause['value'] ?? null ) ? array_values( $clause['value'] ) : array();
			$values = array_map( 'strval', $values );
			if ( count( $values ) === 0 ) {
				return array(
					'join'  => array(),
					'where' => array(),
				);
			}

			$placeholders = implode( ', ', array_fill( 0, count( $values ), '%s' ) );
			$alias        = $this->negative_subquery_alias();
			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
			$where = $wpdb->prepare(
				"NOT EXISTS (SELECT 1 FROM {$this->meta_table} AS {$alias} WHERE {$alias}.{$this->meta_id_column} = {$this->primary_table}.{$this->primary_id_column} AND {$alias}.meta_key = %s AND {$alias}.meta_value IN ({$placeholders}))",
				array_merge( array( $key ), $values )
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

			return array(
				'join'  => array(),
				'where' => array( $where ),
			);
		}

		$value      = (string) ( $clause['value'] ?? '' );
		$operator   = self::NOT_CONTAINS === $compare ? 'LIKE' : '=';
		$sql_value  = self::NOT_CONTAINS === $compare ? '%' . $wpdb->esc_like( $value ) . '%' : $value;
		$alias      = $this->negative_subquery_alias();
		$comparison = "{$alias}.meta_value {$operator} %s";

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$where = $wpdb->prepare(
			"NOT EXISTS (SELECT 1 FROM {$this->meta_table} AS {$alias} WHERE {$alias}.{$this->meta_id_column} = {$this->primary_table}.{$this->primary_id_column} AND {$alias}.meta_key = %s AND {$comparison})",
			$key,
			$sql_value
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		return array(
			'join'  => array(),
			'where' => array( $where ),
		);
	}

	private function next_table_alias(): string {
		$index = count( $this->table_aliases );
		$alias = $index ? 'mt' . $index : $this->meta_table;

		$this->table_aliases[] = $alias;
		return $alias;
	}

	private function inner_join_for_alias( string $alias ): string {
		$join  = " INNER JOIN {$this->meta_table}";
		$join .= $alias === $this->meta_table ? '' : " AS {$alias}";
		$join .= " ON ( {$this->primary_table}.{$this->primary_id_column} = {$alias}.{$this->meta_id_column} )";

		return $join;
	}

	private function negative_subquery_alias(): string {
		return 'cortext_meta_not_' . count( $this->table_aliases );
	}
}
