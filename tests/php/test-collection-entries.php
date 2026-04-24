<?php
/**
 * Tests for Cortext\PostType\CollectionEntries.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use WorDBless\BaseTestCase;

final class Test_Collection_Entries extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		// Ensure the definition CPTs exist so we can create posts.
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();
	}

	public function test_register_hooks_init_at_priority_20(): void {
		remove_all_actions( 'init' );

		$entries = new CollectionEntries();
		$entries->register();

		$this->assertSame(
			20,
			has_action( 'init', array( $entries, 'register_all' ) ),
			'register_all must hook at priority 20 so Collection and Field CPTs are already registered.'
		);
	}

	public function test_register_for_collection_creates_entry_cpt(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Venues',
				'meta_input'  => array( 'slug' => 'venues' ),
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$this->assertTrue( post_type_exists( 'crtxt_venues' ) );
	}

	public function test_entry_cpt_has_expected_properties(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Meetings',
				'meta_input'  => array( 'slug' => 'meetings' ),
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$object = get_post_type_object( 'crtxt_meetings' );
		$this->assertNotNull( $object );
		$this->assertFalse( $object->hierarchical );
		$this->assertTrue( $object->show_in_rest );
		$this->assertFalse( $object->public );
		$this->assertSame( 'crtxt_meetings', $object->rest_base );
	}

	public function test_notion_id_meta_is_registered_on_entry_cpt(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Tasks',
				'meta_input'  => array( 'slug' => 'tasks' ),
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$registered = get_registered_meta_keys( 'post', 'crtxt_tasks' );
		$this->assertArrayHasKey( 'notion_id', $registered );
	}

	public function test_field_meta_is_registered_on_entry_cpt(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Projects',
				'meta_input'  => array( 'slug' => 'projects' ),
			)
		);

		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Status',
				'meta_input'  => array( 'type' => 'select' ),
			)
		);

		// Attach field to collection via multi-value meta.
		add_post_meta( $collection_id, 'fields', $field_id );

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$registered = get_registered_meta_keys( 'post', 'crtxt_projects' );
		$this->assertArrayHasKey( "field-{$field_id}", $registered );
		$this->assertSame( 'string', $registered["field-{$field_id}"]['type'] );
		$this->assertTrue( $registered["field-{$field_id}"]['single'] );
	}

	public function test_multiselect_field_is_not_single(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Tags',
				'meta_input'  => array( 'slug' => 'tags' ),
			)
		);

		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Categories',
				'meta_input'  => array( 'type' => 'multiselect' ),
			)
		);

		add_post_meta( $collection_id, 'fields', $field_id );

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$registered = get_registered_meta_keys( 'post', 'crtxt_tags' );
		$this->assertArrayHasKey( "field-{$field_id}", $registered );
		$this->assertFalse( $registered["field-{$field_id}"]['single'] );
	}

	public function test_rejects_slug_exceeding_max_length(): void {
		$long_slug = str_repeat( 'a', CollectionEntries::MAX_SLUG_LEN + 1 );

		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Too Long',
				'meta_input'  => array( 'slug' => $long_slug ),
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$this->assertFalse(
			post_type_exists( CollectionEntries::CPT_PREFIX . $long_slug ),
			'Slugs exceeding the max length must not produce a CPT.'
		);
	}

	public function test_accepts_slug_at_max_length(): void {
		$max_slug = str_repeat( 'b', CollectionEntries::MAX_SLUG_LEN );

		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Just Right',
				'meta_input'  => array( 'slug' => $max_slug ),
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$this->assertTrue(
			post_type_exists( CollectionEntries::CPT_PREFIX . $max_slug ),
			'Slugs at exactly the max length should be accepted.'
		);
	}

	public function test_skips_collection_without_slug(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'No Slug',
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		// No CPT should have been registered; just ensure no error was thrown.
		$this->assertTrue( true );
	}

	public function test_wp_meta_type_for_returns_correct_types(): void {
		$this->assertSame( 'number', CollectionEntries::wp_meta_type_for( 'number' ) );
		$this->assertSame( 'boolean', CollectionEntries::wp_meta_type_for( 'checkbox' ) );
		$this->assertSame( 'string', CollectionEntries::wp_meta_type_for( 'text' ) );
		$this->assertSame( 'string', CollectionEntries::wp_meta_type_for( 'select' ) );
		$this->assertSame( 'string', CollectionEntries::wp_meta_type_for( 'date' ) );
		$this->assertSame( 'string', CollectionEntries::wp_meta_type_for( 'relation' ) );
	}
}
