<?php
/**
 * Tests for Cortext\Admin\Screen.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Admin\Screen;
use WorDBless\BaseTestCase;

final class Test_Admin_Screen extends BaseTestCase {

	public function test_register_menu_adds_top_level_page_with_expected_slug_and_capability(): void {
		global $menu, $admin_page_hooks;
		$menu             = array();
		$admin_page_hooks = array();

		( new Screen() )->register_menu();

		$this->assertArrayHasKey( Screen::MENU_SLUG, $admin_page_hooks );

		$cortext_item = null;
		foreach ( $menu as $item ) {
			if ( isset( $item[2] ) && Screen::MENU_SLUG === $item[2] ) {
				$cortext_item = $item;
				break;
			}
		}

		$this->assertNotNull( $cortext_item, 'Cortext menu entry was not registered.' );
		$this->assertSame( 'edit_posts', $cortext_item[1], 'Cortext menu capability should be edit_posts.' );
		$this->assertSame( 'Cortext', $cortext_item[0], 'Cortext menu title should be "Cortext".' );
	}

	public function test_add_body_class_appends_fullscreen_class_on_cortext_screen(): void {
		set_current_screen( Screen::HOOK_SUFFIX );

		$classes = ( new Screen() )->add_body_class( 'wp-admin' );

		$this->assertStringContainsString( 'cortext-fullscreen', $classes );
		$this->assertStringStartsWith( 'wp-admin ', $classes );
	}

	public function test_add_body_class_passes_through_on_other_screens(): void {
		set_current_screen( 'dashboard' );

		$classes = ( new Screen() )->add_body_class( 'wp-admin' );

		$this->assertSame( 'wp-admin', $classes );
	}
}
