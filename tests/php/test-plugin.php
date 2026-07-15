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
}
