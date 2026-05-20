<?php
/**
 * Trashes a collection's rows when the collection itself is trashed.
 *
 * Rows live in a dynamic CPT (`crtxt_<slug>`) owned by their collection.
 * Trashing a collection trashes every row; restoring brings them back;
 * force-deleting wipes them. The marker meta records which collection moved
 * a row to Trash so restore only revives rows from that same cascade.
 *
 * The doc → collection direction lives in `CollectionTrashCascade`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

use WP_Post;

final class RowTrashCascade {

	/**
	 * Collection id that moved a row to Trash. Rows already in Trash stay
	 * unmarked, so restore does not revive unrelated items.
	 */
	public const TRASHED_BY_OWNER_META_KEY = '_cortext_trashed_by_owner_collection';

	private CollectionEntries $entries;

	public function __construct( ?CollectionEntries $entries = null ) {
		$this->entries = $entries ?? new CollectionEntries();
	}

	public function register(): void {
		add_action( 'init', array( $this, 'register_meta' ) );
		add_action( 'wp_trash_post', array( $this, 'cascade_trash' ), 10, 1 );
		add_action( 'untrashed_post', array( $this, 'cascade_restore' ), 10, 1 );
		add_action( 'before_delete_post', array( $this, 'cascade_delete' ), 10, 1 );
	}

	public function register_meta(): void {
		// The marker is registered on every entry CPT known at init.
		// CPTs registered later (a new collection in the same request)
		// read the marker by raw key in cascade_restore; missing the
		// registration here only affects REST exposure.
		foreach ( CollectionEntries::get_entry_post_types() as $post_type ) {
			register_post_meta(
				$post_type,
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
	}

	/**
	 * Trashes rows owned by the collection and marks them for restore.
	 *
	 * @param int $post_id Post about to be trashed.
	 */
	public function cascade_trash( int $post_id ): void {
		$collection = $this->collection_for( $post_id );
		if ( null === $collection ) {
			return;
		}

		foreach ( $this->active_row_ids( $collection ) as $row_id ) {
			update_post_meta( $row_id, self::TRASHED_BY_OWNER_META_KEY, $post_id );
			wp_trash_post( $row_id );
		}
	}

	/**
	 * Restores rows this collection moved to Trash and clears the marker.
	 *
	 * @param int $post_id Post that was just restored.
	 */
	public function cascade_restore( int $post_id ): void {
		$collection = $this->collection_for( $post_id );
		if ( null === $collection ) {
			return;
		}

		foreach ( $this->trashed_rows_tagged_with( $collection, $post_id ) as $row_id ) {
			wp_untrash_post( $row_id );
			delete_post_meta( $row_id, self::TRASHED_BY_OWNER_META_KEY );
		}
	}

	/**
	 * Permanently deletes rows owned by the collection. Walks both active
	 * and trashed rows: a collection may be force-deleted from Trash, so
	 * its rows may already be marked `trash`.
	 *
	 * @param int $post_id Post about to be permanently deleted.
	 */
	public function cascade_delete( int $post_id ): void {
		$collection = $this->collection_for( $post_id );
		if ( null === $collection ) {
			return;
		}

		foreach ( $this->all_row_ids( $collection ) as $row_id ) {
			wp_delete_post( $row_id, true );
		}
	}

	/**
	 * Returns the collection post when the id is a collection that has a
	 * dynamic row CPT we can query, or null otherwise. The row CPT for a
	 * trashed collection is not registered during `init`
	 * (`CollectionEntries::register_all` queries active statuses only), so
	 * the cascade registers it on demand before the row lookup runs.
	 *
	 * @param int $post_id Post id under inspection.
	 */
	private function collection_for( int $post_id ): ?WP_Post {
		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post || Collection::POST_TYPE !== $post->post_type ) {
			return null;
		}

		$this->entries->register_for_collection( $post );

		return $post;
	}

	/**
	 * Returns ids of rows that can be sent to Trash by the cascade.
	 *
	 * @param WP_Post $collection Collection post the rows belong to.
	 *
	 * @return int[]
	 */
	private function active_row_ids( WP_Post $collection ): array {
		$post_type = $this->row_post_type( $collection );
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

	/**
	 * Returns ids of every row tied to the collection, including trashed ones.
	 *
	 * @param WP_Post $collection Collection post the rows belong to.
	 *
	 * @return int[]
	 */
	private function all_row_ids( WP_Post $collection ): array {
		$post_type = $this->row_post_type( $collection );
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
	 * Returns ids of rows tagged as cascaded-by-this-collection.
	 *
	 * @param WP_Post $collection    Collection post the rows belong to.
	 * @param int     $collection_id Same collection id, used to match the marker.
	 *
	 * @return int[]
	 */
	private function trashed_rows_tagged_with( WP_Post $collection, int $collection_id ): array {
		$post_type = $this->row_post_type( $collection );
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
				'meta_key'       => self::TRASHED_BY_OWNER_META_KEY,   // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $collection_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		return array_map( 'intval', $ids );
	}

	private function row_post_type( WP_Post $collection ): ?string {
		$slug = get_post_meta( $collection->ID, 'slug', true );
		if ( ! is_string( $slug ) || '' === $slug ) {
			return null;
		}
		$post_type = CollectionEntries::CPT_PREFIX . $slug;
		return post_type_exists( $post_type ) ? $post_type : null;
	}
}
