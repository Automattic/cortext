<?php
/**
 * Throttles WordPress revision creation for Cortext-managed post types.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

use Cortext\PostType\Page;
use WP_Post;

final class RevisionThrottle {

	/**
	 * Minimum time between revision snapshots. Mirrors Notion's ~10 minute cadence.
	 */
	private const MIN_INTERVAL_SECONDS = 600;

	/**
	 * Total revisions to retain per Cortext page.
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
		if ( Page::POST_TYPE !== $post->post_type ) {
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
	 * Caps the number of revisions retained per Cortext page.
	 *
	 * @param int     $num  Default number of revisions to keep.
	 * @param WP_Post $post The post being saved.
	 */
	public function cap_revisions( int $num, WP_Post $post ): int {
		if ( Page::POST_TYPE !== $post->post_type ) {
			return $num;
		}
		return self::REVISIONS_TO_KEEP;
	}
}
