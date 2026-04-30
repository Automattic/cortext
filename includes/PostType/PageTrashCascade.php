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
	 * Per-post marker stamped on each child trashed by its parent's cascade.
	 * The value is the immediate parent's id, not the cascade root, so
	 * restoring any node walks just its tagged direct children. Recursion
	 * through deeper levels happens via the `untrashed_post` action firing
	 * for each restored child. Pages already in trash before the cascade are
	 * not stamped, so an unrelated parent restore leaves them alone.
	 */
	public const META_KEY = '_cortext_trashed_by_parent';

	public function register(): void {
		add_action( 'wp_trash_post', array( $this, 'cascade_trash' ), 10, 1 );
		add_action( 'untrashed_post', array( $this, 'cascade_restore' ), 10, 1 );
		// Core only registers `wp_untrash_post_set_previous_status` from
		// wp-admin/edit.php's bulk-untrash action, so programmatic restores
		// (REST, WP-CLI, our cascade) default to `draft`. Re-register it for
		// our CPT so a private/published page comes back with the status it
		// had before being trashed.
		add_filter( 'wp_untrash_post_status', array( $this, 'restore_previous_status' ), 10, 3 );
		// Replace the admin Pages list bulk trash/untrash actions with custom
		// ones so they route through `handle_bulk_actions-{screen}` (core only
		// fires that filter on its `default:` switch branch). Our handler
		// tolerates `wp_trash_post`/`wp_untrash_post` returning `false` for
		// pages that the cascade already handled, where core would `wp_die()`.
		add_filter( 'bulk_actions-edit-' . Page::POST_TYPE, array( $this, 'replace_bulk_actions' ) );
		add_filter( 'handle_bulk_actions-edit-' . Page::POST_TYPE, array( $this, 'handle_admin_bulk_action' ), 10, 3 );
	}

	/**
	 * Trashes the page's direct children and stamps each with the page's id.
	 * Hooked on `wp_trash_post`, which fires before the parent's status flips.
	 * The recursive `wp_trash_post` calls fire this same action again for each
	 * child, so deeper levels stamp themselves with their own immediate parent
	 * and the cascade unrolls naturally without an explicit BFS.
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
	 * Restores the direct children that this page's earlier cascade trashed,
	 * and clears the marker on this page so a later ancestor-restore does
	 * not try to bring it back a second time.
	 *
	 * Recursion through deeper levels happens implicitly: each
	 * `wp_untrash_post( $child_id )` fires `untrashed_post`, this handler
	 * runs again for the child, and walks its own tagged direct children.
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
	 * Restores a `crtxt_page` to the status it had before being trashed.
	 * Falls back to the default (typically `draft`) when no previous status
	 * was recorded.
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
	 * Replaces the admin Pages list's `trash` and `untrash` bulk actions with
	 * cortext-prefixed equivalents so they route through
	 * `handle_bulk_actions-{screen}` instead of core's wp_die-prone branches.
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
	 * Handles the cortext-prefixed bulk actions. Counts how many of the
	 * selected pages ended up in (or out of) trash regardless of whether
	 * the work happened via this loop or a cascade triggered earlier in it.
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
				// Ignore the return value: a `false` here just means the page
				// was already trashed by the cascade firing on a parent earlier
				// in the loop. Verify the resulting status instead.
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
	 * Returns the direct children of a page whose status is not already
	 * `trash`. Trashed siblings are skipped so a later restore of this page
	 * does not pull them back in alongside the cascade.
	 *
	 * @param int $post_id Page whose direct children we want.
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
