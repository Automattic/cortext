<?php
/**
 * Tests for Cortext\Rest\RowsFilterQuery.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Fields\FieldTypeRegistry;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\Rest\RowsFilterQuery;
use WorDBless\BaseTestCase;

final class Test_Rest_Rows_Filter_Query extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();
	}

	public function test_field_schema_caches_collection_fields(): void {
		$collection_id = $this->create_collection_with_slug( 'Cache', 'rows-cache' );
		$field_id      = $this->create_collection_field( $collection_id, 'Label', 'text' );
		$query         = new RowsFilterQuery();

		$first = $query->field_schema_for( $collection_id );
		update_post_meta( $field_id, 'type', 'number' );
		$second = $query->field_schema_for( $collection_id );

		$this->assertSame( 'text', $first[ "field-{$field_id}" ]['type'] );
		$this->assertSame( 'text', $second[ "field-{$field_id}" ]['type'] );
	}

	public function test_compiles_supported_operators_by_field_type(): void {
		$collection_id = $this->create_collection_with_slug( 'Operators', 'rows-operators' );
		$field_ids     = array(
			'text'        => $this->create_collection_field( $collection_id, 'Text', 'text' ),
			'email'       => $this->create_collection_field( $collection_id, 'Email', 'email' ),
			'url'         => $this->create_collection_field( $collection_id, 'URL', 'url' ),
			'number'      => $this->create_collection_field( $collection_id, 'Number', 'number' ),
			'date'        => $this->create_collection_field( $collection_id, 'Date', 'date' ),
			'datetime'    => $this->create_collection_field( $collection_id, 'Datetime', 'datetime' ),
			'select'      => $this->create_collection_field( $collection_id, 'Select', 'select' ),
			'multiselect' => $this->create_collection_field( $collection_id, 'Multi', 'multiselect' ),
			'checkbox'    => $this->create_collection_field( $collection_id, 'Done', 'checkbox' ),
		);
		$query         = new RowsFilterQuery();
		$field_schema  = $query->field_schema_for( $collection_id );

		$cases = array( array( 'title', 'text', 'title' ) );
		foreach ( $field_ids as $type => $field_id ) {
			$cases[] = array( "field-{$field_id}", $type, "field-{$field_id}" );
		}

		foreach ( $cases as $case ) {
			list( $field_key, $type, $label ) = $case;
			foreach ( FieldTypeRegistry::operators_for( $type ) as $operator ) {
				$result = $query->compile_filters(
					array(
						array(
							'field'    => $field_key,
							'operator' => $operator,
							'value'    => $this->value_for_operator( $type, $operator ),
						),
					),
					$field_schema,
					$collection_id
				);
				$this->assertFalse( is_wp_error( $result ), "{$label} {$operator} should compile." );
				$this->assertIsArray( $result );
				$this->assertNotSame( '', $result['where'] );
			}
		}
	}

	public function test_rejects_unsupported_filter_operator(): void {
		$collection_id = $this->create_collection_with_slug( 'Bad op', 'rows-bad-op' );
		$field_id      = $this->create_collection_field( $collection_id, 'Number', 'number' );
		$query         = new RowsFilterQuery();

		$result = $query->compile_filters(
			array(
				array(
					'field'    => "field-{$field_id}",
					'operator' => 'contains',
					'value'    => '10',
				),
			),
			$query->field_schema_for( $collection_id ),
			$collection_id
		);

		$this->assertTrue( is_wp_error( $result ) );
		$this->assertSame( 'cortext_invalid_filter_operator', $result->get_error_code() );
	}

	public function test_empty_and_not_empty_compile_expected_meta_sql(): void {
		$collection_id = $this->create_collection_with_slug( 'Empty', 'rows-empty' );
		$field_id      = $this->create_collection_field( $collection_id, 'Text', 'text' );
		$query         = new RowsFilterQuery();
		$field_schema  = $query->field_schema_for( $collection_id );
		$field_key     = "field-{$field_id}";

		$empty = $query->compile_filters(
			array(
				array(
					'field'    => $field_key,
					'operator' => 'isEmpty',
				),
			),
			$field_schema,
			$collection_id
		);
		$this->assertFalse( is_wp_error( $empty ) );
		$this->assertStringContainsString( 'LEFT JOIN', $empty['join'] );
		$this->assertStringContainsString( 'IS NULL', $empty['where'] );
		$this->assertStringContainsString( "meta_value = ''", $empty['where'] );

		$not_empty = $query->compile_filters(
			array(
				array(
					'field'    => $field_key,
					'operator' => 'isNotEmpty',
				),
			),
			$field_schema,
			$collection_id
		);
		$this->assertFalse( is_wp_error( $not_empty ) );
		$this->assertStringContainsString( "meta_value != ''", $not_empty['where'] );
	}

	public function test_title_filter_compiles_against_post_title(): void {
		$collection_id = $this->create_collection_with_slug( 'Title', 'rows-title-filter' );
		$query         = new RowsFilterQuery();

		$result = $query->compile_filters(
			array(
				array(
					'field'    => 'title',
					'operator' => 'startsWith',
					'value'    => 'Alpha',
				),
			),
			$query->field_schema_for( $collection_id ),
			$collection_id
		);

		$this->assertFalse( is_wp_error( $result ) );
		$this->assertStringContainsString( 'post_title LIKE', $result['where'] );
	}

	public function test_title_filter_compiles_inside_or_group(): void {
		$collection_id = $this->create_collection_with_slug( 'Title OR', 'rows-title-or' );
		$field_id      = $this->create_collection_field( $collection_id, 'Text', 'text' );
		$query         = new RowsFilterQuery();

		$result = $query->compile_filters(
			array(
				array(
					'relation' => 'OR',
					'filters'  => array(
						array(
							'field'    => 'title',
							'operator' => 'startsWith',
							'value'    => 'Alpha',
						),
						array(
							'field'    => "field-{$field_id}",
							'operator' => 'is',
							'value'    => 'blue',
						),
					),
				),
			),
			$query->field_schema_for( $collection_id ),
			$collection_id
		);

		$this->assertFalse( is_wp_error( $result ) );
		$this->assertStringContainsString( 'post_title LIKE', $result['where'] );
		$this->assertStringContainsString( ' OR ', $result['where'] );
	}

	public function test_date_filter_values_must_be_parseable(): void {
		$collection_id = $this->create_collection_with_slug( 'Dates', 'rows-date-validation' );
		$field_id      = $this->create_collection_field( $collection_id, 'Due', 'date' );
		$query         = new RowsFilterQuery();

		$result = $query->compile_filters(
			array(
				array(
					'field'    => "field-{$field_id}",
					'operator' => 'before',
					'value'    => 'not a date',
				),
			),
			$query->field_schema_for( $collection_id ),
			$collection_id
		);

		$this->assertTrue( is_wp_error( $result ) );
		$this->assertSame( 'cortext_invalid_filter', $result->get_error_code() );
	}

	public function test_group_nesting_allows_two_nested_levels_and_rejects_third(): void {
		$collection_id = $this->create_collection_with_slug( 'Groups', 'rows-groups' );
		$field_id      = $this->create_collection_field( $collection_id, 'Text', 'text' );
		$query         = new RowsFilterQuery();
		$field_schema  = $query->field_schema_for( $collection_id );
		$leaf          = array(
			'field'    => "field-{$field_id}",
			'operator' => 'is',
			'value'    => 'alpha',
		);

		$allowed = $query->compile_filters(
			array(
				array(
					'relation' => 'AND',
					'filters'  => array(
						array(
							'relation' => 'OR',
							'filters'  => array(
								array(
									'relation' => 'AND',
									'filters'  => array( $leaf ),
								),
							),
						),
					),
				),
			),
			$field_schema,
			$collection_id
		);
		$this->assertFalse( is_wp_error( $allowed ) );

		$too_deep = $query->compile_filters(
			array(
				array(
					'relation' => 'AND',
					'filters'  => array(
						array(
							'relation' => 'OR',
							'filters'  => array(
								array(
									'relation' => 'AND',
									'filters'  => array(
										array(
											'relation' => 'OR',
											'filters'  => array( $leaf ),
										),
									),
								),
							),
						),
					),
				),
			),
			$field_schema,
			$collection_id
		);
		$this->assertTrue( is_wp_error( $too_deep ) );
		$this->assertSame( 'cortext_filter_depth_exceeded', $too_deep->get_error_code() );
	}

	public function test_search_splits_terms_with_and_semantics_and_includes_text_meta(): void {
		$collection_id = $this->create_collection_with_slug( 'Search', 'rows-search' );
		$field_id      = $this->create_collection_field( $collection_id, 'Notes', 'text' );
		$query         = new RowsFilterQuery();

		$sql = $query->compile_search( 'alpha beta', $query->field_schema_for( $collection_id ) );

		$this->assertSame( 2, substr_count( $sql, 'post_title LIKE' ) );
		$this->assertStringContainsString( ' AND ', $sql );
		$this->assertStringContainsString( "field-{$field_id}", $sql );
	}

	public function test_filter_join_clauses_group_by_post_id_to_avoid_duplicate_rows(): void {
		global $wpdb;

		$query = new RowsFilterQuery();

		$clauses = $query->apply_filter_join_clauses(
			array(
				'join'    => ' INNER JOIN existing_table ON 1 = 1',
				'groupby' => '',
			),
			' INNER JOIN wp_postmeta AS mt1 ON mt1.post_id = wp_posts.ID'
		);

		$this->assertStringContainsString( 'existing_table', $clauses['join'] );
		$this->assertStringContainsString( 'wp_postmeta AS mt1', $clauses['join'] );
		$this->assertSame( "{$wpdb->posts}.ID", $clauses['groupby'] );
	}

	public function test_filter_join_clauses_preserve_existing_group_by(): void {
		global $wpdb;

		$query = new RowsFilterQuery();

		$clauses = $query->apply_filter_join_clauses(
			array(
				'join'    => '',
				'groupby' => 'custom_column',
			),
			' INNER JOIN wp_postmeta AS mt1 ON mt1.post_id = wp_posts.ID'
		);

		$this->assertSame( "custom_column, {$wpdb->posts}.ID", $clauses['groupby'] );

		$unchanged = $query->apply_filter_join_clauses(
			$clauses,
			' INNER JOIN wp_postmeta AS mt2 ON mt2.post_id = wp_posts.ID'
		);
		$this->assertSame( "custom_column, {$wpdb->posts}.ID", $unchanged['groupby'] );
	}

	public function test_rejects_rollup_sort(): void {
		$collection_id = $this->create_collection_with_slug( 'Rollup sort', 'rows-roll-sort' );
		$field_id      = $this->create_collection_field( $collection_id, 'Rollup', 'rollup' );
		$query         = new RowsFilterQuery();

		$result = $query->validate_sort(
			array(
				'field'     => "field-{$field_id}",
				'direction' => 'asc',
			),
			$query->field_schema_for( $collection_id ),
			$collection_id
		);

		$this->assertTrue( is_wp_error( $result ) );
		$this->assertSame( 'cortext_invalid_sort_field', $result->get_error_code() );
	}

	private function create_collection_with_slug( string $title, string $slug ): int {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'slug' => $slug ),
			)
		);

		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		return $collection_id;
	}

	private function create_collection_field( int $collection_id, string $title, string $type ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => $type ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );

		return $field_id;
	}

	private function value_for_operator( string $type, string $operator ): mixed {
		if ( in_array( $operator, array( 'isEmpty', 'isNotEmpty', 'isChecked', 'isUnchecked' ), true ) ) {
			return null;
		}
		if ( 'between' === $operator ) {
			if ( 'number' === $type ) {
				return array( 2, 10 );
			}
			return 'datetime' === $type
				? array( '2026-05-01T00:00:00+00:00', '2026-05-31T23:59:59+00:00' )
				: array( '2026-05-01', '2026-05-31' );
		}
		if ( in_array( $operator, array( 'isAny', 'isNone' ), true ) ) {
			return array( 'alpha', 'beta' );
		}
		if ( 'number' === $type ) {
			return 10;
		}
		if ( 'datetime' === $type ) {
			return '2026-05-11T12:30:00+00:00';
		}
		if ( 'date' === $type ) {
			return '2026-05-11';
		}
		return 'alpha';
	}

	private function unregister_dynamic_collection_post_types(): void {
		foreach ( get_post_types() as $post_type ) {
			if (
				str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) &&
				! in_array( $post_type, array( Collection::POST_TYPE, Field::POST_TYPE ), true )
			) {
				unregister_post_type( $post_type );
			}
		}
	}
}
