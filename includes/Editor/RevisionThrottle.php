<?php
/**
 * Throttles WordPress revision creation for Cortext-managed documents.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

use WP_Post;

final class RevisionThrottle {

	/**
	 * Minimum time between revision snapshots. Keeps rapid autosaves from creating a revision per edit.
	 */
	private const MIN_INTERVAL_SECONDS = 600;

	/**
	 * Total revisions to retain per Cortext document.
	 */
	private const REVISIONS_TO_KEEP = 50;

	public function register(): void {
		add_filter( 'wp_save_post_revision_post_has_changed', array( $this, 'throttle_revision' ), 10, 3 );
		add_filter( 'wp_revisions_to_keep', array( $this, 'cap_revisions' ), 10, 2 );
	}

	/**
	 * Suppresses revision creation if the last revision is newer than the throttle window.
	 *
	 * @param bool    $post_has_changed Whether WordPress detected content changes.
	 * @param WP_Post $last_revision    The most recent prior revision.
	 * @param WP_Post $post             The post being saved.
	 */
	public function throttle_revision( bool $post_has_changed, WP_Post $last_revision, WP_Post $post ): bool {
		if ( ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return $post_has_changed;
		}

		$last_revision_time = strtotime( $last_revision->post_modified_gmt . ' UTC' );
		if ( false === $last_revision_time ) {
			return $post_has_changed;
		}

		if ( ( time() - $last_revision_time ) < self::MIN_INTERVAL_SECONDS ) {
			return false;
		}

		return $post_has_changed;
	}

	/**
	 * Caps the number of revisions retained per Cortext document.
	 *
	 * @param int     $num  Default number of revisions to keep.
	 * @param WP_Post $post The post being saved.
	 */
	public function cap_revisions( int $num, WP_Post $post ): int {
		if ( ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return $num;
		}
		return self::REVISIONS_TO_KEEP;
	}
}
