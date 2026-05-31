<?php
/**
 * Tests for Cortext runtime feature flags.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Runtime\Features;
use WorDBless\BaseTestCase;

final class Test_Runtime_Features extends BaseTestCase {

	public function tear_down(): void {
		remove_all_filters( 'cortext_public_web_affordances_enabled' );
		remove_all_filters( 'cortext_wordpress_affordances_enabled' );
		parent::tear_down();
	}

	public function test_regular_wordpress_installs_keep_affordances_enabled(): void {
		$features = new Features();

		$this->assertFalse( $features->is_desktop() );
		$this->assertTrue( $features->public_web_affordances_enabled() );
		$this->assertTrue( $features->wordpress_affordances_enabled() );
		$this->assertSame(
			array(
				'publicWebAffordances' => true,
				'wordpressAffordances' => true,
			),
			$features->to_client_settings()
		);
	}

	public function test_regular_wordpress_installs_can_turn_affordances_off_with_filters(): void {
		add_filter( 'cortext_public_web_affordances_enabled', '__return_false' );
		add_filter( 'cortext_wordpress_affordances_enabled', '__return_false' );

		$features = new Features();

		$this->assertFalse( $features->public_web_affordances_enabled() );
		$this->assertFalse( $features->wordpress_affordances_enabled() );
	}

	/**
	 * Desktop starts with these controls hidden.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_desktop_installs_hide_affordances_by_default(): void {
		define( 'CORTEXT_DESKTOP', true );

		$features = new Features();

		$this->assertTrue( $features->is_desktop() );
		$this->assertFalse( $features->public_web_affordances_enabled() );
		$this->assertFalse( $features->wordpress_affordances_enabled() );
		$this->assertSame(
			array(
				'publicWebAffordances' => false,
				'wordpressAffordances' => false,
			),
			$features->to_client_settings()
		);
	}

	/**
	 * Filters can still opt a desktop build back in.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_desktop_installs_can_turn_affordances_back_on_with_filters(): void {
		define( 'CORTEXT_DESKTOP', true );
		add_filter( 'cortext_public_web_affordances_enabled', '__return_true' );
		add_filter( 'cortext_wordpress_affordances_enabled', '__return_true' );

		$features = new Features();

		$this->assertTrue( $features->public_web_affordances_enabled() );
		$this->assertTrue( $features->wordpress_affordances_enabled() );
	}
}
