<?php
/**
 * Tests for Cortext\PostType\CollectionTrashCascade.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\CollectionTrashCascade;
use Cortext\PostType\Page;
use WorDBless\BaseTestCase;

final class Test_Collection_Trash_Cascade extends BaseTestCase {

	use InMemoryPostsQuery;

	public function set_up(): void {
		parent::set_up();

		( new Page() )->register_post_type();
		( new Collection() )->register_post_type();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_actions( 'before_delete_post' );

		$this->install_in_memory_posts_query();

		( new CollectionTrashCascade() )->register();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		parent::tear_down();
	}

	public function test_register_hooks_trash_untrash_and_delete_actions(): void {
		$this->assertNotFalse(
			has_action( 'wp_trash_post' ),
			'cascade_trash should be hooked on wp_trash_post.'
		);
		$this->assertNotFalse(
			has_action( 'untrashed_post' ),
			'cascade_restore should be hooked on untrashed_post.'
		);
		$this->assertNotFalse(
			has_action( 'before_delete_post' ),
			'cascade_delete should be hooked on before_delete_post.'
		);
	}

	public function test_trashing_page_cascades_to_owned_inline_collections(): void {
		$page_id = $this->create_page();
		$first   = $this->create_inline_collection( $page_id );
		$second  = $this->create_inline_collection( $page_id );

		wp_trash_post( $page_id );

		$this->assertSame( 'trash', get_post_status( $first ) );
		$this->assertSame( 'trash', get_post_status( $second ) );
		$this->assertSame(
			(string) $page_id,
			(string) get_post_meta( $first, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true )
		);
		$this->assertSame(
			(string) $page_id,
			(string) get_post_meta( $second, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true )
		);
	}

	public function test_restoring_page_revives_only_collections_its_cascade_trashed(): void {
		$page_id    = $this->create_page();
		$owned      = $this->create_inline_collection( $page_id );
		$unrelated  = $this->create_inline_collection( $this->create_page() );

		// Unrelated lives in trash from its own delete, not the cascade.
		wp_trash_post( $unrelated );
		wp_trash_post( $page_id );

		wp_untrash_post( $page_id );

		$this->assertNotSame( 'trash', get_post_status( $page_id ) );
		$this->assertNotSame( 'trash', get_post_status( $owned ) );
		$this->assertSame(
			'trash',
			get_post_status( $unrelated ),
			'Independent trash should not be revived by an unrelated page restore.'
		);
		$this->assertSame(
			'',
			(string) get_post_meta( $owned, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true ),
			'Marker should be cleared on the revived collection so a later page-restore does not try to revive it twice.'
		);
	}

	public function test_pre_trashed_inline_collection_is_not_restamped_when_owner_page_is_trashed(): void {
		$page_id    = $this->create_page();
		$collection = $this->create_inline_collection( $page_id );

		// Trash the collection directly first; it carries no marker.
		wp_trash_post( $collection );
		$this->assertSame( 'trash', get_post_status( $collection ) );
		$this->assertSame(
			'',
			(string) get_post_meta( $collection, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true )
		);

		// Trashing the owning page must not re-stamp the already-trashed collection.
		wp_trash_post( $page_id );

		$this->assertSame(
			'',
			(string) get_post_meta( $collection, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true )
		);
	}

	public function test_permanent_delete_of_page_force_deletes_owned_inline_collections(): void {
		$page_id    = $this->create_page();
		$collection = $this->create_inline_collection( $page_id );

		wp_delete_post( $page_id, true );

		$this->assertNull( get_post( $collection ), 'Inline collection should be permanently deleted alongside its owning page.' );
	}

	public function test_permanent_delete_of_already_trashed_page_force_deletes_owned_inline_collections(): void {
		$page_id    = $this->create_page();
		$collection = $this->create_inline_collection( $page_id );

		wp_trash_post( $page_id );
		$this->assertSame( 'trash', get_post_status( $collection ) );

		wp_delete_post( $page_id, true );

		$this->assertNull( get_post( $collection ) );
	}

	public function test_full_page_collections_without_parent_are_not_touched_when_a_page_is_trashed(): void {
		$page_id    = $this->create_page();
		$collection = $this->create_full_page_collection();

		wp_trash_post( $page_id );

		$this->assertNotSame( 'trash', get_post_status( $collection ) );
		$this->assertSame(
			'',
			(string) get_post_meta( $collection, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true )
		);
	}

	public function test_trashing_page_cascades_to_full_page_nested_collections(): void {
		$page_id    = $this->create_page();
		$collection = $this->create_full_page_nested_collection( $page_id );

		wp_trash_post( $page_id );

		$this->assertSame( 'trash', get_post_status( $collection ) );
		$this->assertSame(
			(string) $page_id,
			(string) get_post_meta( $collection, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true )
		);
	}

	public function test_restoring_page_revives_full_page_nested_collections(): void {
		$page_id    = $this->create_page();
		$collection = $this->create_full_page_nested_collection( $page_id );

		wp_trash_post( $page_id );
		$this->assertSame( 'trash', get_post_status( $collection ) );

		wp_untrash_post( $page_id );

		$this->assertNotSame( 'trash', get_post_status( $collection ) );
		$this->assertSame(
			'',
			(string) get_post_meta( $collection, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true )
		);
	}

	public function test_cascade_covers_both_inline_owned_and_nested_collections_at_once(): void {
		$page_id        = $this->create_page();
		$inline_id      = $this->create_inline_collection( $page_id );
		$nested_id      = $this->create_full_page_nested_collection( $page_id );
		$top_level_id   = $this->create_full_page_collection();

		wp_trash_post( $page_id );

		$this->assertSame( 'trash', get_post_status( $inline_id ) );
		$this->assertSame( 'trash', get_post_status( $nested_id ) );
		$this->assertNotSame( 'trash', get_post_status( $top_level_id ) );
	}

	public function test_permanent_delete_of_page_force_deletes_full_page_nested_collection(): void {
		$page_id    = $this->create_page();
		$collection = $this->create_full_page_nested_collection( $page_id );

		wp_delete_post( $page_id, true );

		$this->assertNull(
			get_post( $collection ),
			'Full-page nested collections should be permanently deleted alongside their owning page.'
		);
	}

	public function test_trashing_row_document_cascades_to_collections_nested_under_it(): void {
		$row_id     = $this->create_row_document( 'crtxt_projects' );
		$collection = $this->create_full_page_nested_collection( $row_id );

		wp_trash_post( $row_id );

		$this->assertSame( 'trash', get_post_status( $collection ) );
		$this->assertSame(
			(string) $row_id,
			(string) get_post_meta( $collection, CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY, true )
		);
	}

	public function test_trashing_a_non_page_post_does_not_touch_owned_inline_collections(): void {
		$post_id = wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'A regular post',
			)
		);
		$collection = $this->create_inline_collection( (int) $post_id );

		wp_trash_post( $post_id );

		$this->assertNotSame( 'trash', get_post_status( $collection ) );
	}

	private function create_page( array $args = array() ): int {
		$defaults = array(
			'post_type'   => Page::POST_TYPE,
			'post_status' => 'private',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	private function create_inline_collection( int $owner_page_id ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Inline ' . wp_generate_uuid4(),
				'meta_input'  => array(
					'slug'                              => 'inline-' . wp_generate_uuid4(),
					Collection::MODE_META_KEY           => Collection::MODE_INLINE,
					Collection::INLINE_OWNER_META_KEY   => $owner_page_id,
				),
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	private function create_full_page_collection(): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Full ' . wp_generate_uuid4(),
				'meta_input'  => array(
					'slug'                    => 'full-' . wp_generate_uuid4(),
					Collection::MODE_META_KEY => Collection::MODE_FULL_PAGE,
				),
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	private function create_full_page_nested_collection( int $parent_id ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Nested ' . wp_generate_uuid4(),
				'post_parent' => $parent_id,
				'meta_input'  => array(
					'slug'                    => 'nested-' . wp_generate_uuid4(),
					Collection::MODE_META_KEY => Collection::MODE_FULL_PAGE,
				),
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	private function create_row_document( string $row_post_type ): int {
		// The cascade only needs the post to exist and be a cortext-document
		// (page or row CPT). Register a row CPT inline rather than going
		// through the full collection setup.
		register_post_type(
			$row_post_type,
			array(
				'public'   => false,
				'supports' => array( 'title', 'editor', 'cortext-document' ),
			)
		);

		$id = wp_insert_post(
			array(
				'post_type'   => $row_post_type,
				'post_status' => 'private',
				'post_title'  => 'Row ' . wp_generate_uuid4(),
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}
}
