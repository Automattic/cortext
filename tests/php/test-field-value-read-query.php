<?php
/**
 * Tests for Cortext field-value index reads.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\FieldValues\FieldValueReadQuery;
use WorDBless\BaseTestCase;

final class Test_Field_Value_Read_Query extends BaseTestCase {

	public function test_supports_indexed_field_filters(): void {
		$query  = new FieldValueReadQuery();
		$schema = $this->field_schema();

		$supported = array(
			array( 'field-101', 'is', 50 ),
			array( 'field-101', 'greaterThan', 50 ),
			array( 'field-101', 'lessThan', 50 ),
			array( 'field-101', 'between', array( 25, 75 ) ),
			array( 'field-102', 'is', 'alpha' ),
			array( 'field-102', 'isAny', array( 'alpha', 'beta' ) ),
			array( 'field-103', 'is', '2026-05-24' ),
			array( 'field-103', 'on', '2026-05-24' ),
			array( 'field-103', 'before', '2026-05-24' ),
			array( 'field-103', 'after', '2026-05-24' ),
			array( 'field-103', 'between', array( '2026-05-20', '2026-05-24' ) ),
			array( 'field-104', 'is', 'Acme' ),
			array( 'field-104', 'startsWith', 'Acme' ),
			array( 'field-104', 'isNotEmpty', null ),
			array( 'field-105', 'contains', 'alpha' ),
			array( 'field-105', 'isAny', array( 'alpha', 'beta' ) ),
			array( 'field-106', 'isChecked', null ),
		);

		foreach ( $supported as $case ) {
			list( $field, $operator, $value ) = $case;
			$filter                           = array(
				'field'    => $field,
				'operator' => $operator,
			);
			if ( null !== $value ) {
				$filter['value'] = $value;
			}

			$this->assertTrue(
				$query->supports_query( $schema, array( $filter ), null ),
				"Expected {$field} {$operator} to use the field-value index."
			);
		}
	}

	public function test_rejects_filter_operators_that_need_postmeta_semantics(): void {
		$query       = new FieldValueReadQuery();
		$schema      = $this->field_schema();
		$unsupported = array(
			array( 'field-101', 'isEmpty', null ),
			array( 'field-102', 'isNot', 'alpha' ),
			array( 'field-102', 'isNone', array( 'alpha', 'beta' ) ),
			array( 'field-103', 'isEmpty', null ),
			array( 'field-104', 'is', str_repeat( 'a', 192 ) ),
			array( 'field-104', 'contains', 'Acme' ),
			array( 'field-104', 'notContains', 'Acme' ),
			array( 'field-104', 'endsWith', 'Acme' ),
			array( 'field-104', 'isEmpty', null ),
			array( 'field-102', 'isAny', array( 'alpha', str_repeat( 'b', 192 ) ) ),
			array( 'field-105', 'notContains', 'alpha' ),
			array( 'field-105', 'isNone', array( 'alpha', 'beta' ) ),
			array( 'field-106', 'isUnchecked', null ),
		);

		foreach ( $unsupported as $case ) {
			list( $field, $operator, $value ) = $case;
			$filter                           = array(
				'field'    => $field,
				'operator' => $operator,
			);
			if ( null !== $value ) {
				$filter['value'] = $value;
			}

			$this->assertFalse(
				$query->supports_query( $schema, array( $filter ), null ),
				"Expected {$field} {$operator} to stay on the postmeta path."
			);
		}
	}

	public function test_supports_indexed_custom_sorts(): void {
		$query  = new FieldValueReadQuery();
		$schema = $this->field_schema();

		foreach ( array( 'field-101', 'field-102', 'field-103', 'field-106' ) as $field ) {
			$this->assertTrue(
				$query->supports_query(
					$schema,
					array(),
					array(
						'field'     => $field,
						'direction' => 'asc',
					)
				),
				"Expected {$field} sort to use the field-value index."
			);
		}
	}

	public function test_rejects_custom_text_sorts_that_need_full_values(): void {
		$query  = new FieldValueReadQuery();
		$schema = $this->field_schema();

		foreach ( array( 'field-104', 'field-105' ) as $field ) {
			$this->assertFalse(
				$query->supports_query(
					$schema,
					array(),
					array(
						'field'     => $field,
						'direction' => 'asc',
					)
				),
				"Expected {$field} sort to stay on the postmeta path."
			);
		}
	}

	public function test_keeps_search_include_or_and_negative_filters_on_postmeta_path(): void {
		$query  = new FieldValueReadQuery();
		$schema = $this->field_schema();
		$filter = array(
			array(
				'field'    => 'field-101',
				'operator' => 'greaterThan',
				'value'    => 50,
			),
		);

		$this->assertFalse( $query->supports_query( $schema, $filter, null, 'needle' ) );
		$this->assertFalse( $query->supports_query( $schema, $filter, null, '', true ) );

		$this->assertFalse(
			$query->supports_query(
				$schema,
				array(
					array(
						'relation' => 'OR',
						'filters'  => array(
							array(
								'field'    => 'field-101',
								'operator' => 'greaterThan',
								'value'    => 50,
							),
							array(
								'field'    => 'field-102',
								'operator' => 'is',
								'value'    => 'alpha',
							),
						),
					),
				),
				null
			)
		);

		$this->assertFalse(
			$query->supports_query(
				$schema,
				array(
					array(
						'field'    => 'field-102',
						'operator' => 'isNot',
						'value'    => 'alpha',
					),
				),
				null
			)
		);
	}

	public function test_avoids_text_contains_because_index_text_is_prefix_limited(): void {
		$query  = new FieldValueReadQuery();
		$schema = $this->field_schema();

		$this->assertTrue(
			$query->supports_query(
				$schema,
				array(
					array(
						'field'    => 'field-104',
						'operator' => 'startsWith',
						'value'    => 'Acme',
					),
				),
				null
			)
		);

		$this->assertFalse(
			$query->supports_query(
				$schema,
				array(
					array(
						'field'    => 'field-104',
						'operator' => 'contains',
						'value'    => 'Acme',
					),
				),
				null
			)
		);
	}

	public function test_exact_text_predicate_only_rejects_truncated_index_values(): void {
		$query  = new FieldValueReadQuery();
		$method = new \ReflectionMethod( $query, 'text_exact_predicate' );
		$method->setAccessible( true );

		$predicate = $method->invoke( $query, 'Cafe' );

		$this->assertSame(
			'fvf_PLACEHOLDER.value_text = %s AND fvf_PLACEHOLDER.value_text_length <= %d',
			$predicate['sql']
		);
		$this->assertSame( array( 'Cafe', 191 ), $predicate['args'] );
	}

	public function test_title_only_queries_stay_on_postmeta_path_but_can_combine_with_indexed_sort(): void {
		$query  = new FieldValueReadQuery();
		$schema = $this->field_schema();
		$filter = array(
			array(
				'field'    => 'title',
				'operator' => 'startsWith',
				'value'    => 'Alpha',
			),
		);

		$this->assertFalse( $query->supports_query( $schema, $filter, null ) );
		$this->assertTrue(
			$query->supports_query(
				$schema,
				$filter,
				array(
					'field'     => 'field-103',
					'direction' => 'desc',
				)
			)
		);
	}

	private function field_schema(): array {
		return array(
			'title'     => array(
				'id'         => 0,
				'type'       => 'text',
				'filterable' => true,
				'sortable'   => true,
				'operators'  => array( 'is', 'isNot', 'contains', 'notContains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty' ),
			),
			'field-101' => array(
				'id'         => 101,
				'type'       => 'number',
				'filterable' => true,
				'sortable'   => true,
				'operators'  => array( 'is', 'greaterThan', 'lessThan', 'between', 'isEmpty' ),
			),
			'field-102' => array(
				'id'         => 102,
				'type'       => 'select',
				'filterable' => true,
				'sortable'   => true,
				'operators'  => array( 'is', 'isNot', 'isAny', 'isNone' ),
			),
			'field-103' => array(
				'id'         => 103,
				'type'       => 'date',
				'filterable' => true,
				'sortable'   => true,
				'operators'  => array( 'is', 'on', 'before', 'after', 'between', 'isEmpty' ),
			),
			'field-104' => array(
				'id'         => 104,
				'type'       => 'text',
				'filterable' => true,
				'sortable'   => true,
				'operators'  => array( 'is', 'isNot', 'contains', 'notContains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty' ),
			),
			'field-105' => array(
				'id'         => 105,
				'type'       => 'multiselect',
				'filterable' => true,
				'sortable'   => false,
				'operators'  => array( 'contains', 'notContains', 'isAny', 'isNone' ),
			),
			'field-106' => array(
				'id'         => 106,
				'type'       => 'checkbox',
				'filterable' => true,
				'sortable'   => true,
				'operators'  => array( 'isChecked', 'isUnchecked' ),
			),
		);
	}
}
