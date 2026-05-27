<?php
/**
 * Materializes formula field values into row meta.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Formula;

// phpcs:disable Generic.Commenting.DocComment.MissingShort
// phpcs:disable Squiz.Commenting.FunctionComment.MissingParamTag,Squiz.Commenting.FunctionComment.ParamNameNoMatch,Squiz.Commenting.FunctionComment.IncorrectTypeHint,Squiz.Commenting.FunctionCommentThrowTag.Missing,Squiz.Commenting.FunctionComment.SpacingAfterParamType

use Cortext\PostType\Document;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Post;

final class Materializer {

	public static function recompute_collection( int $collection_id ): void {
		foreach ( self::row_ids_for_collection( $collection_id ) as $row_id ) {
			self::recompute_row( $collection_id, $row_id );
		}
	}

	public static function recompute_volatile_collection( int $collection_id ): void {
		if ( ! self::collection_has_volatile_formula( $collection_id ) ) {
			return;
		}
		self::recompute_collection( $collection_id );
	}

	public static function collection_has_volatile_formula( int $collection_id ): bool {
		foreach ( Document::collection_field_ids( $collection_id ) as $raw_field_id ) {
			$field_id = (int) $raw_field_id;
			if (
				$field_id > 0 &&
				'formula' === (string) get_post_meta( $field_id, 'type', true ) &&
				'1' === (string) get_post_meta( $field_id, 'formula_is_volatile', true )
			) {
				return true;
			}
		}
		return false;
	}

	public static function recompute_posts( int $collection_id, array $posts ): void {
		foreach ( $posts as $post ) {
			if ( $post instanceof WP_Post ) {
				self::recompute_row( $collection_id, $post->ID );
			}
		}
	}

	public static function recompute_row( int $collection_id, int $row_id ): void {
		$row = get_post( $row_id );
		if ( ! $row instanceof WP_Post ) {
			return;
		}

		foreach ( self::formula_field_ids_in_order( $collection_id ) as $field_id ) {
			self::materialize_field( $row, $field_id );
		}
	}

	public static function formula_value( WP_Post $row, int $field_id ): mixed {
		$ast = self::stored_ast( $field_id );
		if ( null === $ast ) {
			return null;
		}
		try {
			$result = ( new Evaluator() )->evaluate( $ast, $row );
			return $result['value'];
		} catch ( FormulaEvalError ) {
			return null;
		}
	}

	private static function materialize_field( WP_Post $row, int $field_id ): void {
		$value = self::formula_value( $row, $field_id );
		$key   = Relations::meta_key( $field_id );
		if ( null === $value || '' === $value ) {
			delete_post_meta( $row->ID, $key );
			return;
		}
		update_post_meta( $row->ID, $key, $value );
	}

	/**
	 * @return int[]
	 */
	private static function formula_field_ids_in_order( int $collection_id ): array {
		$field_ids = array();
		foreach ( Document::collection_field_ids( $collection_id ) as $raw_field_id ) {
			$field_id = (int) $raw_field_id;
			if ( $field_id > 0 && 'formula' === (string) get_post_meta( $field_id, 'type', true ) ) {
				$field_ids[] = $field_id;
			}
		}

		$formula_set = array_fill_keys( $field_ids, true );
		$deps        = array();
		foreach ( $field_ids as $field_id ) {
			$deps[ $field_id ] = array_values(
				array_filter(
					self::stored_deps( $field_id ),
					static fn( int $dep_id ): bool => isset( $formula_set[ $dep_id ] )
				)
			);
		}

		$ordered = array();
		$visited = array();
		$visit   = function ( int $field_id ) use ( &$visit, &$deps, &$visited, &$ordered ): void {
			if ( isset( $visited[ $field_id ] ) ) {
				return;
			}
			$visited[ $field_id ] = true;
			foreach ( $deps[ $field_id ] ?? array() as $dep_id ) {
				$visit( (int) $dep_id );
			}
			$ordered[] = $field_id;
		};
		foreach ( $field_ids as $field_id ) {
			$visit( $field_id );
		}
		return $ordered;
	}

	/**
	 * @return int[]
	 */
	private static function row_ids_for_collection( int $collection_id ): array {
		$collection = get_post( $collection_id );
		if ( ! $collection instanceof WP_Post || ! Document::is_collection_post( $collection ) ) {
			return array();
		}
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		if ( $term_id < 1 ) {
			return array();
		}
		if ( self::is_wordbless_active() ) {
			$ids = array();
			foreach ( \WorDBless\Posts::init()->posts as $post ) {
				if (
					is_object( $post ) &&
					Document::POST_TYPE === $post->post_type &&
					in_array( $post->post_status, array( 'draft', 'pending', 'private', 'publish', 'future', 'inherit' ), true )
				) {
					$term_ids = wp_get_object_terms( (int) $post->ID, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) );
					if ( is_array( $term_ids ) && in_array( $term_id, array_map( 'intval', $term_ids ), true ) ) {
						$ids[] = (int) $post->ID;
					}
				}
			}
			return $ids;
		}
		return array_map(
			'intval',
			get_posts(
				array(
					'post_type'      => Document::POST_TYPE,
					'post_status'    => array( 'draft', 'pending', 'private', 'publish', 'future', 'inherit' ),
					'posts_per_page' => -1,
					'fields'         => 'ids',
					'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
						array(
							'taxonomy' => TraitTaxonomy::TAXONOMY,
							'field'    => 'term_id',
							'terms'    => array( $term_id ),
						),
					),
				)
			)
		);
	}

	private static function is_wordbless_active(): bool {
		return defined( 'WP_REPAIRING' ) && WP_REPAIRING && class_exists( '\WorDBless\Posts' );
	}

	/**
	 * @return array<string,mixed>|null
	 */
	private static function stored_ast( int $field_id ): ?array {
		$raw = (string) get_post_meta( $field_id, 'formula_ast', true );
		if ( '' === $raw ) {
			return null;
		}
		$decoded = json_decode( $raw, true );
		return is_array( $decoded ) ? $decoded : null;
	}

	/**
	 * @return int[]
	 */
	private static function stored_deps( int $field_id ): array {
		$raw = (string) get_post_meta( $field_id, 'formula_dep_field_ids', true );
		if ( '' === $raw ) {
			return array();
		}
		$decoded = json_decode( $raw, true );
		return is_array( $decoded ) ? array_values( array_filter( array_map( 'intval', $decoded ) ) ) : array();
	}
}
