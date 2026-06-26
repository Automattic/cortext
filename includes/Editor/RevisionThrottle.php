<?php
/**
 * Throttles WordPress revision creation for Cortext-managed documents.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

defined( 'ABSPATH' ) || exit;

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

	/**
	 * Scoped bypass depth for operations that must snapshot the pre-change
	 * state even inside the autosave throttle window.
	 *
	 * @var int
	 */
	private static int $bypass_depth = 0;

	public function register(): void {
		add_filter( 'wp_save_post_revision_post_has_changed', array( $this, 'throttle_revision' ), 10, 3 );
		add_filter( 'wp_revisions_to_keep', array( $this, 'cap_revisions' ), 10, 2 );
	}

	/**
	 * Runs a callback while the revision throttle is bypassed.
	 *
	 * @template T
	 *
	 * @param callable():T $callback Operation that needs an immediate revision.
	 * @return T
	 */
	public static function with_bypass( callable $callback ) {
		++self::$bypass_depth;
		try {
			return $callback();
		} finally {
			self::$bypass_depth = max( 0, self::$bypass_depth - 1 );
		}
	}

	private static function is_bypassed(): bool {
		if ( self::$bypass_depth > 0 ) {
			return true;
		}

		/**
		 * Filters whether Cortext revision throttling should be bypassed.
		 *
		 * Used by restore flows that must preserve the state immediately before
		 * applying an older revision.
		 *
		 * @param bool $bypass Whether to bypass throttling.
		 */
		return (bool) apply_filters( 'cortext_bypass_revision_throttle', false );
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

		if ( self::is_bypassed() ) {
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
