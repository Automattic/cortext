<?php
/**
 * Tests for Cortext\Admin\Screen client settings.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Admin\Screen;
use Cortext\Runtime\Experiments;
use WorDBless\BaseTestCase;

final class Test_Admin_Screen_Client_Settings extends BaseTestCase {

	public function tear_down(): void {
		remove_all_filters( 'cortext_experiments' );
		delete_option( Experiments::OPTION );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_client_settings_include_experiments_and_capabilities(): void {
		add_filter(
			'cortext_experiments',
			static fn () => array(
				array(
					'id'          => 'fast_mode',
					'label'       => 'Fast mode',
					'description' => 'Makes things faster.',
				),
			)
		);
		update_option( Experiments::OPTION, array( 'fast_mode' => true ), false );
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$settings = ( new Screen() )->client_settings();

		$this->assertSame( array( 'fast_mode' => true ), $settings['experiments'] );
		$this->assertTrue( $settings['capabilities']['manageOptions'] );
		$this->assertSame( Screen::MENU_SLUG, $settings['menuSlug'] );
	}

	private function create_user( string $role ): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_', false ),
				'user_pass'  => 'password',
				'role'       => $role,
			)
		);
	}
}
