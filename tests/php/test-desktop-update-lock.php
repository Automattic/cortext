<?php
/**
 * Tests for the desktop WordPress update lock.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use WorDBless\BaseTestCase;

final class Test_Desktop_Update_Lock extends BaseTestCase {

	private function load_update_lock(): void {
		require dirname( __DIR__, 2 ) . '/apps/desktop/runtime/mu-plugins/cortext-update-lock.php';
	}

	/**
	 * Regular WordPress should not get the desktop update lock.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_regular_wordpress_load_is_inert(): void {
		$this->load_update_lock();

		$this->assertFalse( defined( 'AUTOMATIC_UPDATER_DISABLED' ) );
		$this->assertFalse( defined( 'WP_AUTO_UPDATE_CORE' ) );
		$this->assertFalse( defined( 'DISALLOW_FILE_MODS' ) );
		$this->assertFalse( defined( 'DISALLOW_FILE_EDIT' ) );
		$this->assertFalse( has_filter( 'automatic_updater_disabled' ) );
		$this->assertFalse( has_filter( 'file_mod_allowed' ) );
		$this->assertFalse( has_filter( 'admin_title' ) );
	}

	/**
	 * Desktop should disable self-updates and file modifications.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_desktop_load_blocks_wordpress_updates(): void {
		define( 'CORTEXT_DESKTOP', true );

		$this->load_update_lock();

		$this->assertTrue( AUTOMATIC_UPDATER_DISABLED );
		$this->assertFalse( WP_AUTO_UPDATE_CORE );
		$this->assertTrue( DISALLOW_FILE_MODS );
		$this->assertTrue( DISALLOW_FILE_EDIT );
		$this->assertTrue( apply_filters( 'automatic_updater_disabled', false ) );
		$this->assertFalse( apply_filters( 'auto_update_core', true ) );
		$this->assertFalse( apply_filters( 'allow_dev_auto_core_updates', true ) );
		$this->assertFalse( apply_filters( 'allow_minor_auto_core_updates', true ) );
		$this->assertFalse( apply_filters( 'allow_major_auto_core_updates', true ) );
		$this->assertFalse( apply_filters( 'auto_update_plugin', true ) );
		$this->assertFalse( apply_filters( 'auto_update_theme', true ) );
		$this->assertFalse( apply_filters( 'auto_update_translation', true ) );
		$this->assertFalse( apply_filters( 'file_mod_allowed', true, 'update_core' ) );
		$this->assertSame(
			'Cortext',
			apply_filters( 'admin_title', 'Cortext - Cortext - WordPress', 'Cortext' )
		);
	}

	/**
	 * Desktop should hide update data and update capabilities.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_desktop_load_hides_update_transients_and_capabilities(): void {
		define( 'CORTEXT_DESKTOP', true );

		$this->load_update_lock();

		$core = apply_filters( 'pre_site_transient_update_core', false );
		$this->assertInstanceOf( \stdClass::class, $core );
		$this->assertSame( array(), $core->updates );

		$plugins = apply_filters( 'pre_site_transient_update_plugins', false );
		$this->assertInstanceOf( \stdClass::class, $plugins );
		$this->assertSame( array(), $plugins->response );
		$this->assertSame( array(), $plugins->translations );

		$themes = apply_filters( 'pre_site_transient_update_themes', false );
		$this->assertInstanceOf( \stdClass::class, $themes );
		$this->assertSame( array(), $themes->response );
		$this->assertSame( array(), $themes->translations );

		$capabilities = apply_filters(
			'user_has_cap',
			array(
				'edit_posts'      => true,
				'install_plugins' => true,
				'update_core'     => true,
			),
			array(),
			array( 'update_core', 1 ),
			(object) array( 'ID' => 1 )
		);
		$this->assertTrue( $capabilities['edit_posts'] );
		$this->assertFalse( $capabilities['install_plugins'] );
		$this->assertFalse( $capabilities['update_core'] );
	}
}
