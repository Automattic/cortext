<?php
/**
 * Tests for Cortext\PostType\Page.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Page;
use WorDBless\BaseTestCase;

final class Test_Post_Type_Page extends BaseTestCase {

	public function test_post_type_constant_matches_expected_slug(): void {
		$this->assertSame( 'crtxt_page', Page::POST_TYPE );
	}

	public function test_register_hooks_init_action(): void {
		remove_all_actions( 'init' );

		( new Page() )->register();

		$this->assertNotFalse(
			has_action( 'init' ),
			'register_post_type callback should be hooked on init.'
		);
	}

	public function test_register_post_type_registers_crtxt_page(): void {
		( new Page() )->register_post_type();

		$this->assertTrue( post_type_exists( Page::POST_TYPE ) );
	}

	public function test_registered_post_type_has_expected_properties(): void {
		( new Page() )->register_post_type();

		$object = get_post_type_object( Page::POST_TYPE );
		$this->assertNotNull( $object );

		$this->assertTrue( $object->hierarchical, 'crtxt_page must be hierarchical for the page tree.' );
		$this->assertTrue( $object->show_in_rest, 'crtxt_page must be show_in_rest for @wordpress/core-data.' );
		$this->assertSame( 'crtxt_pages', $object->rest_base, 'rest_base must match the JS resolver URL shape.' );
		$this->assertFalse( $object->public );
		$this->assertTrue( $object->show_ui, 'show_ui stays on so Admin\Screen\'s submenu can link to the core list table as an escape hatch.' );
		$this->assertFalse( $object->show_in_menu, 'show_in_menu is false because Admin\Screen owns the top-level menu.' );
		$this->assertFalse( $object->publicly_queryable );
		$this->assertTrue( $object->exclude_from_search );
		$this->assertFalse( $object->has_archive );
	}

	public function test_registered_post_type_supports_required_features(): void {
		( new Page() )->register_post_type();

		$this->assertTrue(
			post_type_supports( Page::POST_TYPE, 'revisions' ),
			'revisions support is load-bearing: RevisionThrottle filters only fire on post types that support revisions.'
		);
		$this->assertTrue( post_type_supports( Page::POST_TYPE, 'title' ) );
		$this->assertTrue( post_type_supports( Page::POST_TYPE, 'editor' ) );
		$this->assertTrue( post_type_supports( Page::POST_TYPE, 'page-attributes' ) );
	}
}
