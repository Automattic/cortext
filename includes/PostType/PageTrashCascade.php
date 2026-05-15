<?php
/**
 * Cascades trash and restore across `crtxt_page` parent/child trees.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

final class PageTrashCascade {

	/**
	 * Marks a child as trashed by its parent. The value is the immediate
	 * parent's id, so restoring any node finds its own children. Children
	 * already in trash when the cascade reaches them stay unmarked and
	 * don't ride along on a later parent-restore.
	 */
	public const META_KEY = '_cortext_trashed_by_parent';

	public function register(): void {
		add_action( 'init', array( $this, 'register_meta' ) );
		add_action( 'wp_trash_post', array( $this, 'cascade_trash' ), 10, 1 );
		add_action( 'untrashed_post', array( $this, 'cascade_restore' ), 10, 1 );
		// Core only wires wp_untrash_post_set_previous_status inside
		// wp-admin/edit.php's bulk-untrash. Every other caller (REST, WP-CLI,
		// our cascade) gets 'draft' on restore without this.
		add_filter( 'wp_untrash_post_status', array( $this, 'restore_previous_status' ), 10, 3 );
		// edit.php's bulk loop wp_die()s when wp_trash_post returns false,
		// which is what happens after the cascade already trashed the page.
		// Rename trash/untrash so they land in the default branch where
		// handle_bulk_actions-{screen} fires and we can absorb the no-op.
		add_filter( 'bulk_actions-edit-' . Page::POST_TYPE, array( $this, 'replace_bulk_actions' ) );
		add_filter( 'handle_bulk_actions-edit-' . Page::POST_TYPE, array( $this, 'handle_admin_bulk_action' ), 10, 3 );
	}

	/**
	 * Exposes the cascade marker via REST so the sidebar Trash section can
	 * filter rows down to cascade roots and walk the subtree client-side.
	 */
	public function register_meta(): void {
		register_post_meta(
			Page::POST_TYPE,
			self::META_KEY,
			array(
				'type'          => 'integer',
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => static function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}

	/**
	 * Trashes a page's direct children and stamps each with the parent's id.
	 * Each `wp_trash_post` call fires this hook for the child, so the subtree
	 * comes down without an explicit walk.
	 *
	 * @param int $post_id ID of the page about to be trashed.
	 */
	public function cascade_trash( int $post_id ): void {
		if ( Page::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		$children = $this->non_trashed_children_of( $post_id );
		foreach ( $children as $child_id ) {
			update_post_meta( $child_id, self::META_KEY, $post_id );
			wp_trash_post( $child_id );
		}
	}

	/**
	 * Restores any direct children this page's earlier cascade trashed and
	 * clears the marker on this page so a later ancestor-restore doesn't
	 * revive it twice. Each `wp_untrash_post` call fires this hook for the
	 * child, walking its own tagged children.
	 *
	 * @param int $post_id ID of the page that was just restored.
	 */
	public function cascade_restore( int $post_id ): void {
		if ( Page::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		delete_post_meta( $post_id, self::META_KEY );

		$tagged = get_posts(
			array(
				'post_type'      => Page::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::META_KEY,   // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $post_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		foreach ( $tagged as $child_id ) {
			wp_untrash_post( (int) $child_id );
		}
	}

	/**
	 * Restores a `crtxt_page` to the status it had before being trashed,
	 * falling back to the default ('draft') when no previous status is
	 * recorded.
	 *
	 * @param string $new_status      Status WordPress would otherwise assign on restore.
	 * @param int    $post_id         ID of the page being restored.
	 * @param string $previous_status Status the page held before it was trashed.
	 */
	public function restore_previous_status( string $new_status, int $post_id, string $previous_status ): string {
		if ( Page::POST_TYPE !== get_post_type( $post_id ) ) {
			return $new_status;
		}
		return '' !== $previous_status ? $previous_status : $new_status;
	}

	/**
	 * Renames trash and untrash so they route through
	 * `handle_bulk_actions-{screen}` instead of edit.php's wp_die-prone
	 * built-in branches.
	 *
	 * @param array $actions Bulk-action dropdown entries.
	 *
	 * @return array
	 */
	public function replace_bulk_actions( array $actions ): array {
		if ( isset( $actions['trash'] ) ) {
			unset( $actions['trash'] );
			$actions['cortext_trash'] = __( 'Move to Trash', 'cortext' );
		}
		if ( isset( $actions['untrash'] ) ) {
			unset( $actions['untrash'] );
			$actions['cortext_untrash'] = __( 'Restore', 'cortext' );
		}
		return $actions;
	}

	/**
	 * Handles the renamed bulk actions. A selected page counts as processed
	 * once its end status matches the action, whether this loop or a cascade
	 * got there first.
	 *
	 * @param mixed  $sendback URL the admin will redirect to after processing.
	 * @param string $action   Bulk action identifier.
	 * @param array  $post_ids Selected post ids.
	 *
	 * @return mixed
	 */
	public function handle_admin_bulk_action( $sendback, string $action, array $post_ids ) {
		if ( 'cortext_trash' === $action ) {
			return $this->run_admin_bulk( (string) $sendback, $post_ids, 'trash' );
		}
		if ( 'cortext_untrash' === $action ) {
			return $this->run_admin_bulk( (string) $sendback, $post_ids, 'untrash' );
		}
		return $sendback;
	}

	/**
	 * Shared body for the trash and untrash bulk handlers.
	 *
	 * @param string $sendback URL the admin will redirect to after processing.
	 * @param array  $post_ids Selected post ids.
	 * @param string $action   Either 'trash' or 'untrash'.
	 */
	private function run_admin_bulk( string $sendback, array $post_ids, string $action ): string {
		$count  = 0;
		$locked = 0;

		foreach ( $post_ids as $post_id ) {
			$post_id = (int) $post_id;
			if ( ! current_user_can( 'delete_post', $post_id ) ) {
				wp_die(
					'trash' === $action
						? esc_html__( 'Sorry, you are not allowed to move this item to the Trash.', 'cortext' )
						: esc_html__( 'Sorry, you are not allowed to restore this item from the Trash.', 'cortext' )
				);
			}

			if ( 'trash' === $action ) {
				if ( wp_check_post_lock( $post_id ) ) {
					++$locked;
					continue;
				}
				// A false return usually means the cascade already trashed
				// this page earlier in the loop, not that anything went wrong.
				// Check the resulting status.
				wp_trash_post( $post_id );
				if ( 'trash' === get_post_status( $post_id ) ) {
					++$count;
				}
			} else {
				wp_untrash_post( $post_id );
				if ( 'trash' !== get_post_status( $post_id ) ) {
					++$count;
				}
			}
		}

		$count_key = 'trash' === $action ? 'trashed' : 'untrashed';
		$args      = array(
			$count_key => $count,
			'ids'      => implode( ',', array_map( 'intval', $post_ids ) ),
		);
		if ( 'trash' === $action ) {
			$args['locked'] = $locked;
		}

		return add_query_arg( $args, $sendback );
	}

	/**
	 * BFS over the cascade-marker tree rooted at `$root_id`, returning every
	 * trashed descendant whose marker chain ties back to the root. The marker
	 * stores each child's immediate parent, so the walk expands one level at
	 * a time. Page-only by design; row CPTs are flat and produce an empty list.
	 *
	 * Used by the restore and permanent-delete REST endpoints to record the
	 * subtree before the mutation runs (untrashed_post fires synchronously
	 * inside wp_untrash_post, so a post-call query would not isolate which
	 * descendants this restore brought back).
	 *
	 * @param int $root_id Page id to walk from.
	 *
	 * @return int[] Trashed descendant ids (root excluded), no guaranteed order.
	 */
	public function descendants_for_root( int $root_id ): array {
		if ( Page::POST_TYPE !== get_post_type( $root_id ) ) {
			return array();
		}

		$collected = array();
		$frontier  = array( $root_id );

		while ( ! empty( $frontier ) ) {
			$next = array();
			foreach ( $frontier as $current ) {
				foreach ( $this->trashed_children_tagged_with( $current ) as $child_id ) {
					if ( ! in_array( $child_id, $collected, true ) ) {
						$collected[] = $child_id;
						$next[]      = $child_id;
					}
				}
			}
			$frontier = $next;
		}

		return $collected;
	}

	/**
	 * Returns trashed pages currently tagged with the given parent id.
	 *
	 * @param int $parent_id Page id to match against the cascade marker.
	 *
	 * @return int[]
	 */
	private function trashed_children_tagged_with( int $parent_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Page::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::META_KEY,   // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $parent_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		return array_map( 'intval', $ids );
	}

	/**
	 * Returns the page's direct children that aren't already in trash.
	 * Already-trashed ones stay unmarked so a later parent-restore doesn't
	 * pull them back too.
	 *
	 * @param int $post_id Page whose children we want.
	 *
	 * @return int[]
	 */
	private function non_trashed_children_of( int $post_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Page::POST_TYPE,
				'post_parent'    => $post_id,
				'post_status'    => array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);

		return array_map( 'intval', $ids );
	}
}
