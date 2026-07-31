<?php
/**
 * Tests for Cortext experiment registry.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Runtime\Experiments;
use WorDBless\BaseTestCase;

final class Test_Runtime_Experiments extends BaseTestCase {

	public function tear_down(): void {
		remove_all_filters( 'cortext_experiments' );
		delete_option( Experiments::OPTION );
		parent::tear_down();
	}

	public function test_defaults_to_empty_registry(): void {
		$experiments = new Experiments();

		$this->assertSame( array(), $experiments->registered() );
		$this->assertSame( array(), $experiments->list() );
		$this->assertSame( array(), $experiments->to_client_settings() );
		$this->assertFalse( $experiments->is_enabled( 'missing' ) );
	}

	public function test_registers_and_reads_enabled_values(): void {
		$this->register_sample_experiments();
		update_option(
			Experiments::OPTION,
			array(
				'fast_mode' => true,
				'old_mode'  => true,
			),
			false
		);

		$experiments = new Experiments();

		$this->assertTrue( $experiments->is_enabled( 'fast_mode' ) );
		$this->assertTrue( $experiments->is_enabled( 'default_on' ) );
		$this->assertFalse( $experiments->is_enabled( 'old_mode' ) );
		$this->assertSame(
			array(
				'fast_mode'  => true,
				'default_on' => true,
			),
			$experiments->to_client_settings()
		);
	}

	public function test_update_rejects_unknown_ids(): void {
		$this->register_sample_experiments();

		$result = ( new Experiments() )->update( array( 'missing' => true ) );

		$this->assertTrue( is_wp_error( $result ) );
		$this->assertSame( 'cortext_experiments_unknown_id', $result->get_error_code() );
		$this->assertSame( array(), get_option( Experiments::OPTION, array() ) );
	}

	public function test_update_stores_known_values(): void {
		$this->register_sample_experiments();

		$result = ( new Experiments() )->update(
			array(
				'fast_mode'  => true,
				'default_on' => false,
			)
		);

		$this->assertIsArray( $result );
		$this->assertSame(
			array(
				'fast_mode'  => true,
				'default_on' => false,
			),
			get_option( Experiments::OPTION, array() )
		);
		$this->assertTrue( ( new Experiments() )->is_enabled( 'fast_mode' ) );
		$this->assertFalse( ( new Experiments() )->is_enabled( 'default_on' ) );
	}

	public function test_partial_updates_preserve_other_experiment_values(): void {
		$this->register_sample_experiments();
		$experiments = new Experiments();

		$experiments->update( array( 'fast_mode' => true ) );
		$result = $experiments->update( array( 'default_on' => false ) );

		$this->assertIsArray( $result );
		$this->assertSame(
			array(
				'fast_mode'  => true,
				'default_on' => false,
			),
			get_option( Experiments::OPTION, array() )
		);

		$experiments->update( array( 'fast_mode' => false ) );
		$this->assertSame(
			array(
				'fast_mode'  => false,
				'default_on' => false,
			),
			get_option( Experiments::OPTION, array() )
		);
	}

	public function test_preserves_case_sensitive_ids_across_registry_and_storage(): void {
		add_filter(
			'cortext_experiments',
			static fn () => array(
				array(
					'id'          => 'quickEditing',
					'label'       => 'Quick editing',
					'description' => 'Edits content more quickly.',
				),
			)
		);
		update_option( Experiments::OPTION, array( 'quickediting' => true ), false );

		$experiments = new Experiments();
		$registered  = $experiments->registered();

		$this->assertArrayHasKey( 'quickEditing', $registered );
		$this->assertArrayNotHasKey( 'quickediting', $registered );
		$this->assertSame( 'quickEditing', $registered['quickEditing']['id'] );
		$this->assertSame( 'quickEditing', $experiments->list()[0]['id'] );
		$this->assertFalse( $experiments->list()[0]['enabled'] );
		$this->assertSame( array( 'quickEditing' => false ), $experiments->to_client_settings() );
		$this->assertFalse( $experiments->is_enabled( 'quickEditing' ) );
		$this->assertFalse( $experiments->is_enabled( 'quickediting' ) );

		$result = $experiments->update( array( 'quickEditing' => true ) );

		$this->assertIsArray( $result );
		$this->assertSame( 'quickEditing', $result[0]['id'] );
		$this->assertTrue( $result[0]['enabled'] );
		$this->assertSame( array( 'quickEditing' => true ), get_option( Experiments::OPTION, array() ) );
		$this->assertTrue( $experiments->is_enabled( 'quickEditing' ) );
		$this->assertSame( array( 'quickEditing' => true ), $experiments->to_client_settings() );
	}

	public function test_ignores_ids_outside_the_stable_id_contract(): void {
		add_filter(
			'cortext_experiments',
			static fn () => array(
				array( 'id' => 'Valid-ID_2' ),
				array( 'id' => '_starts_with_underscore' ),
				array( 'id' => '2starts_with_number' ),
				array( 'id' => 'contains.dot' ),
				array( 'id' => 'contains space' ),
				array( 'id' => 123 ),
			)
		);

		$this->assertSame( array( 'Valid-ID_2' ), array_keys( ( new Experiments() )->registered() ) );
	}

	private function register_sample_experiments(): void {
		add_filter(
			'cortext_experiments',
			static fn () => array(
				array(
					'id'          => 'fast_mode',
					'label'       => 'Fast mode',
					'description' => 'Makes things faster.',
					'group'       => 'Labs',
				),
				array(
					'id'          => 'default_on',
					'label'       => 'Default on',
					'description' => 'Starts enabled.',
					'default'     => true,
				),
			)
		);
	}
}
