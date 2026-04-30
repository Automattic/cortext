<?php
/**
 * Tests for Cortext\PostType\PageTrashCascade.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Page;
use Cortext\PostType\PageTrashCascade;
use WorDBless\BaseTestCase;
use WorDBless\Posts as WorDBlessPosts;
use WP_Post;
use WP_Query;

final class Test_Page_Trash_Cascade extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		( new Page() )->register_post_type();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_filters( 'wp_untrash_post_status' );

		// WorDBless's wpdb mock returns empty for any query that is not a
		// single-row primary-key lookup; cascade operations rely on
		// `post_parent` and meta_key joins. Intercept WP_Query before it
		// builds SQL and answer from WorDBless's in-memory store instead.
		add_filter( 'posts_pre_query', array( $this, 'serve_posts_from_memory' ), 10, 2 );

		( new PageTrashCascade() )->register();
	}

	public function tear_down(): void {
		remove_filter( 'posts_pre_query', array( $this, 'serve_posts_from_memory' ), 10 );
		parent::tear_down();
	}

	public function test_register_hooks_trash_and_untrash_actions(): void {
		$this->assertNotFalse(
			has_action( 'wp_trash_post' ),
			'cascade_trash should be hooked on wp_trash_post.'
		);
		$this->assertNotFalse(
			has_action( 'untrashed_post' ),
			'cascade_restore should be hooked on untrashed_post.'
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

		$this->assertSame( '', (string) get_post_meta( $parent_id, PageTrashCascade::META_KEY, true ) );
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $child_id, PageTrashCascade::META_KEY, true ) );
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $grandchild_id, PageTrashCascade::META_KEY, true ) );
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
		$this->assertSame( '', (string) get_post_meta( $cortext_page_id, PageTrashCascade::META_KEY, true ) );
	}

	public function test_pre_trashed_child_is_not_restamped_when_parent_is_trashed(): void {
		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );

		// Trash the child directly first; it now carries no marker (it is the
		// root of its own one-page cascade).
		wp_trash_post( $child_id );
		$this->assertSame( 'trash', get_post_status( $child_id ) );
		$this->assertSame( '', (string) get_post_meta( $child_id, PageTrashCascade::META_KEY, true ) );

		// Trashing the parent must not re-stamp the already-trashed child.
		wp_trash_post( $parent_id );

		$this->assertSame( '', (string) get_post_meta( $child_id, PageTrashCascade::META_KEY, true ) );
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
		$private_parent_id = $this->create_page( array( 'post_status' => 'private' ) );
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
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $child_id, PageTrashCascade::META_KEY, true ) );

		// Restore just the child while the parent stays in trash.
		wp_untrash_post( $child_id );

		$this->assertSame( '', (string) get_post_meta( $child_id, PageTrashCascade::META_KEY, true ) );

		// A later parent-restore must not try to revive an already-active child.
		wp_untrash_post( $parent_id );
		$this->assertNotSame( 'trash', get_post_status( $child_id ) );
		$this->assertNotSame( 'trash', get_post_status( $parent_id ) );
	}

	private function create_page( array $args = array() ): int {
		$defaults = array(
			'post_type'   => Page::POST_TYPE,
			'post_status' => 'publish',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );

		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	/**
	 * Short-circuits WP_Query for the queries the cascade emits, answering
	 * from WorDBless's in-memory post store. Only handles the filters the
	 * cascade uses: post_type, post_parent, post_status, meta_key+meta_value.
	 *
	 * @param mixed    $pre   Existing filter return; passed through unchanged when null.
	 * @param WP_Query $query The query being short-circuited.
	 *
	 * @return mixed
	 */
	public function serve_posts_from_memory( $pre, WP_Query $query ) {
		$vars = $query->query_vars;

		$wants_parent_filter = ! empty( $vars['post_parent'] );
		$wants_meta_filter   = ! empty( $vars['meta_key'] );
		if ( ! $wants_parent_filter && ! $wants_meta_filter ) {
			return $pre;
		}

		$candidates = $this->all_in_memory_posts();

		if ( ! empty( $vars['post_type'] ) ) {
			$types      = (array) $vars['post_type'];
			$candidates = array_filter(
				$candidates,
				static fn( WP_Post $post ): bool => in_array( $post->post_type, $types, true )
			);
		}

		if ( $wants_parent_filter ) {
			$parent     = (int) $vars['post_parent'];
			$candidates = array_filter(
				$candidates,
				static fn( WP_Post $post ): bool => (int) $post->post_parent === $parent
			);
		}

		if ( ! empty( $vars['post_status'] ) ) {
			$statuses   = (array) $vars['post_status'];
			$candidates = array_filter(
				$candidates,
				static fn( WP_Post $post ): bool => in_array( $post->post_status, $statuses, true )
			);
		}

		if ( $wants_meta_filter ) {
			$key        = (string) $vars['meta_key'];
			$value      = (string) ( $vars['meta_value'] ?? '' );
			$candidates = array_filter(
				$candidates,
				static fn( WP_Post $post ): bool => (string) get_post_meta( (int) $post->ID, $key, true ) === $value
			);
		}

		$candidates = array_values( $candidates );

		if ( 'ids' === ( $vars['fields'] ?? '' ) ) {
			return array_map( static fn( WP_Post $post ): int => (int) $post->ID, $candidates );
		}

		return $candidates;
	}

	/**
	 * @return WP_Post[]
	 */
	private function all_in_memory_posts(): array {
		$store = WorDBlessPosts::init()->posts;
		$out   = array();
		foreach ( $store as $row ) {
			$out[] = new WP_Post( $row );
		}
		return $out;
	}
}
