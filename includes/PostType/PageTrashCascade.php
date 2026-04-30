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
	 * Per-post marker stamped on every descendant trashed by a cascade. Restoring
	 * a parent only revives children carrying its id, so children that were
	 * already in trash before the cascade are left alone.
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
	}

	/**
	 * Trashes every descendant of a page about to be trashed and stamps each
	 * with a marker so the matching restore can scope itself.
	 *
	 * Hooked on `wp_trash_post`, which fires before the parent's status flips.
	 * Pages that already carry the marker are skipped: they are mid-cascade
	 * from an ancestor and will be processed by that outer call.
	 *
	 * @param int $post_id ID of the page about to be trashed.
	 */
	public function cascade_trash( int $post_id ): void {
		if ( Page::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		// Already inside a parent's cascade; the outer call walks all descendants.
		if ( '' !== (string) get_post_meta( $post_id, self::META_KEY, true ) ) {
			return;
		}

		$descendants = $this->non_trashed_descendants_of( $post_id );
		foreach ( $descendants as $child_id ) {
			update_post_meta( $child_id, self::META_KEY, $post_id );
			wp_trash_post( $child_id );
		}
	}

	/**
	 * Restores descendants tagged by the parent's cascade and clears the
	 * marker on the page being restored.
	 *
	 * Clearing the marker is what protects against the case where a user
	 * restores a child individually before the parent: a later parent-restore
	 * will not find the child in its tagged set, so nothing tries to revive
	 * a page that is already active.
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
	 * Walks the page tree and returns every descendant id whose status is not
	 * already `trash`. Trashed descendants are skipped so that a later restore
	 * does not pull them back in alongside the cascade.
	 *
	 * @param int $post_id Root page whose descendants we want.
	 *
	 * @return int[]
	 */
	private function non_trashed_descendants_of( int $post_id ): array {
		$active_statuses = array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft' );

		$queue = array( $post_id );
		$ids   = array();

		while ( ! empty( $queue ) ) {
			$current = (int) array_shift( $queue );

			$children = get_posts(
				array(
					'post_type'      => Page::POST_TYPE,
					'post_parent'    => $current,
					'post_status'    => $active_statuses,
					'posts_per_page' => -1,
					'fields'         => 'ids',
					'no_found_rows'  => true,
					'orderby'        => 'ID',
					'order'          => 'ASC',
				)
			);

			foreach ( $children as $child_id ) {
				$child_id = (int) $child_id;
				$ids[]    = $child_id;
				$queue[]  = $child_id;
			}
		}

		return $ids;
	}
}
