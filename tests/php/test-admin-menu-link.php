<?php
/**
 * Tests for Cortext\Admin\MenuLink.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Admin\MenuLink;
use WorDBless\BaseTestCase;

final class Test_Admin_MenuLink extends BaseTestCase {

	public function test_register_menu_adds_top_level_page_with_expected_slug_and_capability(): void {
		global $menu, $admin_page_hooks;
		$menu             = [];
		$admin_page_hooks = [];

		( new MenuLink() )->register_menu();

		$this->assertArrayHasKey( 'cortext', $admin_page_hooks );

		$cortext_item = null;
		foreach ( $menu as $item ) {
			if ( isset( $item[2] ) && 'cortext' === $item[2] ) {
				$cortext_item = $item;
				break;
			}
		}

		$this->assertNotNull( $cortext_item, 'Cortext menu entry was not registered.' );
		$this->assertSame( 'edit_posts', $cortext_item[1], 'Cortext menu capability should be edit_posts.' );
		$this->assertSame( 'Cortext', $cortext_item[0], 'Cortext menu title should be "Cortext".' );
	}
}
