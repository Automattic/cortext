<?php
/**
 * Tests for Cortext\Rest\RowsMetaQuery.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Rest\RowsMetaQuery;
use WorDBless\BaseTestCase;

final class Test_Rest_Rows_Meta_Query extends BaseTestCase {

	public function test_custom_like_compares_do_not_auto_wrap_both_sides(): void {
		$starts = $this->sql_for(
			array(
				array(
					'key'     => 'field-1',
					'compare' => 'STARTS_WITH',
					'value'   => 'alpha',
				),
			)
		);
		$ends   = $this->sql_for(
			array(
				array(
					'key'     => 'field-1',
					'compare' => 'ENDS_WITH',
					'value'   => 'omega',
				),
			)
		);

		$this->assertStringContainsString( "meta_value LIKE 'alpha%'", $starts['where'] );
		$this->assertStringContainsString( "meta_value LIKE '%omega'", $ends['where'] );
	}

	public function test_negative_custom_compares_use_not_exists_subqueries(): void {
		$not_contains = $this->sql_for(
			array(
				array(
					'key'     => 'field-1',
					'compare' => 'NOT_CONTAINS',
					'value'   => 'needle',
				),
			)
		);
		$none_in      = $this->sql_for(
			array(
				array(
					'key'     => 'field-1',
					'compare' => 'NONE_IN',
					'value'   => array( 'alpha', 'beta' ),
				),
			)
		);

		$this->assertSame( '', $not_contains['join'] );
		$this->assertStringContainsString( 'NOT EXISTS', $not_contains['where'] );
		$this->assertStringContainsString( "meta_value LIKE '%needle%'", $not_contains['where'] );
		$this->assertStringContainsString( 'NOT EXISTS', $none_in['where'] );
		$this->assertStringContainsString( "meta_value IN ('alpha', 'beta')", $none_in['where'] );
	}

	public function test_title_clause_composes_inside_or_group(): void {
		$sql = $this->sql_for(
			array(
				'relation' => 'OR',
				array(
					'key'     => RowsMetaQuery::TITLE_KEY,
					'compare' => 'STARTS_WITH',
					'value'   => 'Alpha',
				),
				array(
					'key'     => 'field-1',
					'compare' => '=',
					'value'   => 'blue',
				),
			)
		);

		$this->assertStringContainsString( 'post_title LIKE', $sql['where'] );
		$this->assertStringContainsString( ' OR ', $sql['where'] );
		$this->assertStringContainsString( 'INNER JOIN', $sql['join'] );
	}

	/**
	 * Compiles one RowsMetaQuery tree.
	 *
	 * @param array $query WP_Meta_Query-style query.
	 * @return array{join:string,where:string}
	 */
	private function sql_for( array $query ): array {
		global $wpdb;

		$meta_query = new RowsMetaQuery( $query );
		$sql        = $meta_query->get_sql( 'post', $wpdb->posts, 'ID' );

		$this->assertIsArray( $sql );
		return array(
			'join'  => (string) $sql['join'],
			'where' => $wpdb->remove_placeholder_escape( (string) $sql['where'] ),
		);
	}
}
