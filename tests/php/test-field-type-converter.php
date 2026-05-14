<?php
/**
 * Tests for Cortext\Fields\FieldTypeConverter.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Fields\FieldTypeConverter;
use WorDBless\BaseTestCase;

final class Test_Field_Type_Converter extends BaseTestCase {

	public function test_supports_rejects_same_type(): void {
		$this->assertFalse( FieldTypeConverter::supports( 'text', 'text' ) );
	}

	public function test_supports_rejects_unknown_types(): void {
		$this->assertFalse( FieldTypeConverter::supports( 'text', 'unknown' ) );
		$this->assertFalse( FieldTypeConverter::supports( 'unknown', 'text' ) );
	}

	public function test_supports_rejects_relation_rollup_formula(): void {
		$this->assertFalse( FieldTypeConverter::supports( 'text', 'relation' ) );
		$this->assertFalse( FieldTypeConverter::supports( 'relation', 'text' ) );
		$this->assertFalse( FieldTypeConverter::supports( 'text', 'rollup' ) );
		$this->assertFalse( FieldTypeConverter::supports( 'rollup', 'text' ) );
		$this->assertFalse( FieldTypeConverter::supports( 'text', 'formula' ) );
		$this->assertFalse( FieldTypeConverter::supports( 'formula', 'text' ) );
	}

	public function test_supports_accepts_common_pairs(): void {
		$this->assertTrue( FieldTypeConverter::supports( 'text', 'number' ) );
		$this->assertTrue( FieldTypeConverter::supports( 'number', 'text' ) );
		$this->assertTrue( FieldTypeConverter::supports( 'text', 'select' ) );
		$this->assertTrue( FieldTypeConverter::supports( 'select', 'multiselect' ) );
		$this->assertTrue( FieldTypeConverter::supports( 'multiselect', 'select' ) );
		$this->assertTrue( FieldTypeConverter::supports( 'date', 'text' ) );
		$this->assertTrue( FieldTypeConverter::supports( 'checkbox', 'number' ) );
	}

	public function test_classify_empty_is_empty(): void {
		$this->assertSame( FieldTypeConverter::STATUS_EMPTY, FieldTypeConverter::classify( 'text', 'number', '' ) );
		$this->assertSame( FieldTypeConverter::STATUS_EMPTY, FieldTypeConverter::classify( 'text', 'number', null ) );
		$this->assertSame( FieldTypeConverter::STATUS_EMPTY, FieldTypeConverter::classify( 'multiselect', 'select', array() ) );
		$this->assertSame( FieldTypeConverter::STATUS_EMPTY, FieldTypeConverter::classify( 'multiselect', 'text', array( '' ) ) );
	}

	public function test_classify_text_to_number(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'number', '42' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'number', '3.14' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'number', '-7' ) );
		$this->assertSame( FieldTypeConverter::STATUS_HIDDEN, FieldTypeConverter::classify( 'text', 'number', 'abc' ) );
		$this->assertSame( FieldTypeConverter::STATUS_HIDDEN, FieldTypeConverter::classify( 'text', 'number', '12 cats' ) );
	}

	public function test_classify_text_to_date(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'date', '2026-05-13' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'date', 'May 13, 2026' ) );
		$this->assertSame( FieldTypeConverter::STATUS_HIDDEN, FieldTypeConverter::classify( 'text', 'date', 'not a date' ) );
	}

	public function test_classify_text_to_email(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'email', 'user@example.com' ) );
		$this->assertSame( FieldTypeConverter::STATUS_HIDDEN, FieldTypeConverter::classify( 'text', 'email', 'not-an-email' ) );
	}

	public function test_classify_text_to_url(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'url', 'https://example.com' ) );
		$this->assertSame( FieldTypeConverter::STATUS_HIDDEN, FieldTypeConverter::classify( 'text', 'url', 'abc' ) );
		$this->assertSame( FieldTypeConverter::STATUS_HIDDEN, FieldTypeConverter::classify( 'text', 'url', 'example.com' ) );
	}

	public function test_classify_to_checkbox_always_displays(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'checkbox', '' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'checkbox', 'anything' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'number', 'checkbox', '0' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'multiselect', 'checkbox', array() ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'multiselect', 'checkbox', array( 'a' ) ) );
	}

	public function test_classify_text_to_select_always_displays(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'select', 'Open' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'text', 'multiselect', 'Open, Closed' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'number', 'select', '42' ) );
	}

	public function test_classify_multiselect_to_select_first_value_displays(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'multiselect', 'select', array( 'A', 'B', 'C' ) ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'multiselect', 'text', array( 'A' ) ) );
		$this->assertSame( FieldTypeConverter::STATUS_EMPTY, FieldTypeConverter::classify( 'multiselect', 'select', array() ) );
	}

	public function test_classify_select_to_multiselect_displays_single(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'select', 'multiselect', 'Open' ) );
		$this->assertSame( FieldTypeConverter::STATUS_EMPTY, FieldTypeConverter::classify( 'select', 'multiselect', '' ) );
	}

	public function test_classify_number_to_text_displays(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'number', 'text', '42' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'number', 'text', 3.14 ) );
	}

	public function test_classify_date_to_text_displays(): void {
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'date', 'text', '2026-05-13' ) );
		$this->assertSame( FieldTypeConverter::STATUS_DISPLAYS, FieldTypeConverter::classify( 'datetime', 'text', '2026-05-13T10:00:00+00:00' ) );
	}

	public function test_classify_unsupported_returns_hidden(): void {
		$this->assertSame( FieldTypeConverter::STATUS_HIDDEN, FieldTypeConverter::classify( 'text', 'relation', 'anything' ) );
		$this->assertSame( FieldTypeConverter::STATUS_HIDDEN, FieldTypeConverter::classify( 'rollup', 'text', '42' ) );
	}

	public function test_split_tokens_splits_on_delimiters(): void {
		$this->assertSame( array( 'Open', 'Closed' ), FieldTypeConverter::split_tokens( 'Open, Closed' ) );
		$this->assertSame( array( 'Open', 'Closed' ), FieldTypeConverter::split_tokens( 'Open; Closed' ) );
		$this->assertSame( array( 'Open', 'Closed' ), FieldTypeConverter::split_tokens( "Open\nClosed" ) );
		$this->assertSame( array( 'A', 'B', 'C' ), FieldTypeConverter::split_tokens( 'A, B; C' ) );
	}

	public function test_split_tokens_drops_empty_tokens_and_trims(): void {
		$this->assertSame( array( 'A', 'B' ), FieldTypeConverter::split_tokens( ' A , , B ' ) );
		$this->assertSame( array(), FieldTypeConverter::split_tokens( ' , ; ' ) );
		$this->assertSame( array(), FieldTypeConverter::split_tokens( '' ) );
	}

	public function test_split_tokens_returns_single_token_when_no_delimiter(): void {
		$this->assertSame( array( 'Single value' ), FieldTypeConverter::split_tokens( 'Single value' ) );
	}

	public function test_extends_options_only_for_text_like_to_select_pairs(): void {
		$this->assertTrue( FieldTypeConverter::extends_options( 'text', 'select' ) );
		$this->assertTrue( FieldTypeConverter::extends_options( 'text', 'multiselect' ) );
		$this->assertTrue( FieldTypeConverter::extends_options( 'number', 'select' ) );
		$this->assertTrue( FieldTypeConverter::extends_options( 'email', 'multiselect' ) );
		$this->assertTrue( FieldTypeConverter::extends_options( 'url', 'select' ) );

		$this->assertFalse( FieldTypeConverter::extends_options( 'multiselect', 'select' ) );
		$this->assertFalse( FieldTypeConverter::extends_options( 'select', 'multiselect' ) );
		$this->assertFalse( FieldTypeConverter::extends_options( 'text', 'number' ) );
		$this->assertFalse( FieldTypeConverter::extends_options( 'text', 'relation' ) );
	}
}
