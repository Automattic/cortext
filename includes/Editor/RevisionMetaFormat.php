<?php
/**
 * Records which revisions carry Cortext's revisioned metadata.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

defined( 'ABSPATH' ) || exit;

final class RevisionMetaFormat {

	/**
	 * Marker written on every revision stored while this class is active.
	 */
	public const META_KEY = '_cortext_revision_meta';

	/**
	 * Bumped when the set of revisioned keys changes, so a restore can tell
	 * which generation of metadata a revision was written with.
	 */
	public const VERSION = 1;

	public function register(): void {
		add_action( '_wp_put_post_revision', array( $this, 'mark_revision' ), 10, 2 );
	}

	/**
	 * Stamps a freshly stored revision of a Cortext document.
	 *
	 * @param int $revision_id Revision post ID.
	 * @param int $parent_id   Document the revision belongs to.
	 */
	public function mark_revision( $revision_id, $parent_id ): void {
		if ( ! post_type_supports( (string) get_post_type( (int) $parent_id ), 'cortext-document' ) ) {
			return;
		}

		update_metadata( 'post', (int) $revision_id, self::META_KEY, self::VERSION );
	}

	/**
	 * Whether a revision was stored after Cortext began revisioning metadata.
	 *
	 * Revisions from earlier builds hold no copy of the icon, cover, collection
	 * schema or field values, because the code that copies them did not exist
	 * yet. Their metadata is unknown rather than empty, and a restore that read
	 * the difference as "clear everything" would wipe the live document.
	 *
	 * @param int $revision_id Revision post ID.
	 */
	public static function carries_meta( int $revision_id ): bool {
		return (int) get_post_meta( $revision_id, self::META_KEY, true ) > 0;
	}
}
