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
use WP_REST_Request;
use WP_REST_Server;

final class Test_Post_Type_Field extends BaseTestCase {

	public function tear_down(): void {
		wp_set_current_user( 0 );

		parent::tear_down();
	}

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

		$this->assertArrayHasKey( 'type', $registered );
		$this->assertArrayHasKey( 'options', $registered );
		$this->assertArrayHasKey( 'description', $registered );
		$this->assertArrayHasKey( 'default_value', $registered );
		$this->assertArrayHasKey( 'number_format', $registered );
		$this->assertArrayHasKey( 'expression', $registered );
	}

	public function test_integer_meta_is_registered(): void {
		( new Field() )->register_post_type();

		$registered = get_registered_meta_keys( 'post', Field::POST_TYPE );

		$this->assertArrayHasKey( 'related_collection_id', $registered );
		$this->assertSame( 'integer', $registered['related_collection_id']['type'] );
	}

	public function test_rest_response_includes_cortext_capabilities(): void {
		$field_post_type = new Field();
		$field_post_type->register_post_type();

		wp_set_current_user( $this->create_user( 'editor' ) );
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Status',
				'meta_input'  => array( 'type' => 'select' ),
			)
		);

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		do_action( 'rest_api_init' );

		$request = new WP_REST_Request( 'GET', "/wp/v2/crtxt_fields/{$field_id}" );
		$request->set_param( 'context', 'edit' );
		$response = rest_get_server()->dispatch( $request );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'sortable'   => true,
				'filterable' => true,
				'operators'  => array( 'is', 'isNot', 'isAny', 'isNone' ),
			),
			$data['cortext_capabilities']
		);
	}

	public function test_rest_response_exposes_sanitized_description_and_default(): void {
		$field_post_type = new Field();
		$field_post_type->register_post_type();

		wp_set_current_user( $this->create_user( 'editor' ) );
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Status',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		update_post_meta( $field_id, 'description', "Use <b>plain</b> text.\nSecond line." );
		update_post_meta( $field_id, 'default_value', '{"mode":"value","value":"<b>Draft</b>"}' );

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		do_action( 'rest_api_init' );

		$request = new WP_REST_Request( 'GET', "/wp/v2/crtxt_fields/{$field_id}" );
		$request->set_param( 'context', 'edit' );
		$response = rest_get_server()->dispatch( $request );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( "Use plain text.\nSecond line.", $data['meta']['description'] );
		$this->assertSame(
			'{"mode":"value","value":"Draft"}',
			$data['meta']['default_value']
		);
	}

	private function create_user( string $role ): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_', false ),
				'user_pass'  => 'password',
				'role'       => $role,
			)
		);
	}
}
