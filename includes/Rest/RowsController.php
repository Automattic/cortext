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
use Cortext\Relations;
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

		register_rest_route(
			self::NAMESPACE,
			'/collections/(?P<collection_id>\d+)/rows/(?P<row_id>\d+)',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'update_row_field' ),
					'permission_callback' => array( $this, 'can_edit_row' ),
					'args'                => array(
						'collection_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'row_id'        => array(
							'type'     => 'integer',
							'required' => true,
						),
						'field'         => array(
							'type'     => 'string',
							'required' => true,
						),
						'value'         => array(
							'required' => false,
						),
					),
				),
			)
		);
	}

	public function can_read(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function can_edit_row( WP_REST_Request $request ): bool|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$row_id        = (int) $request->get_param( 'row_id' );

		$collection = $this->validate_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		$slug = (string) get_post_meta( $collection_id, 'slug', true );
		$row  = get_post( $row_id );
		if ( ! $row instanceof WP_Post || CollectionEntries::CPT_PREFIX . $slug !== $row->post_type ) {
			return new WP_Error(
				'cortext_row_not_found',
				__( 'Row not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return current_user_can( 'edit_post', $row_id );
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

		// Validate sort and filter references separately. Sort accepts
		// 'title', 'field-N', and the sortable system fields; filters
		// accept 'field-N' only — system field filtering is deferred
		// (tech-debt.md#13).
		$sort_validation = $this->validate_sort_field(
			$request->get_param( 'sort' ),
			$field_ids,
			$collection_id
		);
		if ( is_wp_error( $sort_validation ) ) {
			return $sort_validation;
		}

		$filter_validation = $this->validate_filter_fields(
			$request->get_param( 'filters' ),
			$field_ids,
			$collection_id
		);
		if ( is_wp_error( $filter_validation ) ) {
			return $filter_validation;
		}

		// Precompute which fields are multi-value so format_row does not
		// re-fetch the field type for every row.
		$multi_field_ids = $this->multi_value_field_ids( $field_ids );

		$query_args = $this->build_query_args( $request, $slug );
		$query      = new WP_Query( $query_args );

		// Prime the user object cache once before mapping rows so per-row
		// display name lookups in format_row hit the cache instead of
		// running N+1 queries.
		$this->prime_user_cache( $query->posts );

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

	public function update_row_field( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$row_id        = (int) $request->get_param( 'row_id' );
		$field_key     = (string) $request->get_param( 'field' );
		$value         = $request->get_param( 'value' );

		$collection = $this->validate_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		$slug = (string) get_post_meta( $collection_id, 'slug', true );
		$row  = get_post( $row_id );
		if ( ! $row instanceof WP_Post || CollectionEntries::CPT_PREFIX . $slug !== $row->post_type ) {
			return new WP_Error(
				'cortext_row_not_found',
				__( 'Row not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( 'title' === $field_key ) {
			$result = wp_update_post(
				array(
					'ID'         => $row_id,
					'post_title' => sanitize_text_field( (string) $value ),
				),
				true
			);
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			$field_ids       = $this->collection_field_ids( $collection_id );
			$multi_field_ids = $this->multi_value_field_ids( $field_ids );
			return new WP_REST_Response(
				$this->format_row( get_post( $row_id ), $field_ids, $multi_field_ids ),
				200
			);
		}

		$field_id  = $this->field_id_from_key( $field_key );
		$field_ids = $this->collection_field_ids( $collection_id );
		if ( ! $field_id || ! in_array( $field_id, $field_ids, true ) ) {
			return new WP_Error(
				'cortext_field_not_in_collection',
				__( 'Field does not belong to this collection.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$field_type = (string) get_post_meta( $field_id, 'type', true );
		if ( 'relation' === $field_type ) {
			$synced = Relations::sync_relation_value( $row_id, $field_id, $value );
			if ( is_wp_error( $synced ) ) {
				return $synced;
			}
		} else {
			$this->write_field_value( $row_id, $field_id, $field_type, $value );
		}

		$touch = wp_update_post( array( 'ID' => $row_id ), true );
		if ( is_wp_error( $touch ) ) {
			return $touch;
		}

		$field_ids       = $this->collection_field_ids( $collection_id );
		$multi_field_ids = $this->multi_value_field_ids( $field_ids );
		return new WP_REST_Response(
			$this->format_row( get_post( $row_id ), $field_ids, $multi_field_ids ),
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
	 * Validates the `sort` param's field key.
	 *
	 * Accepts `'title'`, any `field-N` belonging to the collection, and the
	 * sortable system field keys (`'created_at'`, `'modified_at'`). Rejects
	 * the `*_by` system field keys and any other identifier — sort on
	 * display-value properties is an open architectural decision shared
	 * with relations (tech-debt.md#14).
	 *
	 * @param mixed $sort           Sort param from the request.
	 * @param int[] $field_ids      Valid field IDs for the collection.
	 * @param int   $collection_id  Collection ID for error messages.
	 * @return true|WP_Error
	 */
	private function validate_sort_field( $sort, array $field_ids, int $collection_id ) {
		if ( ! is_array( $sort ) || empty( $sort['field'] ) ) {
			return true;
		}

		$allowed = array( 'title', 'created_at', 'modified_at' );
		foreach ( $field_ids as $id ) {
			$allowed[] = "field-{$id}";
		}

		if ( ! in_array( $sort['field'], $allowed, true ) ) {
			return new WP_Error(
				'cortext_invalid_sort_field',
				sprintf(
					/* translators: 1: field key, 2: collection ID */
					__( 'Field "%1$s" cannot be used to sort collection %2$d.', 'cortext' ),
					$sort['field'],
					$collection_id
				),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * Validates every `filters[].field` reference.
	 *
	 * Accepts only `field-N` keys belonging to the collection. Title and
	 * system fields are intentionally excluded: title isn't filterable
	 * today (preserved from prior behavior), and system field filtering
	 * is deferred (tech-debt.md#13). Rejection produces a clean 400.
	 *
	 * @param mixed $filters        Filters param from the request.
	 * @param int[] $field_ids      Valid field IDs for the collection.
	 * @param int   $collection_id  Collection ID for error messages.
	 * @return true|WP_Error
	 */
	private function validate_filter_fields( $filters, array $field_ids, int $collection_id ) {
		if ( ! is_array( $filters ) || count( $filters ) === 0 ) {
			return true;
		}

		$allowed = array();
		foreach ( $field_ids as $id ) {
			$allowed[] = "field-{$id}";
		}

		foreach ( $filters as $filter ) {
			if ( ! is_array( $filter ) || empty( $filter['field'] ) ) {
				continue;
			}
			if ( ! in_array( $filter['field'], $allowed, true ) ) {
				return new WP_Error(
					'cortext_invalid_filter_field',
					sprintf(
						/* translators: 1: field key, 2: collection ID */
						__( 'Field "%1$s" cannot be used to filter collection %2$d.', 'cortext' ),
						$filter['field'],
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
		if ( ! is_array( $sort ) || empty( $sort['field'] ) ) {
			// Default to oldest-first so newly created rows land at the
			// bottom of the table (Notion-style).
			$args['orderby'] = 'date';
			$args['order']   = 'ASC';
		} else {
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

	private function write_field_value( int $row_id, int $field_id, string $field_type, mixed $value ): void {
		$key = Relations::meta_key( $field_id );

		if ( 'multiselect' === $field_type ) {
			delete_post_meta( $row_id, $key );
			$entries = is_array( $value ) ? $value : array( $value );
			foreach ( $entries as $entry ) {
				$text = sanitize_text_field( (string) $entry );
				if ( '' !== $text ) {
					add_post_meta( $row_id, $key, $text );
				}
			}
			return;
		}

		if ( null === $value || '' === $value ) {
			delete_post_meta( $row_id, $key );
			return;
		}

		if ( 'number' === $field_type ) {
			update_post_meta( $row_id, $key, is_numeric( $value ) ? (float) $value : $value );
			return;
		}

		if ( 'checkbox' === $field_type ) {
			update_post_meta( $row_id, $key, (bool) $value );
			return;
		}

		update_post_meta( $row_id, $key, sanitize_text_field( (string) $value ) );
	}

	/**
	 * Formats resolved references for a relation field.
	 *
	 * @param int $row_id   Row post ID.
	 * @param int $field_id Relation field post ID.
	 * @return array<int,array{id:int,title:array{raw:string,rendered:string},collectionId:int,collectionSlug:string}>
	 */
	private function format_relation_value( int $row_id, int $field_id ): array {
		$target_collection_id = (int) get_post_meta( $field_id, 'related_collection_id', true );
		$target_slug          = (string) get_post_meta( $target_collection_id, 'slug', true );
		$refs                 = array();

		foreach ( Relations::relation_values( $row_id, $field_id ) as $target_id ) {
			$target = get_post( $target_id );
			if ( ! $target instanceof WP_Post ) {
				continue;
			}
			$refs[] = array(
				'id'             => $target_id,
				'title'          => array(
					'raw'      => $target->post_title,
					'rendered' => $target->post_title,
				),
				'collectionId'   => $target_collection_id,
				'collectionSlug' => $target_slug,
			);
		}

		return $refs;
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
			if ( 'multiselect' === $field_type || ( 'relation' === $field_type && Relations::relation_is_multiple( $field_id ) ) ) {
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
			$key        = "field-{$field_id}";
			$field_type = (string) get_post_meta( $field_id, 'type', true );

			if ( 'relation' === $field_type ) {
				$meta[ $key ] = $this->format_relation_value( $post->ID, $field_id );
			} else {
				$meta[ $key ] = isset( $multi_field_ids[ $field_id ] )
					? get_post_meta( $post->ID, $key, false )
					: get_post_meta( $post->ID, $key, true );
			}
		}

		$created_by_id  = (int) $post->post_author;
		$modified_by_id = (int) get_post_meta( $post->ID, '_modified_by', true );

		return array(
			'id'          => $post->ID,
			'title'       => array(
				'raw'      => $post->post_title,
				'rendered' => $post->post_title,
			),
			'status'      => $post->post_status,
			'created_at'  => $this->format_gmt_date( $post->post_date_gmt ),
			'modified_at' => $this->format_gmt_date( $post->post_modified_gmt ),
			'created_by'  => $this->display_name_for( $created_by_id ),
			'modified_by' => $this->display_name_for( $modified_by_id > 0 ? $modified_by_id : $created_by_id ),
			'meta'        => $meta,
		);
	}

	/**
	 * Formats a GMT MySQL datetime as RFC3339 with explicit UTC offset.
	 *
	 * `mysql_to_rfc3339` strips the timezone, leaving the client to guess
	 * whether the value is local or UTC. Since `_gmt` columns are always
	 * UTC, render them as `+00:00` so the client formats them correctly.
	 *
	 * @param string|null $mysql_gmt MySQL datetime string in UTC.
	 * @return string RFC3339 string, or empty string if the input is empty.
	 */
	private function format_gmt_date( ?string $mysql_gmt ): string {
		if ( ! $mysql_gmt || '0000-00-00 00:00:00' === $mysql_gmt ) {
			return '';
		}
		$timestamp = strtotime( $mysql_gmt . ' UTC' );
		return false === $timestamp ? '' : gmdate( DATE_RFC3339, $timestamp );
	}

	/**
	 * Resolves a user ID to a display name, or empty string when missing.
	 *
	 * Reads from the WP user object cache primed by `prime_user_cache` so
	 * row pages stay at two user-related queries regardless of row count.
	 *
	 * @param int $user_id User ID to resolve.
	 * @return string Display name, or empty string when the user is missing.
	 */
	private function display_name_for( int $user_id ): string {
		if ( $user_id < 1 ) {
			return '';
		}
		$user = get_userdata( $user_id );
		return $user ? (string) $user->display_name : '';
	}

	/**
	 * Pre-populates the user object cache with every author and last-editor
	 * referenced by the current row page, so per-row `get_userdata` calls in
	 * `format_row` resolve from cache. Without this, display name lookup is
	 * N+1 on cold caches; with it, two batch queries cover any row count.
	 *
	 * @param WP_Post[] $posts Posts in the current row page.
	 */
	private function prime_user_cache( array $posts ): void {
		if ( count( $posts ) === 0 ) {
			return;
		}

		$ids = array();
		foreach ( $posts as $post ) {
			$ids[]       = (int) $post->post_author;
			$modified_by = (int) get_post_meta( $post->ID, '_modified_by', true );
			if ( $modified_by > 0 ) {
				$ids[] = $modified_by;
			}
		}

		$ids = array_values( array_unique( array_filter( $ids ) ) );
		if ( count( $ids ) > 0 ) {
			cache_users( $ids );
		}
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
