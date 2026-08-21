<?php
/**
 * Tests for Cortext script translation registration.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Admin\Screen;
use Cortext\Frontend\Assets;
use WorDBless\BaseTestCase;

final class Test_Script_Translations extends BaseTestCase {

	private bool $created_build_directory = false;
	private bool $created_shell_manifest  = false;

	public function set_up(): void {
		parent::set_up();

		$build_directory = CORTEXT_PATH . 'build';
		$manifest_path   = $build_directory . '/index.asset.php';

		if ( ! is_dir( $build_directory ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_mkdir -- Creates an isolated test fixture.
			mkdir( $build_directory );
			$this->created_build_directory = true;
		}

		if ( ! file_exists( $manifest_path ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Creates an isolated test fixture.
			file_put_contents(
				$manifest_path,
				"<?php\nreturn array( 'dependencies' => array(), 'version' => 'test' );\n"
			);
			$this->created_shell_manifest = true;
		}
	}

	public function tear_down(): void {
		if ( $this->created_shell_manifest ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink -- Removes the test fixture created above.
			unlink( CORTEXT_PATH . 'build/index.asset.php' );
		}

		if ( $this->created_build_directory ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir -- Removes the test fixture created above.
			rmdir( CORTEXT_PATH . 'build' );
		}

		parent::tear_down();
	}

	public function test_admin_shell_uses_cortext_translations_without_a_custom_path(): void {
		( new Screen() )->enqueue_assets( Screen::HOOK_SUFFIX );

		$this->assertScriptUsesWordPressLanguagePacks( 'cortext-shell' );
	}

	public function test_frontend_runtime_uses_cortext_translations_without_a_custom_path(): void {
		Assets::enqueue_frontend_runtime();

		$this->assertScriptUsesWordPressLanguagePacks( 'cortext-frontend' );
	}

	private function assertScriptUsesWordPressLanguagePacks( string $handle ): void {
		$scripts = wp_scripts();

		$this->assertArrayHasKey( $handle, $scripts->registered );
		$this->assertSame( 'cortext', $scripts->registered[ $handle ]->textdomain );
		$this->assertSame( '', $scripts->registered[ $handle ]->translations_path );
		$this->assertContains( 'wp-i18n', $scripts->registered[ $handle ]->deps );
	}
}
