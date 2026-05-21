<?php
/**
 * Handles trash and restore from a document to its collections. Inline
 * collections use `_cortext_inline_owner_page`; full-page collections nested
 * under a document use `post_parent`. The marker keeps restore scoped to
 * collections this document moved.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType\Cascade;

use Cortext\PostType\Collection;

final class DocumentToCollectionTrashCascade extends BaseCascadeStrategy {

	/**
	 * Document id that moved a collection to trash. Collections that were
	 * already in trash stay unmarked, so restore leaves unrelated collections
	 * alone.
	 */
	public const TRASHED_BY_OWNER_META_KEY = '_cortext_trashed_by_owner_page';

	public function marker_meta_key(): string {
		return self::TRASHED_BY_OWNER_META_KEY;
	}

	public function applies_to( int $post_id ): bool {
		$post_type = get_post_type( $post_id );
		if ( ! is_string( $post_type ) || '' === $post_type ) {
			return false;
		}
		// Collections own rows, not other collections. CollectionToRowTrashCascade
		// handles that direction.
		if ( Collection::POST_TYPE === $post_type ) {
			return false;
		}
		return post_type_supports( $post_type, 'cortext-document' );
	}

	protected function active_child_ids( int $owner_id ): array {
		$statuses = array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft' );
		return $this->dedupe_ids(
			array_merge(
				$this->collections_owned_inline( $owner_id, $statuses ),
				$this->collections_nested_under( $owner_id, $statuses )
			)
		);
	}

	protected function trashed_child_ids_tagged_with( int $owner_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::TRASHED_BY_OWNER_META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $owner_id,              // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
		return array_map( 'intval', $ids );
	}

	protected function all_child_ids( int $owner_id ): array {
		// WordPress `any` skips trash, so list statuses explicitly to include
		// collections that were already trashed before the owner went down.
		$statuses = array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft', 'trash' );
		return $this->dedupe_ids(
			array_merge(
				$this->collections_owned_inline( $owner_id, $statuses ),
				$this->collections_nested_under( $owner_id, $statuses )
			)
		);
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
	 * Collections that use `$owner_id` as their inline owner.
	 *
	 * @param int           $owner_id Owning document id.
	 * @param array<string> $statuses Post status filter.
	 *
	 * @return int[]
	 */
	private function collections_owned_inline( int $owner_id, array $statuses ): array {
		$ids = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_status'    => $statuses,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => Collection::INLINE_OWNER_META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $owner_id,                // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
		return array_map( 'intval', $ids );
	}

	/**
	 * Full-page collections with `$owner_id` as `post_parent`.
	 *
	 * @param int           $owner_id Owning document id.
	 * @param array<string> $statuses Post status filter.
	 *
	 * @return int[]
	 */
	private function collections_nested_under( int $owner_id, array $statuses ): array {
		$ids = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_parent'    => $owner_id,
				'post_status'    => $statuses,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
			)
		);
		return array_map( 'intval', $ids );
	}

	/**
	 * Deduplicates and re-indexes an id list.
	 *
	 * @param int[] $ids Possibly-duplicated id list.
	 *
	 * @return int[]
	 */
	private function dedupe_ids( array $ids ): array {
		return array_values( array_unique( $ids ) );
	}
}
