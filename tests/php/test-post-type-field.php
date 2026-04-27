<?php
/**
 * Tests for Cortext\PostType\Field.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Field;
use WorDBless\BaseTestCase;

final class Test_Post_Type_Field extends BaseTestCase {

	public function test_post_type_constant_matches_expected_slug(): void {
		$this->assertSame( 'crtxt_field', Field::POST_TYPE );
	}

	public function test_register_hooks_init_action(): void {
		remove_all_actions( 'init' );

		( new Field() )->register();

		$this->assertNotFalse(
			has_action( 'init' ),
			'register_post_type callback should be hooked on init.'
		);
	}

	public function test_register_post_type_registers_crtxt_field(): void {
		( new Field() )->register_post_type();

		$this->assertTrue( post_type_exists( Field::POST_TYPE ) );
	}

	public function test_registered_post_type_has_expected_properties(): void {
		( new Field() )->register_post_type();

		$object = get_post_type_object( Field::POST_TYPE );
		$this->assertNotNull( $object );

		$this->assertFalse( $object->hierarchical );
		$this->assertTrue( $object->show_in_rest );
		$this->assertSame( 'crtxt_fields', $object->rest_base );
		$this->assertFalse( $object->public );
		$this->assertTrue( $object->show_ui );
		$this->assertFalse( $object->show_in_menu );
		$this->assertFalse( $object->publicly_queryable );
		$this->assertFalse( $object->has_archive );
	}

	public function test_registered_post_type_supports_expected_features(): void {
		( new Field() )->register_post_type();

		$this->assertTrue( post_type_supports( Field::POST_TYPE, 'title' ) );
		$this->assertTrue( post_type_supports( Field::POST_TYPE, 'custom-fields' ) );
		$this->assertFalse( post_type_supports( Field::POST_TYPE, 'editor' ) );
	}

	public function test_string_meta_is_registered(): void {
		( new Field() )->register_post_type();

		$registered = get_registered_meta_keys( 'post', Field::POST_TYPE );

		$this->assertArrayHasKey( 'notion_id', $registered );
		$this->assertArrayHasKey( 'type', $registered );
		$this->assertArrayHasKey( 'options', $registered );
		$this->assertArrayHasKey( 'number_format', $registered );
		$this->assertArrayHasKey( 'expression', $registered );
	}

	public function test_integer_meta_is_registered(): void {
		( new Field() )->register_post_type();

		$registered = get_registered_meta_keys( 'post', Field::POST_TYPE );

		$this->assertArrayHasKey( 'related_collection_id', $registered );
		$this->assertSame( 'integer', $registered['related_collection_id']['type'] );
	}
}
