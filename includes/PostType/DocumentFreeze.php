<?php
/**
 * Frozen documents: the "Locked" state in the UI.
 *
 * A frozen document stays live (in the tree, in search, published if it was)
 * but can't be edited until someone unfreezes it. It is a flag on the
 * document rather than a status, so archiving and restoring keep it. Each
 * document is frozen on its own; children and rows don't follow.
 *
 * The name keeps it apart from WordPress post locks (someone else is editing)
 * and from the editor lock held while an archive or trash request runs.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;

final class DocumentFreeze {

	/** Unix timestamp the document was frozen at. Present only while frozen. */
	public const FROZEN_AT_META = '_cortext_frozen_at';

	/** User who froze the document. */
	public const FROZEN_BY_USER_META = '_cortext_frozen_by_user';

	/** Read-only REST field with who froze the document and when, or null. */
	public const REST_FIELD = 'cortext_frozen';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_rest_field' ) );
	}

	public function register_rest_field(): void {
		register_rest_field(
			Document::POST_TYPE,
			self::REST_FIELD,
			array(
				'get_callback' => static fn( array $post ): ?array => self::details( (int) $post['id'] ),
				'schema'       => array(
					'description' => __( 'Who locked the document and when, or null when it is not locked.', 'cortext' ),
					'type'        => array( 'object', 'null' ),
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
			)
		);
	}

	public static function is_frozen( int $post_id ): bool {
		return (int) get_post_meta( $post_id, self::FROZEN_AT_META, true ) > 0;
	}

	/**
	 * Returns `frozen_at` and `frozen_by` for a frozen document, or null.
	 *
	 * @param int $post_id Document ID.
	 * @return array{frozen_at: string, frozen_by: ?array{id: int, name: string}}|null
	 */
	public static function details( int $post_id ): ?array {
		$frozen_at = (int) get_post_meta( $post_id, self::FROZEN_AT_META, true );
		if ( $frozen_at < 1 ) {
			return null;
		}

		return Documents::lifecycle_details(
			'frozen',
			$frozen_at,
			(int) get_post_meta( $post_id, self::FROZEN_BY_USER_META, true )
		);
	}

	public static function freeze( int $post_id ): void {
		if ( self::is_frozen( $post_id ) ) {
			return;
		}

		update_post_meta( $post_id, self::FROZEN_AT_META, time() );
		update_post_meta( $post_id, self::FROZEN_BY_USER_META, get_current_user_id() );
	}

	public static function unfreeze( int $post_id ): void {
		delete_post_meta( $post_id, self::FROZEN_AT_META );
		delete_post_meta( $post_id, self::FROZEN_BY_USER_META );
	}
}
