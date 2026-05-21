<?php
/**
 * Handles trash and restore through `crtxt_page` parent/child trees, plus the
 * admin filters pages need for bulk trash and previous-status restore.
 *
 * The marker stores each child's immediate parent. That lets restores start
 * at any node and bring back only its own marked descendants. Permanent
 * delete of a page subtree is handled leaves-first by `DocumentsController`,
 * using `descendants_for_root`; page strategies therefore skip the base
 * `cascade_delete` loop.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType\Cascade;

use Cortext\PostType\Page;

final class PageHierarchyTrashCascade extends BaseCascadeStrategy {

	/**
	 * Marks a child as trashed by its parent. The value is the immediate
	 * parent's id, so any restored node can find its own children. Children
	 * already in trash stay unmarked and do not come back with a later parent
	 * restore.
	 */
	public const META_KEY = '_cortext_trashed_by_parent';

	public function marker_meta_key(): string {
		return self::META_KEY;
	}

	public function applies_to( int $post_id ): bool {
		return Page::POST_TYPE === get_post_type( $post_id );
	}

	protected function cascade_delete_enabled(): bool {
		// DocumentsController deletes page subtrees leaves-first. Running a
		// generic owner/child delete here would let WordPress reparent
		// non-leaf descendants before they can be cleaned up.
		return false;
	}

	protected function before_restore( int $post_id ): void {
		// Clear the restored page's own marker so a later ancestor restore
		// cannot pull it through the cascade again.
		delete_post_meta( $post_id, self::META_KEY );
	}

	protected function active_child_ids( int $owner_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Page::POST_TYPE,
				'post_parent'    => $owner_id,
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

	protected function trashed_child_ids_tagged_with( int $owner_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Page::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::META_KEY,        // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $owner_id,    // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
		return array_map( 'intval', $ids );
	}

	protected function all_child_ids( int $owner_id ): array {
		// cascade_delete_enabled() is false for pages. Return the active-child
		// set to satisfy the abstract contract.
		return $this->active_child_ids( $owner_id );
	}

	public function register_meta(): void {
		register_post_meta(
			Page::POST_TYPE,
			self::META_KEY,
			array(
				'type'          => 'integer',
				'single'        => true,
				// The sidebar Trash section reads this marker to show only
				// cascade roots and walk each subtree on the client.
				'show_in_rest'  => true,
				'auth_callback' => static function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}

	public function register_filters(): void {
		// Core adds wp_untrash_post_set_previous_status only in
		// wp-admin/edit.php's bulk-untrash flow. REST, WP-CLI, and the
		// cascade would otherwise restore pages as drafts.
		add_filter( 'wp_untrash_post_status', array( $this, 'restore_previous_status' ), 10, 3 );
		// edit.php's bulk loop calls wp_die() when wp_trash_post returns
		// false, which happens after the cascade already trashed a selected
		// child. Use custom action names so handle_bulk_actions-{screen} runs
		// and can count that no-op as processed.
		add_filter( 'bulk_actions-edit-' . Page::POST_TYPE, array( $this, 'replace_bulk_actions' ) );
		add_filter( 'handle_bulk_actions-edit-' . Page::POST_TYPE, array( $this, 'handle_admin_bulk_action' ), 10, 3 );
	}

	/**
	 * Walks the trashed marker tree below `$root_id`. The marker stores each
	 * child's immediate parent, so the search expands one level at a time.
	 *
	 * REST restore and permanent-delete call this before mutating the root.
	 * After `wp_untrash_post` runs, the synchronous hooks have already changed
	 * the descendants, so the endpoint needs the snapshot first.
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
				foreach ( $this->trashed_child_ids_tagged_with( $current ) as $child_id ) {
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
	 * Renames trash and untrash so WordPress routes them through
	 * `handle_bulk_actions-{screen}` instead of edit.php's built-in branches,
	 * which call wp_die() on a false return.
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
	 * once it ends in the requested status, whether the bulk loop changed it
	 * directly or a cascade got there first.
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
	 * Shared handler for the trash and untrash bulk actions.
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
				// A false return usually means a cascade already trashed this
				// page earlier in the loop. Check the resulting status before
				// counting it.
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
}
