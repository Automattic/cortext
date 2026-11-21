<?php
/**
 * Tests for Cortext\Fields\DateValue.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Fields\DateValue;
use WorDBless\BaseTestCase;

final class Test_Date_Value extends BaseTestCase {

	public function test_single_dates_keep_their_canonical_form(): void {
		$this->assertSame( '2026-03-01', DateValue::normalize( '2026-03-01', 'date' ) );
		$this->assertSame( '2026-03-01', DateValue::normalize( '2026-03-01T22:00:00-05:00', 'date' ) );
		$this->assertSame( '2026-03-01T10:00:00+00:00', DateValue::normalize( '2026-03-01T12:00:00+02:00', 'datetime' ) );
	}

	public function test_ranges_join_start_and_end_with_a_slash(): void {
		$this->assertSame( '2026-03-01/2026-06-30', DateValue::normalize( '2026-03-01/2026-06-30', 'date' ) );
		$this->assertSame(
			'2026-03-01T10:00:00+00:00/2026-03-02T08:30:00+00:00',
			DateValue::normalize( '2026-03-01T12:00:00+02:00/2026-03-02T08:30:00Z', 'datetime' )
		);
	}

	public function test_reversed_ranges_are_swapped(): void {
		$this->assertSame( '2026-03-01/2026-06-30', DateValue::normalize( '2026-06-30/2026-03-01', 'date' ) );
	}

	public function test_an_end_equal_to_the_start_or_empty_collapses_to_a_single_date(): void {
		$this->assertSame( '2026-03-01', DateValue::normalize( '2026-03-01/2026-03-01', 'date' ) );
		$this->assertSame( '2026-03-01', DateValue::normalize( '2026-03-01/', 'date' ) );
		$this->assertSame( '2026-03-01', DateValue::normalize( '2026-03-01T09:00:00+00:00', 'date' ) );
	}

	public function test_an_unparseable_end_is_dropped(): void {
		$this->assertSame( '2026-03-01', DateValue::normalize( '2026-03-01/soon', 'date' ) );
	}

	public function test_slashes_in_non_iso_input_are_not_read_as_a_range(): void {
		$parts = DateValue::parse( '03/01/2026', 'date' );

		$this->assertSame( '2026-03-01', $parts['start'] );
		$this->assertNull( $parts['end'] );
	}

	public function test_empty_and_unparseable_values(): void {
		$this->assertNull( DateValue::parse( '', 'date' ) );
		$this->assertNull( DateValue::parse( array( '2026-03-01' ), 'date' ) );
		$this->assertNull( DateValue::parse( '2026-02-30', 'date' ) );
		$this->assertSame( '', DateValue::normalize( '', 'date' ) );
		$this->assertSame( 'not a date', DateValue::normalize( 'not a date', 'date' ) );
	}

	public function test_start_and_end_helpers(): void {
		$this->assertSame( '2026-03-01', DateValue::start( '2026-03-01/2026-06-30', 'date' ) );
		$this->assertSame( '2026-06-30', DateValue::end( '2026-03-01/2026-06-30', 'date' ) );
		$this->assertSame( '2026-03-01', DateValue::end( '2026-03-01', 'date' ) );
		$this->assertSame( '', DateValue::start( '', 'date' ) );
		$this->assertSame( '', DateValue::end( '', 'date' ) );
	}
}
