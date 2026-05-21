<?php
/**
 * Trashes a collection when the document that owns or contains it is trashed.
 *
 * Inline collections follow `_cortext_inline_owner_page`; full-page
 * collections nested under a document follow `post_parent`. The marker meta
 * records which document moved the collection so restore only revives
 * collections from that same cascade.
 *
 * The collection → row direction lives in `RowTrashCascade`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

use Cortext\Documents;

final class CollectionTrashCascade {

	/**
	 * Document id that moved a collection to Trash. Collections already in
	 * Trash stay unmarked, so restore does not revive unrelated items.
	 */
	public const TRASHED_BY_OWNER_META_KEY = '_cortext_trashed_by_owner_page';

	private Documents $documents;

	public function __construct( ?Documents $documents = null ) {
		$this->documents = $documents ?? new Documents();
	}

	public function register(): void {
		add_action( 'init', array( $this, 'register_meta' ) );
		add_action( 'wp_trash_post', array( $this, 'cascade_trash' ), 10, 1 );
		add_action( 'untrashed_post', array( $this, 'cascade_restore' ), 10, 1 );
		add_action( 'before_delete_post', array( $this, 'cascade_delete' ), 10, 1 );
	}

	public function register_meta(): void {
		register_post_meta(
			Collection::POST_TYPE,
			self::TRASHED_BY_OWNER_META_KEY,
			array(
				'type'          => 'integer',
				'single'        => true,
				'show_in_rest'  => false,
				'auth_callback' => static function () {
					return false;
				},
			)
		);
	}

	/**
	 * Trashes collections owned by the document and marks them for restore.
	 *
	 * @param int $post_id ID of the post about to be trashed.
	 */
	public function cascade_trash( int $post_id ): void {
		if ( ! $this->is_owning_document( $post_id ) ) {
			return;
		}

		foreach ( $this->non_trashed_owned_collections( $post_id ) as $collection_id ) {
			update_post_meta( $collection_id, self::TRASHED_BY_OWNER_META_KEY, $post_id );
			wp_trash_post( $collection_id );
		}
	}

	/**
	 * Restores collections this document moved to Trash and clears the marker.
	 *
	 * @param int $post_id ID of the post that was just restored.
	 */
	public function cascade_restore( int $post_id ): void {
		if ( ! $this->is_owning_document( $post_id ) ) {
			return;
		}

		foreach ( $this->trashed_collections_tagged_with( $post_id ) as $collection_id ) {
			wp_untrash_post( $collection_id );
			delete_post_meta( $collection_id, self::TRASHED_BY_OWNER_META_KEY );
		}
	}

	/**
	 * Permanently deletes collections owned by the document. Checks both
	 * active and trashed collections because a document may be force-deleted
	 * after it has already been moved to Trash.
	 *
	 * @param int $post_id ID of the post about to be permanently deleted.
	 */
	public function cascade_delete( int $post_id ): void {
		if ( ! $this->is_owning_document( $post_id ) ) {
			return;
		}

		foreach ( $this->all_owned_collections( $post_id ) as $collection_id ) {
			wp_delete_post( $collection_id, true );
		}
	}

	/**
	 * Whether the post is a document that can own collections (page or row).
	 * Collections themselves are documents too, but they own rows, not other
	 * collections; the collection → row direction lives in `RowTrashCascade`.
	 *
	 * @param int $post_id Candidate post id.
	 */
	private function is_owning_document( int $post_id ): bool {
		$post_type = get_post_type( $post_id );
		if ( ! is_string( $post_type ) || '' === $post_type ) {
			return false;
		}
		if ( Collection::POST_TYPE === $post_type ) {
			return false;
		}
		return null !== $this->documents->kind_for_post_type( $post_type );
	}

	/**
	 * Collections owned by the document that are not already in Trash.
	 *
	 * @param int $doc_id Owning document id.
	 *
	 * @return int[]
	 */
	private function non_trashed_owned_collections( int $doc_id ): array {
		$statuses = array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft' );

		return $this->dedupe_ids(
			array_merge(
				$this->collections_owned_inline( $doc_id, $statuses ),
				$this->collections_nested_under( $doc_id, $statuses )
			)
		);
	}

	/**
	 * Every collection owned by the document, including trashed collections.
	 * `'any'` skips Trash here, so list the statuses explicitly.
	 *
	 * @param int $doc_id Owning document id.
	 *
	 * @return int[]
	 */
	private function all_owned_collections( int $doc_id ): array {
		$statuses = array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft', 'trash' );

		return $this->dedupe_ids(
			array_merge(
				$this->collections_owned_inline( $doc_id, $statuses ),
				$this->collections_nested_under( $doc_id, $statuses )
			)
		);
	}

	/**
	 * Returns inline collections owned by `$doc_id`.
	 *
	 * @param int           $doc_id   Owning document id.
	 * @param array<string> $statuses Post status filter.
	 *
	 * @return int[]
	 */
	private function collections_owned_inline( int $doc_id, array $statuses ): array {
		$ids = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_status'    => $statuses,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => Collection::INLINE_OWNER_META_KEY,   // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $doc_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		return array_map( 'intval', $ids );
	}

	/**
	 * Returns full-page collections nested under `$doc_id`.
	 *
	 * @param int           $doc_id   Parent document id.
	 * @param array<string> $statuses Post status filter.
	 *
	 * @return int[]
	 */
	private function collections_nested_under( int $doc_id, array $statuses ): array {
		$ids = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_parent'    => $doc_id,
				'post_status'    => $statuses,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
			)
		);

		return array_map( 'intval', $ids );
	}

	/**
	 * Returns trashed collections marked by this document.
	 *
	 * @param int $doc_id Document id to match against the cascade marker.
	 *
	 * @return int[]
	 */
	private function trashed_collections_tagged_with( int $doc_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::TRASHED_BY_OWNER_META_KEY,   // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $doc_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		return array_map( 'intval', $ids );
	}

	/**
	 * Removes duplicate ids if a collection ever matches both ownership paths.
	 *
	 * @param int[] $ids
	 *
	 * @return int[]
	 */
	private function dedupe_ids( array $ids ): array {
		return array_values( array_unique( $ids ) );
	}
}
