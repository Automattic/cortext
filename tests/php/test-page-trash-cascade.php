<?php
/**
 * Tests for the post_parent leg of Cortext\PostType\TrashCascade.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\TrashCascade;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;

final class Test_Page_Trash_Cascade extends BaseTestCase {

	use InMemoryPostsQuery;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_filters( 'wp_untrash_post_status' );

		$this->install_in_memory_posts_query();

		( new TrashCascade() )->register();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		parent::tear_down();
	}

	public function test_register_hooks_trash_and_untrash_actions(): void {
		$this->assertNotFalse(
			has_action( 'wp_trash_post' ),
			'on_trash should be hooked on wp_trash_post.'
		);
		$this->assertNotFalse(
			has_action( 'untrashed_post' ),
			'on_restore should be hooked on untrashed_post.'
		);
		$this->assertNotFalse(
			has_filter( 'wp_untrash_post_status' ),
			'restore_previous_status should be hooked on wp_untrash_post_status so programmatic restores return to the pre-trash status.'
		);
	}

	public function test_trashing_parent_cascades_to_descendants_and_stamps_meta(): void {
		$parent_id     = $this->create_page( array( 'post_status' => 'private' ) );
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$grandchild_id = $this->create_page( array( 'post_parent' => $child_id ) );

		wp_trash_post( $parent_id );

		$this->assertSame( 'trash', get_post_status( $parent_id ) );
		$this->assertSame( 'trash', get_post_status( $child_id ) );
		$this->assertSame( 'trash', get_post_status( $grandchild_id ) );

		// Each descendant's marker is its immediate parent, not the cascade root,
		// so restoring an intermediate node can locate its own subtree.
		$this->assertSame( '', (string) get_post_meta( $parent_id, TrashCascade::PARENT_MARKER_META, true ) );
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $child_id, TrashCascade::PARENT_MARKER_META, true ) );
		$this->assertSame( (string) $child_id, (string) get_post_meta( $grandchild_id, TrashCascade::PARENT_MARKER_META, true ) );
	}

	public function test_restoring_intermediate_node_revives_its_subtree(): void {
		$parent_id     = $this->create_page();
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$grandchild_id = $this->create_page( array( 'post_parent' => $child_id ) );

		wp_trash_post( $parent_id );

		// Restore just the child; the parent stays in trash. Grandchild was
		// trashed alongside the child by the cascade and should come back too.
		wp_untrash_post( $child_id );

		$this->assertSame( 'trash', get_post_status( $parent_id ) );
		$this->assertNotSame( 'trash', get_post_status( $child_id ) );
		$this->assertNotSame( 'trash', get_post_status( $grandchild_id ) );

		// Markers on the restored subtree are cleared so a later parent-restore
		// does not re-trigger anything.
		$this->assertSame( '', (string) get_post_meta( $child_id, TrashCascade::PARENT_MARKER_META, true ) );
		$this->assertSame( '', (string) get_post_meta( $grandchild_id, TrashCascade::PARENT_MARKER_META, true ) );
	}

	public function test_trashing_non_page_post_does_not_touch_other_post_types(): void {
		$post_id = wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'A regular post',
			)
		);

		$cortext_page_id = $this->create_page( array( 'post_parent' => (int) $post_id ) );

		wp_trash_post( $post_id );

		$this->assertSame( 'publish', get_post_status( $cortext_page_id ) );
		$this->assertSame( '', (string) get_post_meta( $cortext_page_id, TrashCascade::PARENT_MARKER_META, true ) );
	}

	public function test_pre_trashed_child_is_not_restamped_when_parent_is_trashed(): void {
		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );

		// Trash the child directly first; it now carries no marker (it is the
		// root of its own one-page cascade).
		wp_trash_post( $child_id );
		$this->assertSame( 'trash', get_post_status( $child_id ) );
		$this->assertSame( '', (string) get_post_meta( $child_id, TrashCascade::PARENT_MARKER_META, true ) );

		// Trashing the parent must not re-stamp the already-trashed child.
		wp_trash_post( $parent_id );

		$this->assertSame( '', (string) get_post_meta( $child_id, TrashCascade::PARENT_MARKER_META, true ) );
	}

	public function test_restoring_parent_revives_only_descendants_marked_by_its_cascade(): void {
		$parent_id  = $this->create_page();
		$child_id   = $this->create_page( array( 'post_parent' => $parent_id ) );
		$sibling_id = $this->create_page();

		// Sibling lives in trash from its own delete, not the cascade.
		wp_trash_post( $sibling_id );
		wp_trash_post( $parent_id );

		wp_untrash_post( $parent_id );

		$this->assertNotSame( 'trash', get_post_status( $parent_id ) );
		$this->assertNotSame( 'trash', get_post_status( $child_id ) );
		$this->assertSame( 'trash', get_post_status( $sibling_id ), 'Independent trash should not be revived by an unrelated parent restore.' );
	}

	public function test_restoring_returns_pages_to_their_pre_trash_status(): void {
		$private_parent_id  = $this->create_page( array( 'post_status' => 'private' ) );
		$published_child_id = $this->create_page(
			array(
				'post_parent' => $private_parent_id,
				'post_status' => 'publish',
			)
		);

		wp_trash_post( $private_parent_id );

		wp_untrash_post( $private_parent_id );

		$this->assertSame( 'private', get_post_status( $private_parent_id ) );
		$this->assertSame( 'publish', get_post_status( $published_child_id ) );
	}

	public function test_individual_child_restore_clears_its_marker(): void {
		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );

		wp_trash_post( $parent_id );
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $child_id, TrashCascade::PARENT_MARKER_META, true ) );

		// Restore just the child while the parent stays in trash.
		wp_untrash_post( $child_id );

		$this->assertSame( '', (string) get_post_meta( $child_id, TrashCascade::PARENT_MARKER_META, true ) );

		// A later parent-restore must not try to revive an already-active child.
		wp_untrash_post( $parent_id );
		$this->assertNotSame( 'trash', get_post_status( $child_id ) );
		$this->assertNotSame( 'trash', get_post_status( $parent_id ) );
	}

	private function create_page( array $args = array() ): int {
		$defaults = array(
			'post_type'   => Document::POST_TYPE,
			'post_status' => 'publish',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );

		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}
}
