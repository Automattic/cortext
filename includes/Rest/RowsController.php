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
use WP_REST_Request;
use WP_REST_Response;

final class RowsController {

	private const NAMESPACE = 'cortext/v1';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		// Hydrate relation values and compute rollups in the standard
		// `/wp/v2/<rest_base>/<id>` response for every row CPT, so peek and
		// modal panes (which use `useEntityRecord`) see the same shape as
		// the collection table feed at `/cortext/v1/rows`. Without this,
		// `meta.field-<id>` for a relation field returns the raw stored
		// IDs (strings), and rollups aren't computed at all.
		foreach ( CollectionEntries::get_entry_post_types() as $entry_post_type ) {
			add_filter(
				"rest_prepare_{$entry_post_type}",
				array( $this, 'filter_rest_prepare_row' ),
				10,
				3
			);
		}

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
							'type'              => 'integer',
							'default'           => 25,
							'validate_callback' => static fn( $value ) => (int) $value >= 1 && (int) $value <= 100,
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
						),
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/collections/(?P<collection_id>\d+)/rows',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'create_row' ),
					'permission_callback' => array( $this, 'can_create_row' ),
					'args'                => array(
						'collection_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'title'         => array(
							'type'     => 'string',
							'required' => true,
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

		register_rest_route(
			self::NAMESPACE,
			'/collections/(?P<collection_id>\d+)/rows/(?P<row_id>\d+)/duplicate',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'duplicate_row' ),
					'permission_callback' => array( $this, 'can_duplicate_row' ),
					'args'                => array(
						'collection_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'row_id'        => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	public function can_read(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function can_create_row( WP_REST_Request $request ): bool|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );

		$collection = $this->validate_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

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
	 * Allows duplication only when the user can edit the source row and add
	 * rows to the collection.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 * @return bool|WP_Error
	 */
	public function can_duplicate_row( WP_REST_Request $request ): bool|WP_Error {
		$edit_check = $this->can_edit_row( $request );
		if ( is_wp_error( $edit_check ) ) {
			return $edit_check;
		}
		if ( ! $edit_check ) {
			return false;
		}
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

		$row_query    = new RowsFilterQuery();
		$field_schema = $row_query->field_schema_for( $collection_id );

		$sort_validation = $row_query->validate_sort(
			$request->get_param( 'sort' ),
			$field_schema,
			$collection_id
		);
		if ( is_wp_error( $sort_validation ) ) {
			return $sort_validation;
		}

		$filter_sql = $row_query->compile_filters(
			$request->get_param( 'filters' ),
			$field_schema,
			$collection_id
		);
		if ( is_wp_error( $filter_sql ) ) {
			return $filter_sql;
		}

		$search_where = $row_query->compile_search( (string) $request->get_param( 'search' ), $field_schema );
		$where_parts  = array_values( array_filter( array( $filter_sql['where'], $search_where ) ) );
		$where_sql    = count( $where_parts ) > 0 ? '( ' . implode( ' AND ', $where_parts ) . ' )' : '';

		// Precompute which fields are multi-value so format_row does not
		// re-fetch the field type for every row.
		$multi_field_ids = $this->multi_value_field_ids( $field_ids );

		$query_args = $this->build_query_args( $request, $slug );
		$scope      = new RowsQueryScope(
			$row_query,
			$field_schema,
			$where_sql,
			$filter_sql['join'],
			$request->get_param( 'sort' )
		);
		$query      = $scope->run( $query_args );

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
				'collection' => $this->collection_definition( $collection, $slug ),
				'fields'     => $fields,
			),
			200
		);
	}

	public function create_row( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$title         = trim( sanitize_text_field( (string) $request->get_param( 'title' ) ) );

		if ( '' === $title ) {
			return new WP_Error(
				'cortext_row_title_required',
				__( 'Row title is required.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$collection = $this->validate_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		$slug   = (string) get_post_meta( $collection_id, 'slug', true );
		$row_id = wp_insert_post(
			array(
				'post_type'   => CollectionEntries::CPT_PREFIX . $slug,
				'post_status' => 'private',
				'post_title'  => $title,
			),
			true
		);

		if ( is_wp_error( $row_id ) ) {
			return $row_id;
		}

		$row = get_post( (int) $row_id );
		if ( ! $row instanceof WP_Post ) {
			return new WP_Error(
				'cortext_row_create_failed',
				__( 'Row could not be created.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		$field_ids       = $this->collection_field_ids( $collection_id );
		$multi_field_ids = $this->multi_value_field_ids( $field_ids );
		return new WP_REST_Response(
			$this->format_row( $row, $field_ids, $multi_field_ids ),
			201
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
		if ( 'rollup' === $field_type ) {
			return new WP_Error(
				'cortext_rollup_read_only',
				__( 'Rollups are read-only.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

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
	 * Duplicates a row. Copies the title as "Copy of %s", plus content, status,
	 * document icon, featured media, and stored field values. Relation values
	 * are copied only when the reverse field accepts more than one row; copying
	 * a single reverse would move the relation away from the source row.
	 *
	 * @param WP_REST_Request $request Incoming REST request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function duplicate_row( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$row_id        = (int) $request->get_param( 'row_id' );

		$collection = $this->validate_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		$slug   = (string) get_post_meta( $collection_id, 'slug', true );
		$source = get_post( $row_id );
		if ( ! $source instanceof WP_Post || CollectionEntries::CPT_PREFIX . $slug !== $source->post_type ) {
			return new WP_Error(
				'cortext_row_not_found',
				__( 'Row not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$copy_title = sprintf(
			/* translators: %s: original row title. */
			__( 'Copy of %s', 'cortext' ),
			$source->post_title
		);

		$new_id = wp_insert_post(
			array(
				'post_type'    => $source->post_type,
				'post_status'  => $source->post_status,
				'post_title'   => $copy_title,
				'post_content' => $source->post_content,
				'post_excerpt' => $source->post_excerpt,
			),
			true
		);
		if ( is_wp_error( $new_id ) ) {
			return $new_id;
		}

		$new_id    = (int) $new_id;
		$field_ids = $this->collection_field_ids( $collection_id );

		foreach ( $field_ids as $field_id ) {
			$field_type = (string) get_post_meta( $field_id, 'type', true );

			if ( 'rollup' === $field_type ) {
				continue;
			}

			if ( 'relation' === $field_type ) {
				$reverse_id = (int) get_post_meta( $field_id, 'relation_reverse_field_id', true );
				if ( $reverse_id < 1 || ! Relations::relation_is_multiple( $reverse_id ) ) {
					continue;
				}
				$values = Relations::relation_values( $row_id, $field_id );
				if ( count( $values ) === 0 ) {
					continue;
				}
				$synced = Relations::sync_relation_value( $new_id, $field_id, $values );
				if ( is_wp_error( $synced ) ) {
					return $synced;
				}
				continue;
			}

			$key = Relations::meta_key( $field_id );
			if ( 'multiselect' === $field_type ) {
				foreach ( get_post_meta( $row_id, $key, false ) as $value ) {
					if ( '' !== $value && null !== $value ) {
						add_post_meta( $new_id, $key, $value );
					}
				}
				continue;
			}

			$value = get_post_meta( $row_id, $key, true );
			if ( '' !== $value && null !== $value ) {
				update_post_meta( $new_id, $key, $value );
			}
		}

		$icon = (string) get_post_meta( $row_id, 'cortext_document_icon', true );
		if ( '' !== $icon ) {
			update_post_meta( $new_id, 'cortext_document_icon', $icon );
		}

		$thumbnail_id = (int) get_post_thumbnail_id( $row_id );
		if ( $thumbnail_id > 0 ) {
			set_post_thumbnail( $new_id, $thumbnail_id );
		}

		$multi_field_ids = $this->multi_value_field_ids( $field_ids );
		return new WP_REST_Response(
			$this->format_row( get_post( $new_id ), $field_ids, $multi_field_ids ),
			201
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

		$sort = $request->get_param( 'sort' );
		if ( ! is_array( $sort ) || empty( $sort['field'] ) ) {
			// Default to oldest-first so newly created rows land at the
			// bottom of the table.
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
				$args['orderby'] = 'none';
				$args['order']   = $direction;
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

		if ( 'date' === $field_type || 'datetime' === $field_type ) {
			update_post_meta( $row_id, $key, $this->normalize_date_field_value( $value, $field_type ) );
			return;
		}

		update_post_meta( $row_id, $key, sanitize_text_field( (string) $value ) );
	}

	private function normalize_date_field_value( mixed $value, string $field_type ): string {
		$text = trim( (string) $value );
		if ( '' === $text ) {
			return '';
		}

		if ( preg_match( '/^(\d{4}-\d{2}-\d{2})/', $text, $matches ) ) {
			if ( 'date' === $field_type ) {
				return $matches[1];
			}
			$timestamp = strtotime( $text );
			return false === $timestamp ? sanitize_text_field( $text ) : gmdate( DATE_RFC3339, $timestamp );
		}

		$timestamp = strtotime( $text );
		if ( false === $timestamp ) {
			return sanitize_text_field( $text );
		}

		return 'date' === $field_type ? gmdate( 'Y-m-d', $timestamp ) : gmdate( DATE_RFC3339, $timestamp );
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

	private function compute_rollup_value( int $row_id, int $field_id ): mixed {
		$relation_field_id = (int) get_post_meta( $field_id, 'rollup_relation_field_id', true );
		$target_field_id   = (int) get_post_meta( $field_id, 'rollup_target_field_id', true );
		$aggregator        = (string) get_post_meta( $field_id, 'rollup_aggregator', true );
		if ( '' === $aggregator ) {
			$aggregator = 'count';
		}

		$related_ids = Relations::relation_values( $row_id, $relation_field_id );
		if ( 'count' === $aggregator ) {
			return count( $related_ids );
		}
		if ( $target_field_id < 1 || count( $related_ids ) === 0 ) {
			return 'sum' === $aggregator ? 0 : null;
		}

		if ( in_array( $aggregator, array( 'show_original', 'show_unique' ), true ) ) {
			$values = $this->rollup_values( $related_ids, $target_field_id );
			return 'show_unique' === $aggregator ? $this->unique_rollup_values( $values ) : $values;
		}

		if ( in_array( $aggregator, array( 'count_values', 'count_unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty' ), true ) ) {
			return $this->count_rollup_value( $related_ids, $target_field_id, $aggregator );
		}

		if ( in_array( $aggregator, array( 'earliest', 'latest' ), true ) ) {
			return $this->date_extrema_rollup_value( $related_ids, $target_field_id, 'earliest' === $aggregator ? 'min' : 'max' );
		}

		if ( 'date_range' === $aggregator ) {
			$start = $this->date_extrema_rollup_value( $related_ids, $target_field_id, 'min' );
			$end   = $this->date_extrema_rollup_value( $related_ids, $target_field_id, 'max' );
			if ( null === $start && null === $end ) {
				return null;
			}
			return array(
				'start' => $start,
				'end'   => $end,
			);
		}

		$numbers = $this->numeric_rollup_values( $related_ids, $target_field_id );
		if ( count( $numbers ) === 0 ) {
			return 'sum' === $aggregator ? 0 : null;
		}

		return match ( $aggregator ) {
			'sum' => array_sum( $numbers ),
			'avg' => array_sum( $numbers ) / count( $numbers ),
			'median' => $this->median_rollup_value( $numbers ),
			'min' => min( $numbers ),
			'max' => max( $numbers ),
			'range' => max( $numbers ) - min( $numbers ),
			default => null,
		};
	}

	/**
	 * Returns flattened, non-empty values from related rows for a target field.
	 *
	 * @param int[] $row_ids         Related row IDs.
	 * @param int   $target_field_id Rollup target field post ID.
	 * @return array<int,mixed>
	 */
	private function rollup_values( array $row_ids, int $target_field_id ): array {
		$values = array();
		foreach ( $row_ids as $row_id ) {
			foreach ( $this->rollup_values_for_row( $row_id, $target_field_id ) as $value ) {
				$values[] = $value;
			}
		}
		return $values;
	}

	/**
	 * Returns flattened values for one related row.
	 *
	 * @param int $row_id          Related row ID.
	 * @param int $target_field_id Rollup target field post ID.
	 * @return array<int,mixed>
	 */
	private function rollup_values_for_row( int $row_id, int $target_field_id ): array {
		$type = (string) get_post_meta( $target_field_id, 'type', true );
		if ( 'relation' === $type ) {
			return $this->format_relation_value( $row_id, $target_field_id );
		}

		$key = Relations::meta_key( $target_field_id );
		if ( 'multiselect' === $type ) {
			return array_values(
				array_filter(
					get_post_meta( $row_id, $key, false ),
					static fn( $value ) => '' !== $value && null !== $value
				)
			);
		}

		$value = get_post_meta( $row_id, $key, true );
		return '' === $value || null === $value ? array() : array( $value );
	}

	/**
	 * Returns unique values while preserving relation order.
	 *
	 * @param array<int,mixed> $values Values to de-duplicate.
	 * @return array<int,mixed>
	 */
	private function unique_rollup_values( array $values ): array {
		$seen   = array();
		$unique = array();
		foreach ( $values as $value ) {
			$key = wp_json_encode( $value );
			if ( isset( $seen[ $key ] ) ) {
				continue;
			}
			$seen[ $key ] = true;
			$unique[]     = $value;
		}
		return $unique;
	}

	/**
	 * Computes count and percent rollups.
	 *
	 * @param int[]  $row_ids         Related row IDs.
	 * @param int    $target_field_id Rollup target field post ID.
	 * @param string $aggregator      Rollup aggregator.
	 */
	private function count_rollup_value( array $row_ids, int $target_field_id, string $aggregator ): int|float {
		$total = count( $row_ids );
		if ( 'count_values' === $aggregator ) {
			return count( $this->rollup_values( $row_ids, $target_field_id ) );
		}
		if ( 'count_unique' === $aggregator ) {
			return count( $this->unique_rollup_values( $this->rollup_values( $row_ids, $target_field_id ) ) );
		}

		$not_empty = 0;
		foreach ( $row_ids as $row_id ) {
			if ( count( $this->rollup_values_for_row( $row_id, $target_field_id ) ) > 0 ) {
				++$not_empty;
			}
		}
		$empty = $total - $not_empty;

		return match ( $aggregator ) {
			'empty' => $empty,
			'not_empty' => $not_empty,
			'percent_empty' => $total > 0 ? $empty / $total : 0,
			'percent_not_empty' => $total > 0 ? $not_empty / $total : 0,
			default => 0,
		};
	}

	/**
	 * Returns numeric values for a rollup target field.
	 *
	 * @param int[] $row_ids Related row IDs.
	 * @param int   $target_field_id Rollup target field post ID.
	 * @return float[]
	 */
	private function numeric_rollup_values( array $row_ids, int $target_field_id ): array {
		$key    = Relations::meta_key( $target_field_id );
		$values = array();
		foreach ( $row_ids as $row_id ) {
			$value = get_post_meta( $row_id, $key, true );
			if ( '' !== $value && null !== $value && is_numeric( $value ) ) {
				$values[] = (float) $value;
			}
		}
		return $values;
	}

	/**
	 * Returns the median numeric value for a rollup target field.
	 *
	 * @param float[] $numbers Numeric values.
	 */
	private function median_rollup_value( array $numbers ): float {
		sort( $numbers, SORT_NUMERIC );
		$count  = count( $numbers );
		$middle = intdiv( $count, 2 );
		if ( 1 === $count % 2 ) {
			return $numbers[ $middle ];
		}
		return ( $numbers[ $middle - 1 ] + $numbers[ $middle ] ) / 2;
	}

	/**
	 * Returns the earliest or latest date-like value for a rollup target field.
	 *
	 * @param int[]  $row_ids         Related row IDs.
	 * @param int    $target_field_id Rollup target field post ID.
	 * @param string $direction       Either `min` or `max`.
	 */
	private function date_extrema_rollup_value( array $row_ids, int $target_field_id, string $direction ): ?string {
		$key       = Relations::meta_key( $target_field_id );
		$best_time = null;
		$best      = null;
		foreach ( $row_ids as $row_id ) {
			$value = (string) get_post_meta( $row_id, $key, true );
			if ( '' === $value ) {
				continue;
			}
			$time = strtotime( $value );
			if ( false === $time ) {
				continue;
			}
			if ( null === $best_time || ( 'min' === $direction ? $time < $best_time : $time > $best_time ) ) {
				$best_time = $time;
				$best      = $value;
			}
		}
		return $best;
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
	 * Filters the standard WP REST response for a row post so it carries
	 * hydrated relations and computed rollups, matching the shape exposed
	 * by `/cortext/v1/rows`. Editor surfaces that fetch the row via
	 * `useEntityRecord` (peek pane, modal pane, full document) then see
	 * the same data the table sees, instead of raw stored IDs.
	 *
	 * @param WP_REST_Response $response The prepared response object.
	 * @param WP_Post          $post     The post being prepared.
	 * @return WP_REST_Response
	 */
	public function filter_rest_prepare_row( $response, WP_Post $post ): WP_REST_Response {
		if ( ! $response instanceof WP_REST_Response ) {
			return $response;
		}

		$slug = substr( $post->post_type, strlen( CollectionEntries::CPT_PREFIX ) );
		if ( '' === $slug ) {
			return $response;
		}

		$collection = $this->find_collection_by_slug( $slug );
		if ( ! $collection instanceof WP_Post ) {
			return $response;
		}

		$data = $response->get_data();

		// Hydrate the system fields (created_at / by, modified_at / by) the
		// same way `format_row` does for the table feed, so the same field
		// definitions render correctly in side peek, modal, and full page.
		// Without this, full-page rows show "Empty" for those columns
		// because the standard WP REST response only exposes `author` /
		// `date_gmt` and they don't match the field getters' shape.
		$created_by_id       = (int) $post->post_author;
		$modified_by_id      = (int) get_post_meta( $post->ID, '_modified_by', true );
		$data['created_at']  = $this->format_gmt_date( $post->post_date_gmt );
		$data['modified_at'] = $this->format_gmt_date( $post->post_modified_gmt );
		$data['created_by']  = $this->display_name_for( $created_by_id );
		$data['modified_by'] = $this->display_name_for(
			$modified_by_id > 0 ? $modified_by_id : $created_by_id
		);

		$field_ids = $this->collection_field_ids( $collection->ID );
		if ( count( $field_ids ) > 0 ) {
			// Don't overwrite `meta` with hydrated values: those meta keys
			// are registered as `string`, so a follow-up save that round-
			// trips the hydrated objects back to the server gets rejected
			// with 400 and loops the autosave. Surface the hydrated shape
			// on a parallel `cortext_hydrated_meta` field instead, leaving
			// the raw stored values intact for the save path.
			$hydrated = array();
			foreach ( $field_ids as $field_id ) {
				$field_type = (string) get_post_meta( $field_id, 'type', true );
				$key        = "field-{$field_id}";

				if ( 'relation' === $field_type ) {
					$hydrated[ $key ] = $this->format_relation_value( $post->ID, $field_id );
				} elseif ( 'rollup' === $field_type ) {
					$hydrated[ $key ] = $this->compute_rollup_value( $post->ID, $field_id );
				}
			}

			if ( count( $hydrated ) > 0 ) {
				$data['cortext_hydrated_meta'] = $hydrated;
			}
		}

		$response->set_data( $data );
		return $response;
	}

	/**
	 * Looks up a collection by its `meta.slug` (the canonical identifier
	 * embedded in the row CPT slug). Mirrors
	 * `CollectionEntries::collection_id_for_entry_post_type` but returns the
	 * post object directly since the caller already needs collection context.
	 *
	 * @param string $slug Collection meta slug (e.g., `books` for `crtxt_books`).
	 * @return WP_Post|null
	 */
	private function find_collection_by_slug( string $slug ): ?WP_Post {
		$matches = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_status'    => array( 'draft', 'private', 'publish' ),
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
				'meta_query'     => array(
					array(
						'key'   => 'slug',
						'value' => $slug,
					),
				),
				'posts_per_page' => 1,
			)
		);

		return ! empty( $matches ) ? $matches[0] : null;
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
			} elseif ( 'rollup' === $field_type ) {
				$meta[ $key ] = $this->compute_rollup_value( $post->ID, $field_id );
			} else {
				$meta[ $key ] = isset( $multi_field_ids[ $field_id ] )
					? get_post_meta( $post->ID, $key, false )
					: get_post_meta( $post->ID, $key, true );
			}
		}

		// Include the document icon so the row renders with its glyph in
		// the table (and anywhere else the title gets a leading icon).
		$meta['cortext_document_icon'] = (string) get_post_meta( $post->ID, 'cortext_document_icon', true );

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
	 * Builds collection metadata for row response consumers.
	 *
	 * @param WP_Post $collection Collection post.
	 * @param string  $slug       Collection row post type suffix.
	 * @return array{id:int,title:array{raw:string,rendered:string},slug:string}
	 */
	private function collection_definition( WP_Post $collection, string $slug ): array {
		return array(
			'id'    => $collection->ID,
			'title' => array(
				'raw'      => $collection->post_title,
				'rendered' => $collection->post_title,
			),
			'slug'  => $slug,
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
