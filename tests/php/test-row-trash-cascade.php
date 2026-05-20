<?php
/**
 * Tests for Cortext\PostType\RowTrashCascade.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\RowTrashCascade;
use WorDBless\BaseTestCase;

final class Test_Row_Trash_Cascade extends BaseTestCase {

	use InMemoryPostsQuery;

	public function set_up(): void {
		parent::set_up();

		( new Collection() )->register_post_type();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_actions( 'before_delete_post' );

		$this->install_in_memory_posts_query();

		( new RowTrashCascade() )->register();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		parent::tear_down();
	}

	public function test_register_hooks_trash_untrash_and_delete_actions(): void {
		$this->assertNotFalse( has_action( 'wp_trash_post' ) );
		$this->assertNotFalse( has_action( 'untrashed_post' ) );
		$this->assertNotFalse( has_action( 'before_delete_post' ) );
	}

	public function test_trashing_collection_trashes_its_rows_and_stamps_marker(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 'tasks', 3 );

		wp_trash_post( $collection_id );

		foreach ( $row_ids as $row_id ) {
			$this->assertSame( 'trash', get_post_status( $row_id ) );
			$this->assertSame(
				(string) $collection_id,
				(string) get_post_meta( $row_id, RowTrashCascade::TRASHED_BY_OWNER_META_KEY, true ),
				'Each row trashed by the cascade carries the collection id as its owner marker.'
			);
		}
	}

	public function test_restoring_collection_revives_only_rows_its_cascade_trashed(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 'restore', 2 );
		$independently_trashed       = $this->create_row_for_collection( 'restore' );

		// Trash one row independently. It carries no marker.
		wp_trash_post( $independently_trashed );

		wp_trash_post( $collection_id );
		wp_untrash_post( $collection_id );

		foreach ( $row_ids as $row_id ) {
			$this->assertNotSame( 'trash', get_post_status( $row_id ), 'Cascade-trashed rows come back on restore.' );
			$this->assertSame(
				'',
				(string) get_post_meta( $row_id, RowTrashCascade::TRASHED_BY_OWNER_META_KEY, true ),
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
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 'wiped', 2 );

		wp_delete_post( $collection_id, true );

		foreach ( $row_ids as $row_id ) {
			$this->assertNull( get_post( $row_id ), 'Rows must be gone after a collection force-delete.' );
		}
	}

	public function test_permanent_delete_of_already_trashed_collection_still_force_deletes_rows(): void {
		// A trashed collection's dynamic row CPT is not registered by the
		// normal init pass (it queries active statuses). The cascade has to
		// register it on demand before walking rows; without that, the
		// row query returns empty and the rows leak.
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 'two-step', 2 );

		wp_trash_post( $collection_id );
		// Simulate a fresh request: tear down the dynamic CPT so the cascade
		// must register it from the collection meta to see the rows.
		unregister_post_type( CollectionEntries::CPT_PREFIX . 'two-step' );

		wp_delete_post( $collection_id, true );

		foreach ( $row_ids as $row_id ) {
			$this->assertNull( get_post( $row_id ) );
		}
	}

	public function test_trashing_a_non_collection_post_is_a_noop(): void {
		// The cascade is bound to crtxt_collection only. Trashing anything
		// else should not invoke the row walk.
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
	 * Creates a full-page collection with a registered row CPT and seeded
	 * rows.
	 *
	 * @return array{0:int,1:int[]} Collection id, row ids.
	 */
	private function create_collection_with_rows( string $slug, int $row_count ): array {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . $slug,
				'meta_input'  => array(
					'slug'                    => $slug,
					Collection::MODE_META_KEY => Collection::MODE_FULL_PAGE,
				),
			)
		);

		$collection = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection );

		$row_ids = array();
		for ( $i = 0; $i < $row_count; $i++ ) {
			$row_ids[] = $this->create_row_for_collection( $slug, "Row {$slug} {$i}" );
		}

		return array( $collection_id, $row_ids );
	}

	private function create_row_for_collection( string $slug, string $title = '' ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => CollectionEntries::CPT_PREFIX . $slug,
				'post_status' => 'private',
				'post_title'  => '' === $title ? "Row {$slug} " . wp_generate_uuid4() : $title,
			)
		);
		$this->assertGreaterThan( 0, $id );

		return $id;
	}
}
