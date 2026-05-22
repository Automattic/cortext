<?php
/**
 * Tests for the server-side data-view block registration.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Block\DataView;
use WP_Block_Type_Registry;
use WorDBless\BaseTestCase;

final class Test_Data_View_Block extends BaseTestCase {

	/**
	 * Doing-it-wrong notices captured while registering the block.
	 *
	 * @var string[]
	 */
	private array $doing_it_wrong_messages = array();

	public function set_up(): void {
		parent::set_up();

		$this->unregister_data_view_block();
		add_action( 'doing_it_wrong_run', array( $this, 'capture_doing_it_wrong' ), 10, 3 );
	}

	public function tear_down(): void {
		remove_action( 'doing_it_wrong_run', array( $this, 'capture_doing_it_wrong' ), 10 );
		$this->unregister_data_view_block();

		parent::tear_down();
	}

	public function test_register_block_uses_valid_metadata_when_build_is_missing(): void {
		( new DataView() )->register_block();

		$registry = WP_Block_Type_Registry::get_instance();
		$block    = $registry->get_registered( DataView::BLOCK_NAME );

		$this->assertSame( array(), $this->doing_it_wrong_messages );
		$this->assertNotFalse( $block );
		$this->assertSame( DataView::BLOCK_NAME, $block->name );
		$this->assertIsCallable( $block->render_callback );
	}

	public function capture_doing_it_wrong( string $function_name, string $message, string $version ): void {
		unset( $version );

		$this->doing_it_wrong_messages[] = "{$function_name}: {$message}";
	}

	private function unregister_data_view_block(): void {
		$registry = WP_Block_Type_Registry::get_instance();
		if ( $registry->is_registered( DataView::BLOCK_NAME ) ) {
			$registry->unregister( DataView::BLOCK_NAME );
		}
	}
}
