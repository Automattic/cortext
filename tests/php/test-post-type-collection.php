<?php
/**
 * Tests for Cortext\PostType\Collection.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use WorDBless\BaseTestCase;

final class Test_Post_Type_Collection extends BaseTestCase {

	public function test_post_type_constant_matches_expected_slug(): void {
		$this->assertSame( 'crtxt_collection', Collection::POST_TYPE );
	}

	public function test_register_hooks_init_action(): void {
		remove_all_actions( 'init' );

		( new Collection() )->register();

		$this->assertNotFalse(
			has_action( 'init' ),
			'register_post_type callback should be hooked on init.'
		);
	}

	public function test_register_post_type_registers_crtxt_collection(): void {
		( new Collection() )->register_post_type();

		$this->assertTrue( post_type_exists( Collection::POST_TYPE ) );
	}

	public function test_registered_post_type_has_expected_properties(): void {
		( new Collection() )->register_post_type();

		$object = get_post_type_object( Collection::POST_TYPE );
		$this->assertNotNull( $object );

		$this->assertFalse( $object->hierarchical, 'crtxt_collection is not hierarchical.' );
		$this->assertTrue( $object->show_in_rest, 'crtxt_collection must be show_in_rest for @wordpress/core-data.' );
		$this->assertSame( 'crtxt_collections', $object->rest_base );
		$this->assertFalse( $object->public );
		$this->assertTrue( $object->show_ui );
		$this->assertFalse( $object->show_in_menu );
		$this->assertFalse( $object->publicly_queryable );
		$this->assertFalse( $object->has_archive );
	}

	public function test_registered_post_type_supports_expected_features(): void {
		( new Collection() )->register_post_type();

		$this->assertTrue( post_type_supports( Collection::POST_TYPE, 'title' ) );
		$this->assertTrue( post_type_supports( Collection::POST_TYPE, 'custom-fields' ) );
		$this->assertFalse( post_type_supports( Collection::POST_TYPE, 'editor' ), 'Collections are schema definitions, not documents.' );
	}

	public function test_meta_is_registered(): void {
		( new Collection() )->register_post_type();

		$registered = get_registered_meta_keys( 'post', Collection::POST_TYPE );

		$this->assertArrayHasKey( 'notion_id', $registered );
		$this->assertArrayHasKey( 'slug', $registered );
	}
}
