<?php
/**
 * Manual row order, scoped per collection.
 *
 * A row's position is stored in the `term_order` column of its `crtxt_trait`
 * relationship, so the same row can hold an independent order in every
 * collection it belongs to.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\PostType\Document;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;

final class RowsManualOrder {

	private const SEED_META_KEY = '_cortext_manual_seeded';
	private const ORDER_STEP    = 100;

	public function is_seeded( int $collection_id ): bool {
		return '1' === (string) get_post_meta( $collection_id, self::SEED_META_KEY, true );
	}

	/**
	 * Moves a row between two neighboring rows.
	 *
	 * `before_id` is the row that should come after the moved row.
	 * `after_id` is the row that should come before the moved row.
	 *
	 * @param int        $collection_id Collection post ID.
	 * @param int        $row_id        Row post ID.
	 * @param int|null   $before_id     Next row ID, or null when moving to the end.
	 * @param int|null   $after_id      Previous row ID, or null when moving to the beginning.
	 * @param array|null $current_sort  Sort used to seed the collection, or null for the default order.
	 * @return array{row_id:int,menu_order:int,reseeded:bool,manual_seeded:bool}|WP_Error
	 */
	public function move_row(
		int $collection_id,
		int $row_id,
		?int $before_id,
		?int $after_id,
		?array $current_sort
	): array|WP_Error {
		if ( null === $before_id && null === $after_id ) {
			return new WP_Error(
				'cortext_reorder_neighbor_required',
				__( 'Choose a position for the row.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( $before_id === $row_id || $after_id === $row_id ) {
			return new WP_Error(
				'cortext_reorder_invalid_neighbor',
				__( 'A row can\'t be moved next to itself.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$tt_id = $this->trait_tt_id( $collection_id );
		if ( is_wp_error( $tt_id ) ) {
			return $tt_id;
		}

		$row = $this->row_in_collection( $row_id, $collection_id );
		if ( is_wp_error( $row ) ) {
			return $row;
		}

		$manual_seeded = false;
		$reseeded      = false;
		$is_seeded     = $this->is_seeded( $collection_id );
		if ( ! $is_seeded || $this->should_seed_from_current_sort( $current_sort ) ) {
			$seeded = $this->seed_collection( $collection_id, $current_sort );
			if ( is_wp_error( $seeded ) ) {
				return $seeded;
			}
			$manual_seeded = ! $is_seeded;
			$reseeded      = true;
		}

		$before = null === $before_id ? null : $this->row_in_collection( $before_id, $collection_id );
		if ( is_wp_error( $before ) ) {
			return $before;
		}
		$after = null === $after_id ? null : $this->row_in_collection( $after_id, $collection_id );
		if ( is_wp_error( $after ) ) {
			return $after;
		}

		$before_order = $before instanceof WP_Post ? TraitTaxonomy::member_order( $before->ID, $tt_id ) : null;
		$after_order  = $after instanceof WP_Post ? TraitTaxonomy::member_order( $after->ID, $tt_id ) : null;

		if ( null !== $before_order && null !== $after_order && $before_order <= $after_order ) {
			return new WP_Error(
				'cortext_reorder_invalid_neighbors',
				__( 'Those row positions are no longer valid.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( null !== $before_order && null !== $after_order && ( $before_order - $after_order ) < 2 ) {
			$densified = $this->densify( $collection_id );
			if ( is_wp_error( $densified ) ) {
				return $densified;
			}
			$reseeded = true;

			$before_order = null === $before_id ? null : TraitTaxonomy::member_order( $before_id, $tt_id );
			$after_order  = null === $after_id ? null : TraitTaxonomy::member_order( $after_id, $tt_id );
		}

		$menu_order = $this->menu_order_between( $before_order, $after_order );
		$updated    = $this->set_row_order( $row->ID, $tt_id, $menu_order );
		if ( is_wp_error( $updated ) ) {
			return $updated;
		}

		return array(
			'row_id'        => $row->ID,
			'menu_order'    => $menu_order,
			'reseeded'      => $reseeded,
			'manual_seeded' => $manual_seeded || $this->is_seeded( $collection_id ),
		);
	}

	/**
	 * Copies the current server order into the collection's term_order.
	 *
	 * @param int        $collection_id Collection post ID.
	 * @param array|null $current_sort  Sort object from the current view, or null for default ordering.
	 * @return bool|WP_Error
	 */
	public function seed_collection( int $collection_id, ?array $current_sort ): bool|WP_Error {
		$tt_id = $this->trait_tt_id( $collection_id );
		if ( is_wp_error( $tt_id ) ) {
			return $tt_id;
		}

		$row_ids = $this->row_ids_for_sort( $collection_id, $current_sort );
		if ( is_wp_error( $row_ids ) ) {
			return $row_ids;
		}

		$order = self::ORDER_STEP;
		foreach ( $row_ids as $row_id ) {
			$updated = $this->set_row_order( $row_id, $tt_id, $order );
			if ( is_wp_error( $updated ) ) {
				return $updated;
			}
			$order += self::ORDER_STEP;
		}

		update_post_meta( $collection_id, self::SEED_META_KEY, '1' );
		return true;
	}

	/**
	 * Renumbers rows so there is room between order values.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return bool|WP_Error
	 */
	public function densify( int $collection_id ): bool|WP_Error {
		$tt_id = $this->trait_tt_id( $collection_id );
		if ( is_wp_error( $tt_id ) ) {
			return $tt_id;
		}

		$row_ids = $this->row_ids_for_sort(
			$collection_id,
			array(
				'field'     => 'manual',
				'direction' => 'asc',
			)
		);
		if ( is_wp_error( $row_ids ) ) {
			return $row_ids;
		}

		$order = self::ORDER_STEP;
		foreach ( $row_ids as $row_id ) {
			$updated = $this->set_row_order( $row_id, $tt_id, $order );
			if ( is_wp_error( $updated ) ) {
				return $updated;
			}
			$order += self::ORDER_STEP;
		}

		return true;
	}

	private function menu_order_between( ?int $before_order, ?int $after_order ): int {
		if ( null === $before_order && null === $after_order ) {
			return self::ORDER_STEP;
		}
		if ( null === $before_order ) {
			return (int) $after_order + self::ORDER_STEP;
		}
		if ( null === $after_order ) {
			return (int) $before_order - self::ORDER_STEP;
		}

		return $after_order + intdiv( $before_order - $after_order, 2 );
	}

	private function should_seed_from_current_sort( ?array $current_sort ): bool {
		return ! empty( $current_sort['field'] ) && 'manual' !== $current_sort['field'];
	}

	private function trait_term_id( int $collection_id ): int|WP_Error {
		$collection = get_post( $collection_id );
		if ( ! $collection instanceof WP_Post || ! Document::is_collection_post( $collection ) ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $term_id < 1 ) {
			return new WP_Error(
				'cortext_collection_not_registered',
				__( 'Collection mirror term is not registered.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $term_id;
	}

	/**
	 * Resolves the collection's mirror term's `term_taxonomy_id`, which scopes
	 * every manual-order read and write to this collection's membership.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return int|WP_Error
	 */
	private function trait_tt_id( int $collection_id ): int|WP_Error {
		$collection = get_post( $collection_id );
		if ( ! $collection instanceof WP_Post || ! Document::is_collection_post( $collection ) ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$tt_id = TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id );
		if ( $tt_id < 1 ) {
			return new WP_Error(
				'cortext_collection_not_registered',
				__( 'Collection mirror term is not registered.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $tt_id;
	}

	private function row_in_collection( int $row_id, int $collection_id ): WP_Post|WP_Error {
		$row = get_post( $row_id );
		if (
			! $row instanceof WP_Post
			|| Document::POST_TYPE !== $row->post_type
			|| ! Relations::document_belongs_to_collection( $row_id, $collection_id )
		) {
			return new WP_Error(
				'cortext_row_not_found',
				__( 'Row not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $row;
	}

	/**
	 * Writes one row's manual order for a collection into the `term_order`
	 * column of its (row, trait term) relationship.
	 *
	 * @param int $row_id     Row post ID.
	 * @param int $tt_id      Collection mirror term's term_taxonomy_id.
	 * @param int $menu_order Order value to store.
	 * @return bool|WP_Error
	 */
	private function set_row_order( int $row_id, int $tt_id, int $menu_order ): bool|WP_Error {
		if ( ! TraitTaxonomy::set_member_order( $row_id, $tt_id, $menu_order ) ) {
			return new WP_Error(
				'cortext_reorder_update_failed',
				__( 'Couldn\'t save the row order.', 'cortext' ),
				array( 'status' => 500 )
			);
		}
		return true;
	}

	/**
	 * Returns row IDs for a collection in the given sort order.
	 *
	 * @param int        $collection_id Collection post ID.
	 * @param array|null $sort          Sort object, or null for default ordering.
	 * @return int[]|WP_Error
	 */
	private function row_ids_for_sort( int $collection_id, ?array $sort ): array|WP_Error {
		$trait_term_id = $this->trait_term_id( $collection_id );
		if ( is_wp_error( $trait_term_id ) ) {
			return $trait_term_id;
		}
		$order_tt_id = TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id );

		$row_query    = new RowsFilterQuery();
		$field_schema = $row_query->field_schema_for( $collection_id );
		$validation   = $row_query->validate_sort( $sort, $field_schema, $collection_id );
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		$wordbless_ids = $this->wordbless_row_ids_for_sort( $trait_term_id, $order_tt_id, $sort, $field_schema );
		if ( null !== $wordbless_ids ) {
			return $wordbless_ids;
		}

		$args = array(
			'post_type'      => Document::POST_TYPE,
			'post_status'    => array( 'draft', 'private', 'publish' ),
			'posts_per_page' => -1,
			'no_found_rows'  => true,
			'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
				array(
					'taxonomy' => TraitTaxonomy::TAXONOMY,
					'field'    => 'term_id',
					'terms'    => array( $trait_term_id ),
				),
			),
		);

		// Manual and default ordering come from term_order, applied by the scope's
		// manual-order clause. Field/date/title sorts bring their own ORDER BY.
		if ( is_array( $sort ) && ! empty( $sort['field'] ) ) {
			$direction = ( $sort['direction'] ?? 'asc' ) === 'desc' ? 'DESC' : 'ASC';
			if ( 'title' === $sort['field'] ) {
				$args['orderby'] = 'title';
				$args['order']   = $direction;
			} elseif ( 'created_at' === $sort['field'] ) {
				$args['orderby'] = 'date';
				$args['order']   = $direction;
			} elseif ( 'modified_at' === $sort['field'] ) {
				$args['orderby'] = 'modified';
				$args['order']   = $direction;
			} elseif ( 'manual' === $sort['field'] ) {
				$args['orderby'] = array( 'ID' => 'ASC' );
			} else {
				$args['orderby'] = 'none';
				$args['order']   = $direction;
			}
		} else {
			$args['orderby'] = array( 'ID' => 'ASC' );
		}

		$scope = new RowsQueryScope( $row_query, $field_schema, '', '', $sort, '', $order_tt_id );
		$query = $scope->run( $args );

		return array_map(
			static fn( WP_Post $post ) => (int) $post->ID,
			$query->posts
		);
	}

	/**
	 * WorDBless can fetch single posts but does not run WP_Query. Keep this
	 * fallback here so production keeps using WP_Query.
	 *
	 * @param int        $trait_term_id Mirror term id for the trait.
	 * @param int        $order_tt_id   Mirror term's term_taxonomy_id for manual order.
	 * @param array|null $sort          Sort object.
	 * @param array      $field_schema  Field schema.
	 * @return int[]|null
	 */
	private function wordbless_row_ids_for_sort( int $trait_term_id, int $order_tt_id, ?array $sort, array $field_schema ): ?array {
		if ( ! $this->is_wordbless_active() ) {
			return null;
		}

		$store = \WorDBless\Posts::init();
		$posts = array_values(
			array_filter(
				$store->posts,
				static fn( $post ) =>
					Document::POST_TYPE === $post->post_type &&
					in_array( $post->post_status, array( 'draft', 'private', 'publish' ), true ) &&
					has_term( $trait_term_id, TraitTaxonomy::TAXONOMY, (int) $post->ID )
			)
		);

		$field     = is_array( $sort ) ? (string) ( $sort['field'] ?? '' ) : '';
		$direction = is_array( $sort ) && ( $sort['direction'] ?? 'asc' ) === 'desc' ? -1 : 1;
		usort(
			$posts,
			function ( $a, $b ) use ( $field, $direction, $field_schema, $order_tt_id ): int {
				if ( '' === $field || 'manual' === $field ) {
					$result = TraitTaxonomy::member_order( (int) $a->ID, $order_tt_id ) <=> TraitTaxonomy::member_order( (int) $b->ID, $order_tt_id );
					if ( 0 === $result ) {
						return (int) $a->ID <=> (int) $b->ID;
					}
					return $result;
				} elseif ( 'created_at' === $field ) {
					$result = strcmp( $a->post_date_gmt, $b->post_date_gmt );
				} elseif ( 'modified_at' === $field ) {
					$result = strcmp( $a->post_modified_gmt, $b->post_modified_gmt );
				} elseif ( 'title' === $field ) {
					$result = strnatcasecmp( $a->post_title, $b->post_title );
				} elseif ( str_starts_with( $field, 'field-' ) && isset( $field_schema[ $field ] ) ) {
					$a_value = get_post_meta( (int) $a->ID, $field, true );
					$b_value = get_post_meta( (int) $b->ID, $field, true );
					$result  = 'number' === $field_schema[ $field ]['type']
						? ( (float) $a_value <=> (float) $b_value )
						: strnatcasecmp( (string) $a_value, (string) $b_value );
				} else {
					$result = (int) $a->ID <=> (int) $b->ID;
				}

				if ( 0 === $result ) {
					return (int) $a->ID <=> (int) $b->ID;
				}
				return $result * $direction;
			}
		);

		return array_map(
			static fn( $post ) => (int) $post->ID,
			$posts
		);
	}

	private function is_wordbless_active(): bool {
		return defined( 'WP_REPAIRING' ) && WP_REPAIRING && class_exists( '\WorDBless\Posts' );
	}
}
