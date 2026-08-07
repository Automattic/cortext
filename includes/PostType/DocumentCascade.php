<?php
/**
 * Provides shared traversal for document status cascades.
 *
 * Cascades follow two relationships:
 *   - Children follow their immediate `post_parent`.
 *   - Rows follow the collection whose trait term tags them.
 *
 * Callers provide the statuses, marker keys, and transition callback. This
 * class handles marker lookups and walks descendants.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

defined( 'ABSPATH' ) || exit;

use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;

final class DocumentCascade {

	/**
	 * Creates a cascade for one target status.
	 *
	 * @param string[] $active_statuses       Statuses eligible for the cascade.
	 * @param string   $target_status         Status to move documents into.
	 * @param string   $parent_marker_meta    Meta key that links a child to its parent.
	 * @param string   $collection_marker_meta Meta key that links a row to its collection.
	 */
	public function __construct(
		private array $active_statuses,
		private string $target_status,
		private string $parent_marker_meta,
		private string $collection_marker_meta
	) {}

	/**
	 * Moves a document's active children and rows to the target status.
	 *
	 * @param int      $post_id    Document whose children and rows should move.
	 * @param callable $transition Moves each child or row.
	 */
	public function cascade( int $post_id, callable $transition ): void {
		if ( Document::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		foreach ( $this->active_child_ids( $post_id ) as $child_id ) {
			update_post_meta( $child_id, $this->parent_marker_meta, $post_id );
			$transition( $child_id );
		}

		if ( Document::is_collection( $post_id ) ) {
			foreach ( $this->active_row_ids( $post_id ) as $row_id ) {
				update_post_meta( $row_id, $this->collection_marker_meta, $post_id );
				$transition( $row_id );
			}
		}
	}

	/**
	 * Restores the children and rows marked by this document.
	 *
	 * @param int      $post_id    Document whose children and rows should be restored.
	 * @param callable $transition Restores each marked child or row.
	 */
	public function restore( int $post_id, callable $transition ): void {
		if ( Document::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		// Clear the restored document's own markers so a later ancestor
		// restore cannot pull it through the cascade again.
		delete_post_meta( $post_id, $this->parent_marker_meta );
		delete_post_meta( $post_id, $this->collection_marker_meta );

		foreach ( $this->children_marked_by( $post_id ) as $child_id ) {
			$transition( $child_id );
			delete_post_meta( $child_id, $this->parent_marker_meta );
		}

		if ( Document::is_collection( $post_id ) ) {
			foreach ( $this->rows_marked_by( $post_id ) as $row_id ) {
				$transition( $row_id );
				delete_post_meta( $row_id, $this->collection_marker_meta );
			}
		}
	}

	/**
	 * Finds all marked descendants below a document.
	 *
	 * @param int $root_id Root document ID.
	 * @return int[] Descendant IDs, excluding the root.
	 */
	public function descendants_for_root( int $root_id ): array {
		if ( Document::POST_TYPE !== get_post_type( $root_id ) ) {
			return array();
		}

		$collected = array();
		$seen      = array( $root_id => true );
		$frontier  = array( $root_id );

		while ( ! empty( $frontier ) ) {
			$next = array();
			foreach ( $frontier as $current ) {
				foreach ( $this->children_marked_by( $current ) as $child_id ) {
					if ( isset( $seen[ $child_id ] ) ) {
						continue;
					}
					$seen[ $child_id ] = true;
					$collected[]       = $child_id;
					$next[]            = $child_id;
				}
				if ( Document::is_collection( $current ) ) {
					foreach ( $this->rows_marked_by( $current ) as $row_id ) {
						if ( isset( $seen[ $row_id ] ) ) {
							continue;
						}
						$seen[ $row_id ] = true;
						$collected[]     = $row_id;
						$next[]          = $row_id;
					}
				}
			}
			$frontier = $next;
		}

		return $collected;
	}

	/**
	 * Finds collection rows in any of the given statuses.
	 *
	 * @param int      $collection_id Collection document ID.
	 * @param string[] $statuses      Statuses to include.
	 * @return int[]
	 */
	public function row_ids_for_collection( int $collection_id, array $statuses ): array {
		$term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $term_id < 1 ) {
			return array();
		}

		$ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => $statuses,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
					array(
						'taxonomy' => TraitTaxonomy::TAXONOMY,
						'field'    => 'term_id',
						'terms'    => array( $term_id ),
					),
				),
			)
		);

		return array_map( 'intval', $ids );
	}

	/**
	 * Finds active children through `post_parent`.
	 *
	 * @param int $parent_id Parent document ID.
	 * @return int[]
	 */
	private function active_child_ids( int $parent_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_parent'    => $parent_id,
				'post_status'    => $this->active_statuses,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);

		return array_map( 'intval', $ids );
	}

	/**
	 * Finds children in the target status marked by this parent.
	 *
	 * @param int $parent_id Parent ID stored in the marker.
	 * @return int[]
	 */
	private function children_marked_by( int $parent_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => $this->target_status,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => $this->parent_marker_meta, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $parent_id,        // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		return array_map( 'intval', $ids );
	}

	/**
	 * Finds active rows in a collection.
	 *
	 * @param int $collection_id Collection document ID.
	 * @return int[]
	 */
	private function active_row_ids( int $collection_id ): array {
		return $this->row_ids_for_collection( $collection_id, $this->active_statuses );
	}

	/**
	 * Finds rows in the target status marked by this collection.
	 *
	 * @param int $collection_id Collection ID stored in the marker.
	 * @return int[]
	 */
	private function rows_marked_by( int $collection_id ): array {
		$term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $term_id < 1 ) {
			return array();
		}

		$ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => $this->target_status,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => $this->collection_marker_meta, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $collection_id,       // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
					array(
						'taxonomy' => TraitTaxonomy::TAXONOMY,
						'field'    => 'term_id',
						'terms'    => array( $term_id ),
					),
				),
			)
		);

		return array_map( 'intval', $ids );
	}
}
