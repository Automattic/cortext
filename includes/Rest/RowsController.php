<?php
/**
 * REST endpoint for querying collection rows.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;

final class RowsController {

	private const NAMESPACE = 'cortext/v1';

	/**
	 * Supported filter operators and their WP_Query compare equivalents.
	 */
	private const FILTER_OPERATORS = array(
		'is'     => '=',
		'isNot'  => '!=',
		'isAny'  => 'IN',
		'isNone' => 'NOT IN',
	);

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/rows',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_rows' ),
					'permission_callback' => array( $this, 'can_read' ),
					'args'                => array(
						'collection' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'page'       => array(
							'type'    => 'integer',
							'default' => 1,
							'minimum' => 1,
						),
						'per_page'   => array(
							'type'    => 'integer',
							'default' => 25,
							'minimum' => 1,
							'maximum' => 100,
						),
						'search'     => array(
							'type'    => 'string',
							'default' => '',
						),
						'sort'       => array(
							'type'       => 'object',
							'default'    => null,
							'properties' => array(
								'field'     => array( 'type' => 'string' ),
								'direction' => array(
									'type' => 'string',
									'enum' => array( 'asc', 'desc' ),
								),
							),
						),
						'filters'    => array(
							'type'    => 'array',
							'default' => array(),
							'items'   => array(
								'type'       => 'object',
								'properties' => array(
									'field'    => array( 'type' => 'string' ),
									'operator' => array( 'type' => 'string' ),
									'value'    => array(
										'type' => array( 'string', 'number', 'boolean', 'array' ),
									),
								),
							),
						),
					),
				),
			)
		);
	}

	public function can_read(): bool {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Returns paginated, sortable, filterable rows for a collection.
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_rows( WP_REST_Request $request ) {
		$collection_id = (int) $request->get_param( 'collection' );

		$collection = $this->validate_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		$slug      = (string) get_post_meta( $collection->ID, 'slug', true );
		$field_ids = $this->collection_field_ids( $collection->ID );

		// Validate field references in sort/filters.
		$referenced = $this->referenced_fields( $request );
		$validation = $this->validate_fields( $referenced, $field_ids, $collection_id );
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		// Precompute which fields are multi-value so format_row does not
		// re-fetch the field type for every row.
		$multi_field_ids = $this->multi_value_field_ids( $field_ids );

		$query_args = $this->build_query_args( $request, $slug );
		$query      = new WP_Query( $query_args );

		$rows = array_map(
			function ( WP_Post $post ) use ( $field_ids, $multi_field_ids ) {
				return $this->format_row( $post, $field_ids, $multi_field_ids );
			},
			$query->posts
		);

		$fields = $this->field_definitions( $field_ids );

		return new WP_REST_Response(
			array(
				'rows'       => $rows,
				'total'      => (int) $query->found_posts,
				'totalPages' => (int) $query->max_num_pages,
				'fields'     => $fields,
			),
			200
		);
	}

	/**
	 * Checks that the given ID points to a valid, registered collection.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return WP_Post|WP_Error
	 */
	private function validate_collection( int $collection_id ) {
		$collection = get_post( $collection_id );

		if ( ! $collection || Collection::POST_TYPE !== $collection->post_type ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$slug = get_post_meta( $collection_id, 'slug', true );
		if ( ! $slug || ! post_type_exists( CollectionEntries::CPT_PREFIX . $slug ) ) {
			return new WP_Error(
				'cortext_collection_not_registered',
				__( 'Collection row type is not registered.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $collection;
	}

	/**
	 * Returns the field IDs attached to a collection, as integers.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return int[]
	 */
	private function collection_field_ids( int $collection_id ): array {
		$raw = get_post_meta( $collection_id, 'fields', false );
		return array_map( 'intval', $raw );
	}

	/**
	 * Extracts all field references from sort and filter params.
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @return string[] Field keys like "field-123".
	 */
	private function referenced_fields( WP_REST_Request $request ): array {
		$refs = array();

		$sort = $request->get_param( 'sort' );
		if ( is_array( $sort ) && ! empty( $sort['field'] ) && 'title' !== $sort['field'] ) {
			$refs[] = $sort['field'];
		}

		$filters = $request->get_param( 'filters' );
		if ( is_array( $filters ) ) {
			foreach ( $filters as $filter ) {
				if ( is_array( $filter ) && ! empty( $filter['field'] ) ) {
					$refs[] = $filter['field'];
				}
			}
		}

		return array_unique( $refs );
	}

	/**
	 * Validates that every referenced field key belongs to the collection.
	 *
	 * @param string[] $referenced     Field keys like "field-123".
	 * @param int[]    $field_ids      Valid field IDs for the collection.
	 * @param int      $collection_id  Collection ID for error messages.
	 * @return true|WP_Error
	 */
	private function validate_fields( array $referenced, array $field_ids, int $collection_id ) {
		$valid_keys = array();
		foreach ( $field_ids as $id ) {
			$valid_keys[] = "field-{$id}";
		}

		foreach ( $referenced as $key ) {
			if ( ! in_array( $key, $valid_keys, true ) ) {
				return new WP_Error(
					'cortext_invalid_field',
					sprintf(
						/* translators: 1: field key, 2: collection ID */
						__( 'Field "%1$s" does not belong to collection %2$d.', 'cortext' ),
						$key,
						$collection_id
					),
					array( 'status' => 400 )
				);
			}
		}

		return true;
	}

	/**
	 * Translates REST params into WP_Query arguments.
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @param string          $slug    Collection slug.
	 * @return array
	 */
	private function build_query_args( WP_REST_Request $request, string $slug ): array {
		$args = array(
			'post_type'      => CollectionEntries::CPT_PREFIX . $slug,
			'post_status'    => array( 'draft', 'private', 'publish' ),
			'posts_per_page' => (int) $request->get_param( 'per_page' ),
			'paged'          => (int) $request->get_param( 'page' ),
		);

		$search = $request->get_param( 'search' );
		if ( '' !== $search ) {
			$args['s'] = $search;
		}

		$sort = $request->get_param( 'sort' );
		if ( is_array( $sort ) && ! empty( $sort['field'] ) ) {
			$direction = ( $sort['direction'] ?? 'asc' ) === 'desc' ? 'DESC' : 'ASC';

			if ( 'title' === $sort['field'] ) {
				$args['orderby'] = 'title';
				$args['order']   = $direction;
			} else {
				$field_id   = $this->field_id_from_key( $sort['field'] );
				$field_type = $field_id ? (string) get_post_meta( $field_id, 'type', true ) : '';
				$wp_type    = CollectionEntries::wp_meta_type_for( $field_type );

				$args['meta_key'] = $sort['field']; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				$args['orderby']  = 'number' === $wp_type ? 'meta_value_num' : 'meta_value';
				$args['order']    = $direction;
			}
		}

		$filters = $request->get_param( 'filters' );
		if ( is_array( $filters ) && count( $filters ) > 0 ) {
			$meta_query = array();

			foreach ( $filters as $filter ) {
				if ( ! is_array( $filter ) ) {
					continue;
				}

				$field    = $filter['field'] ?? '';
				$operator = $filter['operator'] ?? '';
				$value    = $filter['value'] ?? '';

				if ( '' === $field || ! isset( self::FILTER_OPERATORS[ $operator ] ) ) {
					continue;
				}

				$compare = self::FILTER_OPERATORS[ $operator ];

				// IN / NOT IN require array values.
				if ( in_array( $compare, array( 'IN', 'NOT IN' ), true ) && ! is_array( $value ) ) {
					$value = array( $value );
				}

				$meta_query[] = array(
					'key'     => $field,
					'value'   => $value,
					'compare' => $compare,
				);
			}

			if ( count( $meta_query ) > 0 ) {
				$args['meta_query'] = $meta_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
			}
		}

		return $args;
	}

	/**
	 * Returns the subset of field IDs whose type stores multiple values.
	 *
	 * @param int[] $field_ids All field IDs for the collection.
	 * @return array<int, true> Keyed by field ID for fast lookup.
	 */
	private function multi_value_field_ids( array $field_ids ): array {
		$multi = array();
		foreach ( $field_ids as $field_id ) {
			$field_type = (string) get_post_meta( $field_id, 'type', true );
			if ( in_array( $field_type, array( 'multiselect', 'relation' ), true ) ) {
				$multi[ $field_id ] = true;
			}
		}
		return $multi;
	}

	/**
	 * Formats a single row post for the response.
	 *
	 * @param WP_Post         $post            Entry post object.
	 * @param int[]           $field_ids       Valid field IDs for the collection.
	 * @param array<int,true> $multi_field_ids Field IDs that are multi-value.
	 * @return array
	 */
	private function format_row( WP_Post $post, array $field_ids, array $multi_field_ids ): array {
		$meta = array();
		foreach ( $field_ids as $field_id ) {
			$key = "field-{$field_id}";

			$meta[ $key ] = isset( $multi_field_ids[ $field_id ] )
				? get_post_meta( $post->ID, $key, false )
				: get_post_meta( $post->ID, $key, true );
		}

		return array(
			'id'     => $post->ID,
			'title'  => array(
				'raw'      => $post->post_title,
				'rendered' => $post->post_title,
			),
			'status' => $post->post_status,
			'meta'   => $meta,
		);
	}

	/**
	 * Builds lightweight field definitions for the response.
	 *
	 * @param int[] $field_ids Field post IDs.
	 * @return array<int, array{id: int, label: string, type: string}>
	 */
	private function field_definitions( array $field_ids ): array {
		$definitions = array();
		foreach ( $field_ids as $field_id ) {
			$field = get_post( $field_id );
			if ( ! $field ) {
				continue;
			}
			$definitions[] = array(
				'id'    => $field_id,
				'label' => $field->post_title,
				'type'  => (string) get_post_meta( $field_id, 'type', true ),
			);
		}
		return $definitions;
	}

	/**
	 * Extracts the numeric field ID from a meta key like "field-123".
	 *
	 * @param string $key Meta key.
	 * @return int|null
	 */
	private function field_id_from_key( string $key ): ?int {
		if ( str_starts_with( $key, 'field-' ) ) {
			return (int) substr( $key, 6 );
		}
		return null;
	}
}
