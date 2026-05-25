<?php
/**
 * Tests for Cortext field-value indexing.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\FieldValues\FieldValueIndex;
use Cortext\FieldValues\FieldValueStore;
use Cortext\Relations;
use WorDBless\BaseTestCase;

final class Test_Field_Value_Index extends BaseTestCase {

	public function tear_down(): void {
		FieldValueIndex::resume_sync();
		FieldValueIndex::flush_runtime_caches();
		delete_option( 'cortext_field_values_index_enabled' );
		delete_option( 'cortext_field_values_disabled_since' );
		delete_option( 'cortext_field_values_index_status' );
		delete_option( 'cortext_field_values_index_error' );
		delete_option( 'cortext_field_values_schema_version' );
		delete_option( 'cortext_field_values_install_attempted_version' );
		delete_option( 'cortext_field_values_auto_rebuild_lock' );
		remove_all_filters( 'cortext_field_values_index_enabled' );
		parent::tear_down();
	}

	public function test_normalizes_scalar_values_for_index_columns(): void {
		$index = new FieldValueIndex();

		$number = $index->normalized_value_rows( 10, 'number', '42.50' );
		$date   = $index->normalized_value_rows( 11, 'date', '2026-05-23' );
		$text   = $index->normalized_value_rows( 12, 'text', str_repeat( 'a', 220 ) );

		$this->assertSame( 42.5, $number[0]['value_number'] );
		$this->assertSame( '42.50', $number[0]['value_text'] );
		$this->assertSame( '2026-05-23 00:00:00', $date[0]['value_date'] );
		$this->assertSame( 191, strlen( $text[0]['value_text'] ) );
	}

	public function test_normalizes_multivalue_rows_with_stable_sequence(): void {
		$index = new FieldValueIndex();

		$rows = $index->normalized_value_rows( 10, 'multiselect', array( 'alpha', '', 'beta' ) );

		$this->assertCount( 2, $rows );
		$this->assertSame( 0, $rows[0]['value_seq'] );
		$this->assertSame( 'alpha', $rows[0]['value_text'] );
		$this->assertSame( 1, $rows[1]['value_seq'] );
		$this->assertSame( 'beta', $rows[1]['value_text'] );
	}

	public function test_field_value_store_keeps_postmeta_as_source_of_truth(): void {
		$row_id   = 123;
		$field_id = 456;
		$key      = Relations::meta_key( $field_id );
		$store    = new FieldValueStore();

		$store->write_value( $row_id, $field_id, 'multiselect', array( 'alpha', 'beta' ) );
		$this->assertSame( array( 'alpha', 'beta' ), get_post_meta( $row_id, $key, false ) );

		$store->write_value( $row_id, $field_id, 'number', '12.75' );
		$this->assertSame( 12.75, get_post_meta( $row_id, $key, true ) );
	}

	public function test_pending_meta_sync_coalesces_repeated_row_field_changes(): void {
		$index      = new FieldValueIndex();
		$reflection = new \ReflectionClass( FieldValueIndex::class );

		update_option( 'cortext_field_values_index_status', FieldValueIndex::STATUS_READY, false );
		update_option( 'cortext_field_values_schema_version', 1, false );

		$table_cache = $reflection->getProperty( 'table_exists_cache' );
		$table_cache->setAccessible( true );
		$table_cache->setValue( null, array( $index->table_name() => true ) );

		$index->sync_meta_change( 1, 101, Relations::meta_key( 202 ), '1' );
		$index->sync_meta_change( 2, 101, Relations::meta_key( 202 ), '2' );

		$pending_property = $reflection->getProperty( 'pending_row_fields' );
		$pending_property->setAccessible( true );
		$pending = $pending_property->getValue();

		$this->assertCount( 1, $pending );
		$this->assertSame(
			array(
				'row_id'   => 101,
				'field_id' => 202,
			),
			$pending['101:202']
		);
	}

	public function test_index_can_be_disabled_with_option_and_filter(): void {
		$index = new FieldValueIndex();

		$this->assertTrue( $index->is_enabled() );

		update_option( 'cortext_field_values_index_enabled', '0', false );
		$this->assertFalse( $index->is_enabled() );
		$this->assertSame( FieldValueIndex::STATUS_DISABLED, $index->status()['status'] );

		update_option( 'cortext_field_values_index_enabled', '1', false );
		add_filter( 'cortext_field_values_index_enabled', '__return_false' );
		$this->assertFalse( $index->is_enabled() );
	}

	public function test_disabled_index_records_that_reenabling_needs_rebuild(): void {
		$index = new FieldValueIndex();

		update_option( 'cortext_field_values_index_enabled', '0', false );
		$index->maybe_auto_provision();

		$this->assertGreaterThan( 0, (int) get_option( 'cortext_field_values_disabled_since', 0 ) );
		$this->assertSame( FieldValueIndex::STATUS_DISABLED, $index->status()['status'] );
	}
}
