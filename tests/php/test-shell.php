<?php
/**
 * Tests for Cortext\Shell\Shell.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Shell\Shell;
use RuntimeException;
use WorDBless\BaseTestCase;

final class Test_Shell extends BaseTestCase {

	private bool $created_asset_fixture = false;

	/**
	 * @after
	 */
	public function tear_down_shell(): void {
		wp_dequeue_script( 'cortext-shell' );
		wp_deregister_script( 'cortext-shell' );
		wp_dequeue_style( 'cortext-shell' );
		wp_deregister_style( 'cortext-shell' );

		if ( $this->created_asset_fixture ) {
			$asset_path = CORTEXT_PATH . 'build/index.asset.php';
			if ( file_exists( $asset_path ) ) {
				unlink( $asset_path );
			}
			$build_dir = CORTEXT_PATH . 'build';
			if ( is_dir( $build_dir ) && [] === glob( $build_dir . '/*' ) ) {
				rmdir( $build_dir );
			}
			$this->created_asset_fixture = false;
		}
	}

	public function test_register_query_vars_appends_to_existing_vars_without_replacing(): void {
		$vars = ( new Shell() )->register_query_vars( [ 'existing' ] );

		$this->assertSame( [ 'existing', 'cortext_shell' ], $vars );
	}

	public function test_register_rewrite_adds_rule_matching_shell_urls(): void {
		global $wp_rewrite;
		$wp_rewrite->extra_rules_top = [];

		( new Shell() )->register_rewrite();

		$shell_pattern = null;
		foreach ( $wp_rewrite->extra_rules_top as $pattern => $query ) {
			if ( str_contains( $query, 'cortext_shell=1' ) ) {
				$shell_pattern = $pattern;
				break;
			}
		}

		$this->assertNotNull( $shell_pattern, 'Shell rewrite rule was not registered.' );

		foreach ( [ 'cortext', 'cortext/', 'cortext/pages', 'cortext/pages/123/deep' ] as $path ) {
			$this->assertSame(
				1,
				preg_match( '#' . $shell_pattern . '#', $path ),
				"Rewrite pattern should match '$path'."
			);
		}

		foreach ( [ 'other', 'cortex', 'notcortext' ] as $path ) {
			$this->assertSame(
				0,
				preg_match( '#' . $shell_pattern . '#', $path ),
				"Rewrite pattern should not match '$path'."
			);
		}
	}

	public function test_maybe_render_shell_returns_original_template_outside_shell(): void {
		set_query_var( 'cortext_shell', '' );

		$template = ( new Shell() )->maybe_render_shell( '/path/to/original.php' );

		$this->assertSame( '/path/to/original.php', $template );
	}

	public function test_maybe_render_shell_returns_shell_template_for_authorized_user(): void {
		$user_id = wp_insert_user(
			[
				'user_login' => 'cortext_editor',
				'user_pass'  => 'password',
				'user_email' => 'editor@example.com',
				'role'       => 'editor',
			]
		);
		$this->assertIsInt( $user_id );
		wp_set_current_user( $user_id );
		set_query_var( 'cortext_shell', '1' );

		$template = @( new Shell() )->maybe_render_shell( '/wp/template-loader.php' );

		$this->assertSame( CORTEXT_PATH . 'includes/Shell/template.php', $template );
	}

	public function test_maybe_render_shell_wp_dies_for_user_without_edit_posts(): void {
		$user_id = wp_insert_user(
			[
				'user_login' => 'cortext_subscriber',
				'user_pass'  => 'password',
				'user_email' => 'sub@example.com',
				'role'       => 'subscriber',
			]
		);
		$this->assertIsInt( $user_id );
		wp_set_current_user( $user_id );
		set_query_var( 'cortext_shell', '1' );

		add_filter(
			'wp_die_handler',
			static function () {
				return static function ( $message ) {
					throw new RuntimeException( is_string( $message ) ? $message : 'wp_die' );
				};
			}
		);

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessageMatches( '/permission/i' );

		( new Shell() )->maybe_render_shell( '/wp/template-loader.php' );
	}

	public function test_prevent_canonical_redirect_returns_false_on_shell_routes(): void {
		set_query_var( 'cortext_shell', '1' );

		$this->assertFalse( ( new Shell() )->prevent_canonical_redirect( 'https://example.com/other/' ) );
	}

	public function test_prevent_canonical_redirect_passes_through_elsewhere(): void {
		set_query_var( 'cortext_shell', '' );

		$this->assertSame(
			'https://example.com/other/',
			( new Shell() )->prevent_canonical_redirect( 'https://example.com/other/' )
		);
	}

	public function test_enqueue_assets_is_noop_outside_shell_routes(): void {
		set_query_var( 'cortext_shell', '' );

		( new Shell() )->enqueue_assets();

		$this->assertFalse( wp_script_is( 'cortext-shell', 'enqueued' ) );
		$this->assertFalse( wp_script_is( 'cortext-shell', 'registered' ) );
	}

	public function test_enqueue_assets_is_noop_when_asset_manifest_missing(): void {
		set_query_var( 'cortext_shell', '1' );
		$this->assertFileDoesNotExist(
			CORTEXT_PATH . 'build/index.asset.php',
			'Test precondition: no build manifest should exist.'
		);

		( new Shell() )->enqueue_assets();

		$this->assertFalse( wp_script_is( 'cortext-shell', 'enqueued' ) );
	}

	public function test_enqueue_assets_registers_script_and_cortext_settings_on_shell_routes(): void {
		$this->create_asset_fixture();
		set_query_var( 'cortext_shell', '1' );

		( new Shell() )->enqueue_assets();

		$this->assertTrue(
			wp_script_is( 'cortext-shell', 'enqueued' ),
			'Shell script should be enqueued on shell routes.'
		);

		$inline = wp_scripts()->get_inline_script_data( 'cortext-shell', 'before' );
		$this->assertStringContainsString( 'window.cortextSettings', $inline );
		$this->assertStringContainsString( '"routePrefix":"cortext"', $inline );
		$this->assertStringContainsString( '"adminUrl"', $inline );
	}

	private function create_asset_fixture(): void {
		$build_dir  = CORTEXT_PATH . 'build';
		$asset_path = $build_dir . '/index.asset.php';

		if ( file_exists( $asset_path ) ) {
			return;
		}

		if ( ! is_dir( $build_dir ) ) {
			mkdir( $build_dir, 0755, true );
		}

		file_put_contents(
			$asset_path,
			"<?php return array( 'dependencies' => array(), 'version' => 'test' );\n"
		);
		$this->created_asset_fixture = true;
	}
}
