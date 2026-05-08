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
use Cortext\Relations;
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
				'post_status' => 'private',
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
				'post_status' => 'private',
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

	public function test_field_meta_is_registered_on_entry_cpt(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Projects',
				'meta_input'  => array( 'slug' => 'projects' ),
			)
		);

		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
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
				'post_status' => 'private',
				'post_title'  => 'Tags',
				'meta_input'  => array( 'slug' => 'tags' ),
			)
		);

		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
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

	public function test_relation_field_single_meta_follows_relation_cardinality(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Tasks',
				'meta_input'  => array( 'slug' => 'relmeta' ),
			)
		);

		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Assignee',
				'meta_input'  => array(
					'type'              => 'relation',
					'relation_multiple' => '0',
				),
			)
		);

		add_post_meta( $collection_id, 'fields', $field_id );

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$registered = get_registered_meta_keys( 'post', 'crtxt_relmeta' );
		$this->assertArrayHasKey( "field-{$field_id}", $registered );
		$this->assertTrue( $registered["field-{$field_id}"]['single'] );
	}

	public function test_rejects_slug_exceeding_max_length(): void {
		$max_slug_len = CollectionEntries::MAX_CPT_LEN - strlen( CollectionEntries::CPT_PREFIX );
		$long_slug    = str_repeat( 'a', $max_slug_len + 1 );

		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
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

	public function test_rejects_reserved_static_cpt_slug(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Reserved',
				'meta_input'  => array( 'slug' => 'page' ),
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$this->assertFalse(
			post_type_exists( 'crtxt_page' ),
			'Reserved slugs must not produce dynamic CPTs that collide with static CPTs.'
		);
	}

	public function test_rejects_reserved_static_rest_base_slug(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Reserved Rest Base',
				'meta_input'  => array( 'slug' => 'pages' ),
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$this->assertFalse(
			post_type_exists( 'crtxt_pages' ),
			'Reserved slugs must not produce dynamic CPTs that collide with static REST bases.'
		);
	}

	public function test_accepts_slug_at_max_length(): void {
		$max_slug_len = CollectionEntries::MAX_CPT_LEN - strlen( CollectionEntries::CPT_PREFIX );
		$max_slug     = str_repeat( 'b', $max_slug_len );

		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
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
				'post_status' => 'private',
				'post_title'  => 'No Slug',
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		// No CPT should have been registered; just ensure no error was thrown.
		$this->assertTrue( true );
	}

	public function test_record_modified_by_writes_meta_on_entry_save(): void {
		$user_id = wp_insert_user(
			array(
				'user_login' => 'mb_user',
				'user_pass'  => 'password',
				'role'       => 'editor',
			)
		);
		wp_set_current_user( $user_id );

		$entries = new CollectionEntries();
		$entries->register();

		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Logs',
				'meta_input'  => array( 'slug' => 'logs' ),
			)
		);
		$entries->register_for_collection( get_post( $collection_id ) );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_logs',
				'post_status' => 'publish',
				'post_title'  => 'A log',
			)
		);

		$this->assertSame( (int) $user_id, (int) get_post_meta( $post_id, '_modified_by', true ) );

		wp_set_current_user( 0 );
	}

	public function test_record_modified_by_skips_when_no_user(): void {
		wp_set_current_user( 0 );

		$entries = new CollectionEntries();
		$entries->register();

		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Cron',
				'meta_input'  => array( 'slug' => 'cron' ),
			)
		);
		$entries->register_for_collection( get_post( $collection_id ) );

		// First save records a real user.
		$author_id = wp_insert_user(
			array(
				'user_login' => 'mb_author',
				'user_pass'  => 'password',
				'role'       => 'author',
			)
		);
		wp_set_current_user( $author_id );

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_cron',
				'post_status' => 'publish',
				'post_title'  => 'Recorded',
			)
		);

		$this->assertSame( (int) $author_id, (int) get_post_meta( $post_id, '_modified_by', true ) );

		// Subsequent unauthenticated save (CLI / cron) must not clobber the
		// last real editor with `0`.
		wp_set_current_user( 0 );
		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Updated by cron',
			)
		);

		$this->assertSame(
			(int) $author_id,
			(int) get_post_meta( $post_id, '_modified_by', true ),
			'Unauthenticated saves must leave _modified_by intact.'
		);
	}

	public function test_record_modified_by_ignores_non_entry_post_types(): void {
		$user_id = wp_insert_user(
			array(
				'user_login' => 'mb_skip',
				'user_pass'  => 'password',
				'role'       => 'editor',
			)
		);
		wp_set_current_user( $user_id );

		$entries = new CollectionEntries();
		$entries->register();

		// Saving a Collection or Field post must not record _modified_by:
		// they aren't entry CPTs.
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Container',
				'meta_input'  => array( 'slug' => 'container' ),
			)
		);
		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Some field',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);

		$this->assertSame( '', get_post_meta( $collection_id, '_modified_by', true ) );
		$this->assertSame( '', get_post_meta( $field_id, '_modified_by', true ) );

		wp_set_current_user( 0 );
	}

	public function test_wp_meta_type_for_returns_correct_types(): void {
		$this->assertSame( 'number', CollectionEntries::wp_meta_type_for( 'number' ) );
		$this->assertSame( 'boolean', CollectionEntries::wp_meta_type_for( 'checkbox' ) );
		$this->assertSame( 'string', CollectionEntries::wp_meta_type_for( 'text' ) );
		$this->assertSame( 'string', CollectionEntries::wp_meta_type_for( 'select' ) );
		$this->assertSame( 'string', CollectionEntries::wp_meta_type_for( 'date' ) );
		$this->assertSame( 'string', CollectionEntries::wp_meta_type_for( 'relation' ) );
	}

	public function test_get_entry_post_types_excludes_utility_cpts(): void {
		$entries       = new CollectionEntries();
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Bookmarks',
				'meta_input'  => array( 'slug' => 'bookmarks' ),
			)
		);
		$entries->register_for_collection( get_post( $collection_id ) );

		$result = CollectionEntries::get_entry_post_types();

		$this->assertContains( 'crtxt_bookmarks', $result );
		$this->assertNotContains( Collection::POST_TYPE, $result );
		$this->assertNotContains( Field::POST_TYPE, $result );
	}

	public function test_field_delete_clears_entry_field_meta(): void {
		$entries       = new CollectionEntries();
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Posts To Read',
				'meta_input'  => array( 'slug' => 'reads' ),
			)
		);
		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Status',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );

		$entries->register_for_collection( get_post( $collection_id ) );
		$entries->register();

		$entry_a = wp_insert_post(
			array(
				'post_type'   => 'crtxt_reads',
				'post_status' => 'publish',
				'post_title'  => 'Entry A',
			)
		);
		$entry_b = wp_insert_post(
			array(
				'post_type'   => 'crtxt_reads',
				'post_status' => 'publish',
				'post_title'  => 'Entry B',
			)
		);
		update_post_meta( $entry_a, "field-{$field_id}", 'reading' );
		update_post_meta( $entry_b, "field-{$field_id}", 'done' );

		wp_delete_post( $field_id, true );

		$this->assertSame( '', get_post_meta( $entry_a, "field-{$field_id}", true ) );
		$this->assertSame( '', get_post_meta( $entry_b, "field-{$field_id}", true ) );
	}

	public function test_field_delete_keeps_unrelated_field_meta_on_other_entries(): void {
		$entries       = new CollectionEntries();
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Items',
				'meta_input'  => array( 'slug' => 'items' ),
			)
		);
		$field_a = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'A',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		$field_b = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'B',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_a );
		add_post_meta( $collection_id, 'fields', (string) $field_b );
		$entries->register_for_collection( get_post( $collection_id ) );
		$entries->register();

		$entry_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_items',
				'post_status' => 'publish',
				'post_title'  => 'Entry',
			)
		);
		update_post_meta( $entry_id, "field-{$field_a}", 'value-a' );
		update_post_meta( $entry_id, "field-{$field_b}", 'value-b' );

		wp_delete_post( $field_a, true );

		$this->assertSame( '', get_post_meta( $entry_id, "field-{$field_a}", true ) );
		$this->assertSame(
			'value-b',
			get_post_meta( $entry_id, "field-{$field_b}", true ),
			'Other field meta on the same entry must be left alone.'
		);
	}

	public function test_relation_field_delete_deletes_pair_and_clears_both_sides(): void {
		$entries       = new CollectionEntries();
		$tasks_id      = $this->create_collection_with_slug( 'Tasks', 'tasks-del' );
		$people_id     = $this->create_collection_with_slug( 'People', 'people-del' );
		$source_id     = $this->create_relation_field( $tasks_id, $people_id, 'Person' );
		$reverse_id    = $this->create_relation_field( $people_id, $tasks_id, 'Tasks' );
		update_post_meta( $source_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $source_id );

		$entries->register_for_collection( get_post( $tasks_id ) );
		$entries->register_for_collection( get_post( $people_id ) );
		$entries->register();

		$task_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_tasks-del',
				'post_status' => 'publish',
				'post_title'  => 'Task',
			)
		);
		$person_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_people-del',
				'post_status' => 'publish',
				'post_title'  => 'Person',
			)
		);
		add_post_meta( $task_id, Relations::meta_key( $source_id ), (string) $person_id );
		add_post_meta( $person_id, Relations::meta_key( $reverse_id ), (string) $task_id );

		wp_delete_post( $source_id, true );

		$this->assertNull( get_post( $source_id ) );
		$this->assertNull( get_post( $reverse_id ) );
		$this->assertSame( array(), get_post_meta( $task_id, Relations::meta_key( $source_id ), false ) );
		$this->assertSame( array(), get_post_meta( $person_id, Relations::meta_key( $reverse_id ), false ) );
		$this->assertNotContains(
			(string) $source_id,
			get_post_meta( $tasks_id, 'fields', false )
		);
		$this->assertNotContains(
			(string) $reverse_id,
			get_post_meta( $people_id, 'fields', false )
		);
	}

	public function test_field_delete_deletes_dependent_rollups(): void {
		$entries     = new CollectionEntries();
		$projects_id = $this->create_collection_with_slug( 'Projects', 'projects-roll-del' );
		$invoices_id = $this->create_collection_with_slug( 'Invoices', 'invoices-roll-del' );
		$relation_id = $this->create_relation_field( $projects_id, $invoices_id, 'Invoices' );
		$reverse_id  = $this->create_relation_field( $invoices_id, $projects_id, 'Projects' );
		$amount_id   = $this->create_field( $invoices_id, 'Amount', 'number' );
		$rollup_id   = $this->create_field(
			$projects_id,
			'Total',
			'rollup',
			array(
				'rollup_relation_field_id' => (string) $relation_id,
				'rollup_target_field_id'   => (string) $amount_id,
				'rollup_aggregator'        => 'sum',
			)
		);
		update_post_meta( $relation_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $relation_id );

		$entries->register_for_collection( get_post( $projects_id ) );
		$entries->register_for_collection( get_post( $invoices_id ) );
		$entries->register();

		wp_delete_post( $relation_id, true );

		$this->assertNull( get_post( $rollup_id ) );
		$this->assertNotContains(
			(string) $rollup_id,
			get_post_meta( $projects_id, 'fields', false )
		);
	}

	public function test_target_field_delete_deletes_dependent_rollups(): void {
		$entries     = new CollectionEntries();
		$projects_id = $this->create_collection_with_slug( 'Projects', 'prj-target' );
		$invoices_id = $this->create_collection_with_slug( 'Invoices', 'inv-target' );
		$relation_id = $this->create_relation_field( $projects_id, $invoices_id, 'Invoices' );
		$reverse_id  = $this->create_relation_field( $invoices_id, $projects_id, 'Projects' );
		$amount_id   = $this->create_field( $invoices_id, 'Amount', 'number' );
		$rollup_id   = $this->create_field(
			$projects_id,
			'Total',
			'rollup',
			array(
				'rollup_relation_field_id' => (string) $relation_id,
				'rollup_target_field_id'   => (string) $amount_id,
				'rollup_aggregator'        => 'sum',
			)
		);
		update_post_meta( $relation_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $relation_id );

		$entries->register_for_collection( get_post( $projects_id ) );
		$entries->register_for_collection( get_post( $invoices_id ) );
		$entries->register();

		wp_delete_post( $amount_id, true );

		$this->assertNull( get_post( $rollup_id ) );
		$this->assertNotContains(
			(string) $rollup_id,
			get_post_meta( $projects_id, 'fields', false )
		);
	}

	public function test_entry_delete_removes_stale_reverse_relation_references(): void {
		$entries       = new CollectionEntries();
		$tasks_id      = $this->create_collection_with_slug( 'Tasks', 'tasks-rdel' );
		$people_id     = $this->create_collection_with_slug( 'People', 'people-rdel' );
		$source_id     = $this->create_relation_field( $tasks_id, $people_id, 'Person' );
		$reverse_id    = $this->create_relation_field( $people_id, $tasks_id, 'Tasks' );
		update_post_meta( $source_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $source_id );

		$entries->register_for_collection( get_post( $tasks_id ) );
		$entries->register_for_collection( get_post( $people_id ) );
		$entries->register();

		$task_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_tasks-rdel',
				'post_status' => 'publish',
				'post_title'  => 'Task',
			)
		);
		$person_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_people-rdel',
				'post_status' => 'publish',
				'post_title'  => 'Person',
			)
		);
		add_post_meta( $task_id, Relations::meta_key( $source_id ), (string) $person_id );
		add_post_meta( $person_id, Relations::meta_key( $reverse_id ), (string) $task_id );

		wp_delete_post( $task_id, true );

		$this->assertSame( array(), get_post_meta( $person_id, Relations::meta_key( $reverse_id ), false ) );
	}

	public function test_non_field_delete_skips_entry_meta_cleanup(): void {
		$entries       = new CollectionEntries();
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Skip Test',
				'meta_input'  => array( 'slug' => 'skip' ),
			)
		);
		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Stays Attached',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		$entries->register_for_collection( get_post( $collection_id ) );
		$entries->register();

		$entry_id = wp_insert_post(
			array(
				'post_type'   => 'crtxt_skip',
				'post_status' => 'publish',
				'post_title'  => 'Entry',
			)
		);
		update_post_meta( $entry_id, "field-{$field_id}", 'preserved' );

		// Deleting an unrelated post must not run the field cleanup.
		$unrelated_post_id = wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Decoy',
			)
		);
		wp_delete_post( $unrelated_post_id, true );

		$this->assertSame(
			'preserved',
			get_post_meta( $entry_id, "field-{$field_id}", true )
		);
	}

	private function create_collection_with_slug( string $title, string $slug ): int {
		return (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'slug' => $slug ),
			)
		);
	}

	private function create_relation_field( int $collection_id, int $target_collection_id, string $title ): int {
		return $this->create_field(
			$collection_id,
			$title,
			'relation',
			array(
				'related_collection_id' => (string) $target_collection_id,
				'relation_multiple'     => '1',
			)
		);
	}

	private function create_field( int $collection_id, string $title, string $type, array $meta = array() ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array_merge( array( 'type' => $type ), $meta ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );

		return $field_id;
	}
}
