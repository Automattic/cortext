<?php
/**
 * Handles trash and restore from a collection to its rows. Rows live in the
 * dynamic CPT (`crtxt_<slug>`) owned by the collection. The marker meta keeps
 * restores scoped to rows this collection actually moved.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType\Cascade;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use WP_Post;

final class CollectionToRowTrashCascade extends BaseCascadeStrategy {

	/**
	 * Collection id that moved a row to trash. Rows that were already in
	 * trash stay unmarked, so restore leaves unrelated rows alone.
	 */
	public const TRASHED_BY_OWNER_META_KEY = '_cortext_trashed_by_owner_collection';

	private CollectionEntries $entries;

	public function __construct( ?CollectionEntries $entries = null ) {
		$this->entries = $entries ?? new CollectionEntries();
	}

	public function marker_meta_key(): string {
		return self::TRASHED_BY_OWNER_META_KEY;
	}

	public function applies_to( int $post_id ): bool {
		return Collection::POST_TYPE === get_post_type( $post_id );
	}

	/**
	 * Rows trashed alongside their collection. The engine combines this with
	 * page and collection descendants so the REST trash response can report
	 * the full subtree in one list.
	 *
	 * @param int $root_id Collection post id.
	 * @return int[]
	 */
	public function descendants_for_root( int $root_id ): array {
		return $this->trashed_child_ids_tagged_with( $root_id );
	}

	protected function active_child_ids( int $owner_id ): array {
		$post_type = $this->row_post_type_for( $owner_id );
		if ( null === $post_type ) {
			return array();
		}
		$ids = get_posts(
			array(
				'post_type'      => $post_type,
				'post_status'    => array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
			)
		);
		return array_map( 'intval', $ids );
	}

	protected function trashed_child_ids_tagged_with( int $owner_id ): array {
		$post_type = $this->row_post_type_for( $owner_id );
		if ( null === $post_type ) {
			return array();
		}
		$ids = get_posts(
			array(
				'post_type'      => $post_type,
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
		$post_type = $this->row_post_type_for( $owner_id );
		if ( null === $post_type ) {
			return array();
		}
		$ids = get_posts(
			array(
				'post_type'      => $post_type,
				'post_status'    => array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft', 'trash' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
			)
		);
		return array_map( 'intval', $ids );
	}

	/**
	 * Finds the dynamic row CPT for a collection. Trashed collections are not
	 * registered during `init` because CollectionEntries::register_all only
	 * queries active statuses, so this registers the CPT on demand before
	 * looking up rows.
	 *
	 * @param int $collection_id Collection post id.
	 */
	private function row_post_type_for( int $collection_id ): ?string {
		$collection = get_post( $collection_id );
		if ( ! $collection instanceof WP_Post || Collection::POST_TYPE !== $collection->post_type ) {
			return null;
		}

		$this->entries->register_for_collection( $collection );

		$slug = get_post_meta( $collection->ID, 'slug', true );
		if ( ! is_string( $slug ) || '' === $slug ) {
			return null;
		}
		$post_type = CollectionEntries::CPT_PREFIX . $slug;
		return post_type_exists( $post_type ) ? $post_type : null;
	}
}
