<?php
/**
 * Tests for Cortext\Plugin.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Plugin;
use Cortext\Runtime\Experiments;
use WorDBless\BaseTestCase;

final class Test_Plugin extends BaseTestCase {

	public function test_instance_is_idempotent(): void {
		$this->assertSame( Plugin::instance(), Plugin::instance() );
	}

	public function test_registers_traits_as_disabled_by_default(): void {
		$existing = array(
			array(
				'id'      => 'existing',
				'label'   => 'Existing',
				'default' => true,
			),
		);

		$registered = Plugin::instance()->register_experiments( $existing );

		$this->assertSame( $existing[0], $registered[0] );
		$this->assertSame( Experiments::TRAITS_ID, $registered[1]['id'] );
		$this->assertSame( 'Traits', $registered[1]['label'] );
		$this->assertSame( 'Collections', $registered[1]['group'] );
		$this->assertFalse( $registered[1]['default'] );
	}
}
