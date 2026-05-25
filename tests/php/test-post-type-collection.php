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

		$this->assertTrue(
			$object->hierarchical,
			'crtxt_collection needs hierarchy so full-page collections can use parent/menu_order in the sidebar.'
		);
		$this->assertTrue( $object->show_in_rest, 'crtxt_collection must be show_in_rest for @wordpress/core-data.' );
		$this->assertSame( 'crtxt_collections', $object->rest_base );
		$this->assertFalse( $object->public );
		$this->assertTrue( $object->show_ui );
		$this->assertFalse( $object->show_in_menu );
		$this->assertTrue(
			$object->publicly_queryable,
			'Published full-page collections should render at public URLs.'
		);
		$this->assertFalse( $object->has_archive );
	}

	public function test_registered_post_type_supports_expected_features(): void {
		( new Collection() )->register_post_type();

		$this->assertTrue( post_type_supports( Collection::POST_TYPE, 'title' ) );
		$this->assertTrue( post_type_supports( Collection::POST_TYPE, 'custom-fields' ) );
		$this->assertTrue(
			post_type_supports( Collection::POST_TYPE, 'page-attributes' ),
			'page-attributes exposes parent/menu_order for sidebar nesting and drag/drop.'
		);
		$this->assertTrue(
			post_type_supports( Collection::POST_TYPE, 'editor' ),
			'Full-page collections use Canvas, with a locked data-view block as the body.'
		);
		$this->assertTrue(
			post_type_supports( Collection::POST_TYPE, 'thumbnail' ),
			'Collections share the same cover flow as pages.'
		);
		$this->assertTrue( post_type_supports( Collection::POST_TYPE, 'revisions' ) );
	}

	public function test_collections_opt_into_document_lifecycle(): void {
		( new Collection() )->register_post_type();

		$this->assertTrue(
			post_type_supports( Collection::POST_TYPE, 'cortext-document' ),
			'Collections share the document lifecycle (title, identity, trash, restore, search).'
		);
	}

	public function test_meta_is_registered(): void {
		( new Collection() )->register_post_type();

		$registered = get_registered_meta_keys( 'post', Collection::POST_TYPE );

		$this->assertArrayHasKey( 'slug', $registered );
		$this->assertArrayHasKey( 'fields', $registered );
		$this->assertArrayHasKey( Collection::DETAIL_LAYOUT_META_KEY, $registered );
		$this->assertSame( 'object', $registered[ Collection::DETAIL_LAYOUT_META_KEY ]['type'] );
		$this->assertTrue( $registered[ Collection::DETAIL_LAYOUT_META_KEY ]['single'] );
	}

	public function test_sanitize_detail_layout_keeps_order_and_supported_ids(): void {
		$layout = Collection::sanitize_detail_layout(
			array(
				'fields' => array(
					array(
						'field'   => 'field-12',
						'visible' => true,
					),
					array(
						'field'   => 'created_at',
						'visible' => false,
					),
					array(
						'field'   => 'field-12',
						'visible' => false,
					),
					array(
						'field'   => 'title',
						'visible' => true,
					),
					array(
						'field'   => 'field-0',
						'visible' => true,
					),
					array(
						'field' => 'modified_by',
					),
				),
			)
		);

		$this->assertSame(
			array(
				'fields' => array(
					array(
						'field'   => 'field-12',
						'visible' => true,
					),
					array(
						'field'   => 'created_at',
						'visible' => false,
					),
					array(
						'field'   => 'modified_by',
						'visible' => true,
					),
				),
			),
			$layout
		);
	}

	public function test_sanitize_detail_layout_allows_explicit_empty_layout(): void {
		$this->assertSame(
			array( 'fields' => array() ),
			Collection::sanitize_detail_layout( array( 'fields' => array() ) )
		);
		$this->assertSame(
			array( 'fields' => array() ),
			Collection::sanitize_detail_layout( 'not an object' )
		);
	}
}
