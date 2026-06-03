<?php
/**
 * Tests for the collection-to-row leg of Cortext\PostType\TrashCascade.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;

final class Test_Row_Trash_Cascade extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_actions( 'before_delete_post' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		( new TrashCascade() )->register();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		parent::tear_down();
	}

	public function test_register_hooks_trash_untrash_and_delete_actions(): void {
		$this->assertNotFalse( has_action( 'wp_trash_post' ) );
		$this->assertNotFalse( has_action( 'untrashed_post' ) );
		$this->assertNotFalse( has_action( 'before_delete_post' ) );
	}

	public function test_trashing_collection_trashes_its_rows_and_stamps_marker(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 3 );

		wp_trash_post( $collection_id );

		foreach ( $row_ids as $row_id ) {
			$this->assertSame( 'trash', get_post_status( $row_id ) );
			$this->assertSame(
				(string) $collection_id,
				(string) get_post_meta( $row_id, TrashCascade::COLLECTION_MARKER_META, true ),
				'Each row trashed by the cascade carries the collection id as its owner marker.'
			);
		}
	}

	public function test_restoring_collection_revives_only_rows_its_cascade_trashed(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 2 );
		$independently_trashed       = $this->create_row_for_collection( $collection_id );

		// Trash one row independently. It carries no marker.
		wp_trash_post( $independently_trashed );

		wp_trash_post( $collection_id );
		wp_untrash_post( $collection_id );

		foreach ( $row_ids as $row_id ) {
			$this->assertNotSame( 'trash', get_post_status( $row_id ), 'Cascade-trashed rows come back on restore.' );
			$this->assertSame(
				'',
				(string) get_post_meta( $row_id, TrashCascade::COLLECTION_MARKER_META, true ),
				'Marker is cleared so a future cascade restore does not revive the row twice.'
			);
		}

		$this->assertSame(
			'trash',
			get_post_status( $independently_trashed ),
			'Rows that were already in trash without the marker stay there after the collection restore.'
		);
	}

	public function test_permanent_delete_of_collection_removes_all_rows(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 2 );

		wp_delete_post( $collection_id, true );

		foreach ( $row_ids as $row_id ) {
			$this->assertNull( get_post( $row_id ), 'Rows must be gone after a collection force-delete.' );
		}
	}

	public function test_permanent_delete_keeps_priority_lead_over_trait_term_sync(): void {
		// Production wires TraitTaxonomy::sync_term_on_delete at priority 10
		// on `before_delete_post`, and registers it BEFORE TrashCascade. If
		// TrashCascade::on_delete ran at the same priority, the trait term
		// would be deleted first and `all_row_ids` (which queries by term)
		// would return empty, leaving the rows orphaned. Re-add the term sync
		// hook on top of the test's clean slate to reproduce the production
		// order, then assert the cascade still finds and deletes the rows.
		( new TraitTaxonomy() )->register_taxonomy();
		add_action(
			'before_delete_post',
			array( new TraitTaxonomy(), 'sync_term_on_delete' ),
			10,
			2
		);

		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 2 );

		wp_delete_post( $collection_id, true );

		foreach ( $row_ids as $row_id ) {
			$this->assertNull(
				get_post( $row_id ),
				'TrashCascade::on_delete must run before TraitTaxonomy::sync_term_on_delete, otherwise the row lookup loses its key.'
			);
		}
	}

	public function test_permanent_delete_of_already_trashed_collection_still_force_deletes_rows(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 2 );

		wp_trash_post( $collection_id );

		wp_delete_post( $collection_id, true );

		foreach ( $row_ids as $row_id ) {
			$this->assertNull( get_post( $row_id ) );
		}
	}

	public function test_trashing_a_non_collection_post_is_a_noop(): void {
		// The collection-to-row cascade only fires when the trashed document
		// carries `cortext_fields`. Trashing anything else (pages, regular WP
		// posts) should not invoke the row walk.
		register_post_type(
			'some_other_post_type',
			array(
				'public'   => false,
				'supports' => array( 'title' ),
			)
		);

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'some_other_post_type',
				'post_status' => 'private',
				'post_title'  => 'Not a collection',
			)
		);

		$this->assertIsInt( $post_id );
		wp_trash_post( $post_id );

		$this->assertSame( 'trash', get_post_status( $post_id ), 'Trash itself still applies.' );
	}

	/**
	 * Creates a collection (`crtxt_document` with `cortext_fields` meta) and
	 * a set of rows tagged with its mirror trait term.
	 *
	 * @return array{0:int,1:int[]} Collection id, row ids.
	 */
	private function create_collection_with_rows( int $row_count ): array {
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

		$row_ids = array();
		for ( $i = 0; $i < $row_count; $i++ ) {
			$row_ids[] = $this->create_row_for_collection( $collection_id );
		}

		return array( $collection_id, $row_ids );
	}

	private function create_row_for_collection( int $collection_id ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Row ' . wp_generate_uuid4(),
			)
		);
		$this->assertGreaterThan( 0, $id );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

		return $id;
	}
}
