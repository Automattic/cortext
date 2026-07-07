<?php
/**
 * Tests for Cortext\Plugin.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Plugin;
use WorDBless\BaseTestCase;

final class Test_Plugin extends BaseTestCase {

	public function test_instance_is_idempotent(): void {
		$this->assertSame( Plugin::instance(), Plugin::instance() );
	}

	public function test_wordpress_minimum_matches_readme(): void {
		$root_dir = dirname( __DIR__, 2 );
		$plugin   = $this->read_project_file( $root_dir . '/cortext.php' );
		$readme   = $this->read_project_file( $root_dir . '/readme.txt' );

		preg_match( '/Requires at least:\s*([0-9.]+)/', $plugin, $plugin_matches );
		preg_match( '/Requires at least:\s*([0-9.]+)/', $readme, $readme_matches );

		$this->assertSame( '7.0', $plugin_matches[1] );
		$this->assertSame( $plugin_matches[1], $readme_matches[1] );
	}

	private function read_project_file( string $path ): string {
		$file     = new \SplFileObject( $path, 'r' );
		$contents = '';

		while ( ! $file->eof() ) {
			$contents .= $file->fgets();
		}

		return $contents;
	}
}
