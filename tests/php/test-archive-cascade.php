<?php
/**
 * Tests for archive and restore cascades.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Documents;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;

final class Test_Archive_Cascade extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private ArchiveCascade $archive_cascade;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		( new Field() )->register_post_type();

		remove_all_actions( 'transition_post_status' );
		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_actions( 'before_delete_post' );
		remove_all_filters( 'wp_untrash_post_status' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );

		$this->archive_cascade = new ArchiveCascade();
		$this->archive_cascade->register_status();
		$this->archive_cascade->register_meta();
		$this->archive_cascade->register();
		( new TrashCascade() )->register();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_registers_archived_status_as_protected_and_searchable(): void {
		$status = get_post_status_object( Documents::STATUS_ARCHIVED );

		$this->assertNotNull( $status );
		$this->assertSame( 'Archived', $status->label );
		$this->assertFalse( $status->internal );
		$this->assertFalse( $status->public );
		$this->assertTrue( $status->protected );
		$this->assertFalse( $status->exclude_from_search );
		$this->assertFalse( $status->show_in_admin_all_list );
		$this->assertTrue( $status->show_in_admin_status_list );
	}

	public function test_archives_page_tree_and_restores_original_statuses(): void {
		$parent_id     = $this->create_page( array( 'post_status' => 'private' ) );
		$child_id      = $this->create_page(
			array(
				'post_parent' => $parent_id,
				'post_status' => 'publish',
			)
		);
		$grandchild_id = $this->create_page(
			array(
				'post_parent' => $child_id,
				'post_status' => 'draft',
			)
		);

		$archived = $this->archive_cascade->archive( $parent_id );

		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id, $grandchild_id ), $archived );
		foreach ( array( $parent_id, $child_id, $grandchild_id ) as $post_id ) {
			$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $post_id ) );
			$this->assertGreaterThan( 0, (int) get_post_meta( $post_id, ArchiveCascade::TIME_META, true ) );
		}
		$this->assertSame( 'private', get_post_meta( $parent_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( 'publish', get_post_meta( $child_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( 'draft', get_post_meta( $grandchild_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $child_id, ArchiveCascade::PARENT_MARKER_META, true ) );
		$this->assertSame( (string) $child_id, (string) get_post_meta( $grandchild_id, ArchiveCascade::PARENT_MARKER_META, true ) );

		$restored = $this->archive_cascade->unarchive( $parent_id );

		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id, $grandchild_id ), $restored );
		$this->assertSame( 'private', get_post_status( $parent_id ) );
		$this->assertSame( 'publish', get_post_status( $child_id ) );
		$this->assertSame( 'draft', get_post_status( $grandchild_id ) );
		foreach ( array( $parent_id, $child_id, $grandchild_id ) as $post_id ) {
			$this->assertSame( '', (string) get_post_meta( $post_id, ArchiveCascade::STATUS_META, true ) );
			$this->assertSame( '', (string) get_post_meta( $post_id, ArchiveCascade::TIME_META, true ) );
			$this->assertSame( '', (string) get_post_meta( $post_id, ArchiveCascade::PARENT_MARKER_META, true ) );
		}
	}

	public function test_archives_collection_rows_and_restores_original_statuses(): void {
		$collection_id = $this->create_collection();
		$published_row = $this->create_row( $collection_id, 'publish' );
		$draft_row     = $this->create_row( $collection_id, 'draft' );

		$archived = $this->archive_cascade->archive( $collection_id );

		$this->assertEqualsCanonicalizing( array( $collection_id, $published_row, $draft_row ), $archived );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $published_row ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $draft_row ) );
		$this->assertSame( 'publish', get_post_meta( $published_row, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( 'draft', get_post_meta( $draft_row, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( (string) $collection_id, (string) get_post_meta( $published_row, ArchiveCascade::COLLECTION_MARKER_META, true ) );
		$this->assertSame( (string) $collection_id, (string) get_post_meta( $draft_row, ArchiveCascade::COLLECTION_MARKER_META, true ) );

		$this->archive_cascade->unarchive( $collection_id );

		$this->assertSame( 'private', get_post_status( $collection_id ) );
		$this->assertSame( 'publish', get_post_status( $published_row ) );
		$this->assertSame( 'draft', get_post_status( $draft_row ) );
		$this->assertSame( '', (string) get_post_meta( $published_row, ArchiveCascade::COLLECTION_MARKER_META, true ) );
		$this->assertSame( '', (string) get_post_meta( $draft_row, ArchiveCascade::COLLECTION_MARKER_META, true ) );
	}

	public function test_pre_archived_row_is_not_restored_with_collection(): void {
		$collection_id = $this->create_collection();
		$pre_archived  = $this->create_row( $collection_id, 'private' );
		$cascaded_row  = $this->create_row( $collection_id, 'private' );
		$first_archive = $this->archive_cascade->archive( $pre_archived );

		$this->assertSame( array( $pre_archived ), $first_archive );
		$this->archive_cascade->archive( $collection_id );
		$this->assertSame( '', (string) get_post_meta( $pre_archived, ArchiveCascade::COLLECTION_MARKER_META, true ) );
		$this->assertSame( (string) $collection_id, (string) get_post_meta( $cascaded_row, ArchiveCascade::COLLECTION_MARKER_META, true ) );

		$this->archive_cascade->unarchive( $collection_id );

		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $pre_archived ) );
		$this->assertSame( 'private', get_post_status( $cascaded_row ) );
	}

	public function test_original_statuses_survive_archive_trash_restore_and_unarchive(): void {
		$collection_id = $this->create_collection();
		$row_id        = $this->create_row( $collection_id, 'publish' );

		$this->archive_cascade->archive( $collection_id );
		wp_trash_post( $collection_id );

		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $collection_id ) );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $row_id ) );
		$this->assertSame( 'private', get_post_meta( $collection_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( 'publish', get_post_meta( $row_id, ArchiveCascade::STATUS_META, true ) );

		wp_untrash_post( $collection_id );

		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $collection_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $row_id ) );

		$restored = $this->archive_cascade->unarchive( $collection_id );

		$this->assertEqualsCanonicalizing( array( $collection_id, $row_id ), $restored );
		$this->assertSame( 'private', get_post_status( $collection_id ) );
		$this->assertSame( 'publish', get_post_status( $row_id ) );
	}

	public function test_updating_status_cannot_archive_a_trashed_document(): void {
		$post_id = $this->create_page();
		wp_trash_post( $post_id );
		$trashed_slug = (string) get_post_field( 'post_name', $post_id, 'raw' );
		$desired_slug = (string) get_post_meta( $post_id, '_wp_desired_post_slug', true );

		$result = wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => Documents::STATUS_ARCHIVED,
			),
			true
		);

		$this->assertSame( $post_id, $result );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $post_id ) );
		$this->assertSame( $trashed_slug, get_post_field( 'post_name', $post_id, 'raw' ) );
		$this->assertSame( $desired_slug, get_post_meta( $post_id, '_wp_desired_post_slug', true ) );
		$this->assertSame( 'publish', get_post_meta( $post_id, '_wp_trash_meta_status', true ) );
		$this->assertGreaterThan( 0, (int) get_post_meta( $post_id, '_wp_trash_meta_time', true ) );
		$this->assertSame( '', (string) get_post_meta( $post_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( '', (string) get_post_meta( $post_id, ArchiveCascade::TIME_META, true ) );
	}

	public function test_force_deleting_collection_removes_archived_rows(): void {
		$collection_id = $this->create_collection();
		$archived_row  = $this->create_row( $collection_id, 'private' );
		$active_row    = $this->create_row( $collection_id, 'private' );
		$this->archive_cascade->archive( $archived_row );

		wp_delete_post( $collection_id, true );

		$this->assertNull( get_post( $collection_id ) );
		$this->assertNull( get_post( $archived_row ) );
		$this->assertNull( get_post( $active_row ) );
	}

	public function test_relation_can_target_an_archived_row(): void {
		$source_collection = $this->create_collection();
		$target_collection = $this->create_collection();
		$source_row        = $this->create_row( $source_collection, 'private' );
		$target_row        = $this->create_row( $target_collection, 'private' );
		$forward_field     = $this->create_relation_field( $source_collection, $target_collection );
		$reverse_field     = $this->create_relation_field( $target_collection, $source_collection );

		update_post_meta( $forward_field, 'relation_reverse_field_id', (string) $reverse_field );
		update_post_meta( $reverse_field, 'relation_reverse_field_id', (string) $forward_field );
		$this->archive_cascade->archive( $target_row );

		$result = Relations::sync_relation_value( $source_row, $forward_field, array( $target_row ) );

		$this->assertTrue( $result );
		$this->assertSame(
			array( $target_row ),
			Relations::relation_values( $source_row, $forward_field )
		);
	}

	private function create_page( array $args = array() ): int {
		$id = wp_insert_post(
			array_merge(
				array(
					'post_type'   => Document::POST_TYPE,
					'post_status' => 'publish',
					'post_title'  => 'Page ' . wp_generate_uuid4(),
				),
				$args
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		return (int) $id;
	}

	private function create_collection(): int {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . wp_generate_uuid4(),
			)
		);
		$this->assertGreaterThan( 0, $collection_id );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Title',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		return $collection_id;
	}

	private function create_row( int $collection_id, string $status ): int {
		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => $status,
				'post_title'  => 'Row ' . wp_generate_uuid4(),
			)
		);
		$this->assertGreaterThan( 0, $row_id );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

		return $row_id;
	}

	private function create_relation_field( int $collection_id, int $target_collection_id ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Relation ' . wp_generate_uuid4(),
				'meta_input'  => array(
					'type'                  => 'relation',
					'related_collection_id' => (string) $target_collection_id,
					'relation_multiple'     => '1',
				),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		return $field_id;
	}
}
