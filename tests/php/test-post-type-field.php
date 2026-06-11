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

	public function test_formula_expression_meta_is_readonly_in_core_rest(): void {
		$field_post_type = new Field();
		$field_post_type->register_post_type();

		wp_set_current_user( $this->create_user( 'editor' ) );
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Total',
				'meta_input'  => array(
					'type'                => 'formula',
					'expression'          => '1',
					'formula_result_type' => 'number',
					'formula_is_volatile' => '0',
				),
			)
		);

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		do_action( 'rest_api_init' );

		$request = new WP_REST_Request( 'PUT', "/wp/v2/crtxt_fields/{$field_id}" );
		$request->set_param( 'id', $field_id );
		$request->set_param( 'context', 'edit' );
		$request->set_param( 'meta', array( 'expression' => '2' ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '1', get_post_meta( $field_id, 'expression', true ) );
	}

	public function test_formula_expression_sanitizer_preserves_comparison_operators(): void {
		$field_post_type = new Field();
		$field_post_type->register_post_type();

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Comparison',
				'meta_input'  => array( 'type' => 'formula' ),
			)
		);

		update_post_meta( $field_id, 'expression', "field(\"A\") <= field(\"B\")\r\n" );

		$this->assertSame(
			'field("A") <= field("B")',
			get_post_meta( $field_id, 'expression', true )
		);
	}

	public function test_save_creates_field_with_direct_meta(): void {
		( new Field() )->register_post_type();

		$id = Field::save(
			array(
				'title'       => 'Author',
				'type'        => 'text',
				'description' => 'Book author',
			)
		);

		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		$this->assertSame( 'Author', get_post( $id )->post_title );
		$this->assertSame( 'text', get_post_meta( $id, 'type', true ) );
		$this->assertSame( 'Book author', get_post_meta( $id, 'description', true ) );
	}

	public function test_save_encodes_array_options_as_json(): void {
		( new Field() )->register_post_type();

		$id = Field::save(
			array(
				'title'   => 'Status',
				'type'    => 'select',
				'options' => array(
					array(
						'value' => 'open',
						'label' => 'Open',
						'color' => 'blue',
					),
					array(
						'value' => 'closed',
						'label' => 'Closed',
						'color' => 'red',
					),
				),
			)
		);

		$this->assertIsInt( $id );
		$stored  = get_post_meta( $id, 'options', true );
		$decoded = json_decode( $stored, true );
		$this->assertCount( 2, $decoded );
		$this->assertSame( 'open', $decoded[0]['value'] );
	}

	public function test_save_passes_string_options_through(): void {
		( new Field() )->register_post_type();

		$json = '[{"value":"x","label":"X"}]';
		$id   = Field::save(
			array(
				'title'   => 'Tag',
				'type'    => 'multiselect',
				'options' => $json,
			)
		);

		$this->assertIsInt( $id );
		$this->assertSame( $json, get_post_meta( $id, 'options', true ) );
	}

	public function test_save_maps_default_to_default_value_meta_key(): void {
		( new Field() )->register_post_type();

		$id = Field::save(
			array(
				'title'   => 'Status',
				'type'    => 'text',
				'default' => '{"mode":"value","value":"Draft"}',
			)
		);

		$this->assertIsInt( $id );
		$this->assertSame(
			'{"mode":"value","value":"Draft"}',
			get_post_meta( $id, 'default_value', true )
		);
	}

	public function test_save_merges_meta_escape_hatch(): void {
		( new Field() )->register_post_type();

		$id = Field::save(
			array(
				'title' => 'Author',
				'type'  => 'text',
				'meta'  => array( 'cortext_notion_property_id' => 'prop-uuid-1' ),
			)
		);

		$this->assertIsInt( $id );
		$this->assertSame(
			'prop-uuid-1',
			get_post_meta( $id, 'cortext_notion_property_id', true )
		);
	}

	public function test_save_updates_existing_field(): void {
		( new Field() )->register_post_type();

		$id = Field::save(
			array(
				'title' => 'Status',
				'type'  => 'text',
			)
		);
		$this->assertIsInt( $id );

		$updated = Field::save(
			array(
				'id'      => $id,
				'type'    => 'select',
				'options' => array( array( 'value' => 'open', 'label' => 'Open' ) ),
			)
		);

		$this->assertSame( $id, $updated );
		$this->assertSame( 'select', get_post_meta( $id, 'type', true ) );
		$this->assertNotEmpty( get_post_meta( $id, 'options', true ) );
	}

	public function test_save_returns_error_for_unknown_id(): void {
		( new Field() )->register_post_type();

		$result = Field::save(
			array(
				'id'   => 999_999,
				'type' => 'text',
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'cortext_field_not_found', $result->get_error_code() );
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
