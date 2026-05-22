<?php
/**
 * REST endpoint for querying collection rows.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Fields\FieldTypeConverter;
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
		// Add hydrated relations and rollups to the normal row CPT response.
		// Peek/modal panes fetch rows with `useEntityRecord`; without this
		// hook, relation meta is still raw stored IDs and rollups are missing.
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
						'include'    => array(
							'type'              => 'array',
							'default'           => array(),
							'items'             => array( 'type' => 'integer' ),
							'sanitize_callback' => array( $this, 'sanitize_include_param' ),
							'validate_callback' => array( $this, 'validate_include_param' ),
						),
						'context'    => array(
							'type'    => 'string',
							'default' => 'view',
							'enum'    => array( 'view', 'edit' ),
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
			'/collections/(?P<collection_id>\d+)/rows/(?P<row_id>\d+)/reorder',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'reorder_row' ),
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
						'before_id'     => array(
							'type'     => array( 'integer', 'null' ),
							'required' => false,
						),
						'after_id'      => array(
							'type'     => array( 'integer', 'null' ),
							'required' => false,
						),
						'current_sort'  => array(
							'type'     => array( 'object', 'null' ),
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

	/**
	 * Permission gate for the rows endpoint.
	 *
	 * `context=edit` requires `edit_posts` (existing editor behaviour).
	 * `context=view` is public — anyone may read rows from a published
	 * collection.
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @return bool|WP_Error
	 */
	public function can_read( WP_REST_Request $request ) {
		if ( current_user_can( 'edit_posts' ) ) {
			return true;
		}

		if ( 'edit' === $request['context'] ) {
			return new WP_Error(
				'rest_forbidden_context',
				__( 'Sorry, you are not allowed to edit posts in this post type.', 'cortext' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		// context=view: allow if the collection is published.
		$collection_id = (int) $request->get_param( 'collection' );
		$collection    = get_post( $collection_id );

		if ( ! $collection || Collection::POST_TYPE !== $collection->post_type ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( 'publish' !== $collection->post_status ) {
			return new WP_Error(
				'cortext_collection_not_public',
				__( 'Collection is not public.', 'cortext' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		return true;
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

		// If `include` was sent but sanitizes to an empty list, return no rows.
		// Falling through would return page 1 of the collection, which is not
		// what the caller asked for. The picker does not send empty ID lists,
		// but future callers might.
		$query_params = $request->get_query_params();
		if ( array_key_exists( 'include', $query_params ) && count( (array) $request->get_param( 'include' ) ) === 0 ) {
			return new WP_REST_Response(
				array(
					'rows'       => array(),
					'total'      => 0,
					'totalPages' => 0,
					'collection' => $this->collection_definition( $collection, $slug ),
					'fields'     => $this->field_definitions( $field_ids ),
				),
				200
			);
		}

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

		// Keep row-formatting metadata local to this rows response. Passing the
		// context through the helpers avoids stale state in CLI and test runs.
		$ctx              = new RowFormatContext();
		$ctx->field_types = $this->field_types_map( $field_ids );
		$multi_field_ids  = $this->multi_value_field_ids_from( $ctx->field_types );

		$query_args = $this->build_query_args( $request, $slug );
		$scope      = new RowsQueryScope(
			$row_query,
			$field_schema,
			$where_sql,
			$filter_sql['join'],
			$request->get_param( 'sort' ),
			(string) $request->get_param( 'search' )
		);
		$query      = $scope->run( $query_args );

		// Prime the user object cache once before mapping rows so per-row
		// display name lookups in format_row hit the cache instead of
		// running N+1 queries.
		$this->prime_user_cache( $query->posts );

		// Prime related rows once before formatting. Relation chips need post
		// objects, and rollups need post meta.
		$related_ids = $this->collect_related_row_ids( $query->posts, $field_ids, $ctx );
		if ( count( $related_ids ) > 0 ) {
			_prime_post_caches( $related_ids, false, true );
		}

		$rows = array_map(
			function ( WP_Post $post ) use ( $field_ids, $multi_field_ids, $ctx ) {
				return $this->format_row( $post, $field_ids, $multi_field_ids, $ctx );
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

	public function reorder_row( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$row_id        = (int) $request->get_param( 'row_id' );
		$before_id     = $this->nullable_row_id_param( $request->get_param( 'before_id' ) );
		$after_id      = $this->nullable_row_id_param( $request->get_param( 'after_id' ) );
		$current_sort  = $request->get_param( 'current_sort' );
		$current_sort  = is_array( $current_sort ) ? $current_sort : null;

		if ( null === $before_id && null === $after_id ) {
			return new WP_Error(
				'cortext_reorder_neighbor_required',
				__( 'Choose a position for the row.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$manual_order = new RowsManualOrder();
		if (
			! $manual_order->is_seeded( $collection_id ) &&
			! array_key_exists( 'current_sort', $request->get_params() )
		) {
			return new WP_Error(
				'cortext_reorder_current_sort_required',
				__( 'Send the current sort before starting manual order.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$result = $manual_order->move_row(
			$collection_id,
			$row_id,
			$before_id,
			$after_id,
			$current_sort
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
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

		$include = (array) $request->get_param( 'include' );
		if ( count( $include ) > 0 ) {
			// The by-ID response is read as a Map<id, row>, not an ordered list.
			// Keep the default menu_order / ID order so callers do not start
			// depending on the order of the include array.
			$args['post__in'] = $include;
		}

		$sort = $request->get_param( 'sort' );
		if ( ! is_array( $sort ) || empty( $sort['field'] ) ) {
			$args['orderby'] = array(
				'menu_order' => 'ASC',
				'ID'         => 'ASC',
			);
		} else {
			$direction = ( $sort['direction'] ?? 'asc' ) === 'desc' ? 'DESC' : 'ASC';

			if ( 'title' === $sort['field'] ) {
				$args['orderby'] = 'title';
				$args['order']   = $direction;
			} elseif ( 'manual' === $sort['field'] ) {
				$args['orderby'] = array(
					'menu_order' => 'ASC',
					'ID'         => 'ASC',
				);
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

	/**
	 * Cleans the `include` query param into a list of post IDs.
	 *
	 * Drops non-positive values, removes duplicates, and re-indexes. Empty
	 * input is allowed; the controller handles it before running the query.
	 *
	 * @param mixed $value Raw `include` param.
	 * @return int[]
	 */
	public function sanitize_include_param( mixed $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$ids = array();
		foreach ( $value as $item ) {
			$id = absint( $item );
			if ( $id > 0 ) {
				$ids[] = $id;
			}
		}

		return array_values( array_unique( $ids ) );
	}

	/**
	 * Caps `include` at the same per_page ceiling as the rest of the endpoint.
	 *
	 * WP REST runs `validate_callback` before `sanitize_callback`, so the
	 * value here is the raw client input. The cap applies before deduping, so
	 * it can reject a noisy request that would shrink below 100 after sanitize.
	 *
	 * @param mixed $value Raw `include` value from the request.
	 * @return true|WP_Error
	 */
	public function validate_include_param( mixed $value ): bool|WP_Error {
		if ( ! is_array( $value ) ) {
			return new WP_Error(
				'rest_invalid_param',
				__( 'Pass include as an array of row IDs.', 'cortext' ),
				array( 'status' => 400 )
			);
		}
		if ( count( $value ) > 100 ) {
			return new WP_Error(
				'cortext_include_too_many',
				__( 'You can resolve up to 100 rows by ID at a time.', 'cortext' ),
				array( 'status' => 400 )
			);
		}
		return true;
	}

	private function nullable_row_id_param( mixed $value ): ?int {
		if ( null === $value || '' === $value ) {
			return null;
		}
		$id = (int) $value;
		return $id > 0 ? $id : null;
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

		// A single-value edit should clear leftover multi-row values first.
		// Otherwise `update_post_meta` updates only row 0 and stale chips can
		// come back after another type change.
		$existing = get_post_meta( $row_id, $key, false );
		if ( is_array( $existing ) && count( $existing ) > 1 ) {
			delete_post_meta( $row_id, $key );
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
	 * @param int                   $row_id   Row post ID.
	 * @param int                   $field_id Relation field post ID.
	 * @param RowFormatContext|null $ctx      Formatting context for rows responses.
	 * @return array<int,array{id:int,slug:string,title:array{raw:string,rendered:string},collectionId:int,collectionSlug:string}>
	 */
	private function format_relation_value( int $row_id, int $field_id, ?RowFormatContext $ctx = null ): array {
		$relation_meta        = $this->relation_field_meta_for( $field_id, $ctx );
		$target_collection_id = $relation_meta['related_collection_id'];
		$target_slug          = $relation_meta['target_slug'];

		// Prime raw targets before filtering; the filter calls `get_post`.
		$raw_ids = Relations::relation_values( $row_id, $field_id );
		if ( count( $raw_ids ) > 0 ) {
			_prime_post_caches( $raw_ids, false, true );
		}

		$refs = array();
		foreach ( $this->visible_relation_values_from_ids( $raw_ids ) as $target_id ) {
			$target = get_post( $target_id );
			if ( ! $target instanceof WP_Post ) {
				continue;
			}
			$refs[] = array(
				'id'             => $target_id,
				'slug'           => (string) $target->post_name,
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
	 * Reads relation field config through the current formatting context.
	 *
	 * @param int                   $field_id Relation field post ID.
	 * @param RowFormatContext|null $ctx      Optional formatting context.
	 * @return array{related_collection_id: int, target_slug: string}
	 */
	private function relation_field_meta_for( int $field_id, ?RowFormatContext $ctx ): array {
		if ( null !== $ctx && isset( $ctx->relation_field_meta[ $field_id ] ) ) {
			return $ctx->relation_field_meta[ $field_id ];
		}
		$target_collection_id = (int) get_post_meta( $field_id, 'related_collection_id', true );
		$entry                = array(
			'related_collection_id' => $target_collection_id,
			'target_slug'           => (string) get_post_meta( $target_collection_id, 'slug', true ),
		);
		if ( null !== $ctx ) {
			$ctx->relation_field_meta[ $field_id ] = $entry;
		}
		return $entry;
	}

	/**
	 * Reads rollup field config through the current formatting context.
	 *
	 * @param int                   $field_id Rollup field post ID.
	 * @param RowFormatContext|null $ctx      Optional formatting context.
	 * @return array{relation_field_id: int, target_field_id: int, aggregator: string}
	 */
	private function rollup_field_meta_for( int $field_id, ?RowFormatContext $ctx ): array {
		if ( null !== $ctx && isset( $ctx->rollup_field_meta[ $field_id ] ) ) {
			return $ctx->rollup_field_meta[ $field_id ];
		}
		$aggregator = (string) get_post_meta( $field_id, 'rollup_aggregator', true );
		$entry      = array(
			'relation_field_id' => (int) get_post_meta( $field_id, 'rollup_relation_field_id', true ),
			'target_field_id'   => (int) get_post_meta( $field_id, 'rollup_target_field_id', true ),
			'aggregator'        => '' === $aggregator ? 'count' : $aggregator,
		);
		if ( null !== $ctx ) {
			$ctx->rollup_field_meta[ $field_id ] = $entry;
		}
		return $entry;
	}

	/**
	 * Reads the field type for a rollup target field. Target fields share the
	 * `field_types` cache with the rendering collection's fields; both are
	 * just `field_id => type` and never disagree on the same ID.
	 *
	 * @param int                   $field_id Target field post ID.
	 * @param RowFormatContext|null $ctx      Optional formatting context.
	 */
	private function target_field_type_for( int $field_id, ?RowFormatContext $ctx ): string {
		if ( null !== $ctx && isset( $ctx->field_types[ $field_id ] ) ) {
			return $ctx->field_types[ $field_id ];
		}
		$type = (string) get_post_meta( $field_id, 'type', true );
		if ( null !== $ctx ) {
			$ctx->field_types[ $field_id ] = $type;
		}
		return $type;
	}

	/**
	 * Returns relation targets that should show up now. Trashed targets stay in
	 * meta so restore can bring the relation back, but chips and rollups ignore
	 * them while they are in Trash.
	 *
	 * @param int $row_id   Row post ID.
	 * @param int $field_id Relation field post ID.
	 * @return int[]
	 */
	private function visible_relation_values( int $row_id, int $field_id ): array {
		return $this->visible_relation_values_from_ids(
			Relations::relation_values( $row_id, $field_id )
		);
	}

	/**
	 * Filters trashed targets out of raw relation IDs. Callers can prime the
	 * post cache first, before this method starts calling `get_post`.
	 *
	 * @param int[] $raw_ids Raw target IDs from `Relations::relation_values`.
	 * @return int[]
	 */
	private function visible_relation_values_from_ids( array $raw_ids ): array {
		$ids = array();
		foreach ( $raw_ids as $target_id ) {
			$target = get_post( $target_id );
			if ( $target instanceof WP_Post && 'trash' !== $target->post_status ) {
				$ids[] = $target_id;
			}
		}
		return $ids;
	}

	private function compute_rollup_value( int $row_id, int $field_id, ?RowFormatContext $ctx = null ): mixed {
		$rollup_meta       = $this->rollup_field_meta_for( $field_id, $ctx );
		$relation_field_id = $rollup_meta['relation_field_id'];
		$target_field_id   = $rollup_meta['target_field_id'];
		$aggregator        = $rollup_meta['aggregator'];

		// Prime raw targets before filtering or reading rollup values.
		$raw_ids = Relations::relation_values( $row_id, $relation_field_id );
		if ( count( $raw_ids ) > 0 ) {
			_prime_post_caches( $raw_ids, false, true );
		}

		$related_ids = $this->visible_relation_values_from_ids( $raw_ids );
		if ( 'count' === $aggregator ) {
			return count( $related_ids );
		}
		if ( $target_field_id < 1 || count( $related_ids ) === 0 ) {
			return 'sum' === $aggregator ? 0 : null;
		}

		if ( in_array( $aggregator, array( 'show_original', 'show_unique' ), true ) ) {
			$values = $this->rollup_values( $related_ids, $target_field_id, $ctx );
			return 'show_unique' === $aggregator ? $this->unique_rollup_values( $values ) : $values;
		}

		if ( in_array( $aggregator, array( 'count_values', 'count_unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty' ), true ) ) {
			return $this->count_rollup_value( $related_ids, $target_field_id, $aggregator, $ctx );
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
	 * @param int[]                 $row_ids         Related row IDs.
	 * @param int                   $target_field_id Rollup target field post ID.
	 * @param RowFormatContext|null $ctx             Optional formatting context.
	 * @return array<int,mixed>
	 */
	private function rollup_values( array $row_ids, int $target_field_id, ?RowFormatContext $ctx = null ): array {
		$values = array();
		foreach ( $row_ids as $row_id ) {
			foreach ( $this->rollup_values_for_row( $row_id, $target_field_id, $ctx ) as $value ) {
				$values[] = $value;
			}
		}
		return $values;
	}

	/**
	 * Returns flattened values for one related row.
	 *
	 * @param int                   $row_id          Related row ID.
	 * @param int                   $target_field_id Rollup target field post ID.
	 * @param RowFormatContext|null $ctx             Optional formatting context.
	 * @return array<int,mixed>
	 */
	private function rollup_values_for_row( int $row_id, int $target_field_id, ?RowFormatContext $ctx = null ): array {
		$type = $this->target_field_type_for( $target_field_id, $ctx );
		if ( 'relation' === $type ) {
			return $this->format_relation_value( $row_id, $target_field_id, $ctx );
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
	 * @param int[]                 $row_ids         Related row IDs.
	 * @param int                   $target_field_id Rollup target field post ID.
	 * @param string                $aggregator      Rollup aggregator.
	 * @param RowFormatContext|null $ctx             Optional formatting context.
	 */
	private function count_rollup_value( array $row_ids, int $target_field_id, string $aggregator, ?RowFormatContext $ctx = null ): int|float {
		$total = count( $row_ids );
		if ( 'count_values' === $aggregator ) {
			return count( $this->rollup_values( $row_ids, $target_field_id, $ctx ) );
		}
		if ( 'count_unique' === $aggregator ) {
			return count( $this->unique_rollup_values( $this->rollup_values( $row_ids, $target_field_id, $ctx ) ) );
		}

		$not_empty = 0;
		foreach ( $row_ids as $row_id ) {
			if ( count( $this->rollup_values_for_row( $row_id, $target_field_id, $ctx ) ) > 0 ) {
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
	 * Returns a map of field ID to field type, reading post meta once per field.
	 *
	 * @param int[] $field_ids Field post IDs.
	 * @return array<int, string>
	 */
	private function field_types_map( array $field_ids ): array {
		$types = array();
		foreach ( $field_ids as $field_id ) {
			$types[ $field_id ] = (string) get_post_meta( $field_id, 'type', true );
		}
		return $types;
	}

	/**
	 * Returns the subset of field IDs whose type stores multiple values.
	 *
	 * @param int[] $field_ids All field IDs for the collection.
	 * @return array<int, true> Keyed by field ID for fast lookup.
	 */
	private function multi_value_field_ids( array $field_ids ): array {
		return $this->multi_value_field_ids_from( $this->field_types_map( $field_ids ) );
	}

	/**
	 * Builds the multi-value map from field types that were already loaded.
	 *
	 * @param array<int, string> $field_types Field ID => type.
	 * @return array<int, true>
	 */
	private function multi_value_field_ids_from( array $field_types ): array {
		$multi = array();
		foreach ( $field_types as $field_id => $field_type ) {
			if ( 'multiselect' === $field_type || ( 'relation' === $field_type && Relations::relation_is_multiple( $field_id ) ) ) {
				$multi[ $field_id ] = true;
			}
		}
		return $multi;
	}

	/**
	 * Collects raw related row IDs for the current page.
	 *
	 * @param WP_Post[]        $posts      Posts in the current page.
	 * @param int[]            $field_ids  Collection field IDs.
	 * @param RowFormatContext $ctx        Formatting context to reuse later.
	 * @return int[] Deduplicated list of related row IDs.
	 */
	private function collect_related_row_ids( array $posts, array $field_ids, RowFormatContext $ctx ): array {
		if ( count( $posts ) === 0 ) {
			return array();
		}

		$relation_field_ids = array();
		foreach ( $field_ids as $field_id ) {
			$type = $ctx->field_types[ $field_id ] ?? '';
			if ( 'relation' === $type ) {
				$relation_field_ids[ $field_id ] = true;
				// The formatter needs this config later, so load it now.
				$this->relation_field_meta_for( $field_id, $ctx );
				continue;
			}
			if ( 'rollup' === $type ) {
				$rollup_meta = $this->rollup_field_meta_for( $field_id, $ctx );
				if ( $rollup_meta['relation_field_id'] > 0 ) {
					$relation_field_ids[ $rollup_meta['relation_field_id'] ] = true;
				}
			}
		}

		if ( count( $relation_field_ids ) === 0 ) {
			return array();
		}

		$ids = array();
		foreach ( $posts as $post ) {
			foreach ( array_keys( $relation_field_ids ) as $relation_field_id ) {
				foreach ( Relations::relation_values( $post->ID, $relation_field_id ) as $target_id ) {
					$ids[ $target_id ] = true;
				}
			}
		}
		return array_keys( $ids );
	}

	/**
	 * Adds hydrated relation values and rollups to the normal row REST
	 * response. Row detail views fetch with `useEntityRecord`, so this
	 * keeps them aligned with `/cortext/v1/rows`.
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

		// Match `format_row` for system fields too. The normal WP response
		// exposes `author` / `date_gmt`, which the row field getters do not
		// read, so detail views would otherwise show "Empty".
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
			// Keep hydrated values out of `meta`. Those keys are registered as
			// strings; if autosave sends hydrated objects back, REST rejects the
			// save with 400. `cortext_hydrated_meta` is read-only display data.
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
	 * @param WP_Post               $post            Entry post object.
	 * @param int[]                 $field_ids       Valid field IDs for the collection.
	 * @param array<int,true>       $multi_field_ids Field IDs that are multi-value.
	 * @param RowFormatContext|null $ctx             Formatting context for rows responses.
	 * @return array
	 */
	private function format_row( WP_Post $post, array $field_ids, array $multi_field_ids, ?RowFormatContext $ctx = null ): array {
		$meta = array();
		foreach ( $field_ids as $field_id ) {
			$key        = "field-{$field_id}";
			$field_type = $ctx->field_types[ $field_id ] ?? (string) get_post_meta( $field_id, 'type', true );

			if ( 'relation' === $field_type ) {
				$meta[ $key ] = $this->format_relation_value( $post->ID, $field_id, $ctx );
			} elseif ( 'rollup' === $field_type ) {
				$meta[ $key ] = $this->compute_rollup_value( $post->ID, $field_id, $ctx );
			} else {
				$meta[ $key ] = $this->format_typed_value(
					$post->ID,
					$field_id,
					$field_type,
					isset( $multi_field_ids[ $field_id ] )
				);
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
	 * Formats stored meta for the field's current type. Values that no longer
	 * fit the type render empty, but the raw meta stays on disk so changing the
	 * type back can show it again.
	 *
	 * @param int    $row_id     Row post ID.
	 * @param int    $field_id   Field post ID.
	 * @param string $field_type Cortext field type.
	 * @param bool   $is_multi   Whether the field allows multiple meta rows.
	 * @return mixed
	 */
	private function format_typed_value( int $row_id, int $field_id, string $field_type, bool $is_multi ) {
		$key = "field-{$field_id}";

		if ( 'multiselect' === $field_type ) {
			$values = get_post_meta( $row_id, $key, false );
			if ( ! is_array( $values ) || count( $values ) === 0 ) {
				return array();
			}
			$normalized = array_values( array_map( 'strval', $values ) );
			$options    = $this->valid_option_values( $field_id );
			if ( count( $options ) === 0 ) {
				return $normalized;
			}
			$matched = array_values(
				array_filter( $normalized, static fn( string $v ): bool => in_array( $v, $options, true ) )
			);
			if ( count( $matched ) > 0 ) {
				return $matched;
			}
			// A single unmatched row may be leftover text from a conversion.
			// Split it, but only keep tokens that are real options.
			if ( count( $normalized ) === 1 && preg_match( '/[\n,;]/', $normalized[0] ) ) {
				$tokens = FieldTypeConverter::split_tokens( $normalized[0] );
				return array_values(
					array_filter( $tokens, static fn( string $v ): bool => in_array( $v, $options, true ) )
				);
			}
			return array();
		}

		$stored = $is_multi
			? get_post_meta( $row_id, $key, false )
			: get_post_meta( $row_id, $key, true );

		if ( 'select' === $field_type ) {
			$value = is_array( $stored ) ? '' : trim( (string) $stored );
			if ( '' === $value ) {
				return '';
			}
			$options = $this->valid_option_values( $field_id );
			if ( count( $options ) === 0 ) {
				return $value;
			}
			if ( in_array( $value, $options, true ) ) {
				return $value;
			}
			// Leftover delimited text from a conversion: use the first token
			// only if it is now a real option.
			if ( preg_match( '/[\n,;]/', $value ) ) {
				$tokens = FieldTypeConverter::split_tokens( $value );
				if ( count( $tokens ) > 0 && in_array( $tokens[0], $options, true ) ) {
					return $tokens[0];
				}
			}
			return '';
		}

		if ( 'number' === $field_type ) {
			if ( is_array( $stored ) || null === $stored || '' === $stored ) {
				return null;
			}
			return is_numeric( $stored ) ? (float) $stored : null;
		}

		if ( 'date' === $field_type || 'datetime' === $field_type ) {
			$text = is_array( $stored ) ? '' : trim( (string) $stored );
			if ( '' === $text ) {
				return '';
			}
			$timestamp = strtotime( $text );
			if ( false === $timestamp ) {
				return '';
			}
			return 'date' === $field_type
				? gmdate( 'Y-m-d', $timestamp )
				: gmdate( DATE_RFC3339, $timestamp );
		}

		if ( 'checkbox' === $field_type ) {
			if ( is_array( $stored ) || null === $stored || '' === $stored ) {
				return false;
			}
			return Relations::is_truthy( $stored );
		}

		if ( 'email' === $field_type ) {
			$value = is_array( $stored ) ? '' : trim( (string) $stored );
			if ( '' === $value ) {
				return '';
			}
			return false !== is_email( $value ) ? $value : '';
		}

		if ( 'url' === $field_type ) {
			$value = is_array( $stored ) ? '' : trim( (string) $stored );
			if ( '' === $value ) {
				return '';
			}
			return false !== wp_http_validate_url( $value ) ? $value : '';
		}

		if ( 'text' === $field_type ) {
			// If this used to be multiselect, show all remaining meta rows.
			$all = get_post_meta( $row_id, $key, false );
			if ( is_array( $all ) && count( $all ) > 1 ) {
				$text = implode( ', ', array_map( 'strval', $all ) );
			} else {
				$text = is_array( $stored ) ? '' : (string) $stored;
			}
			$prior_format = (string) get_post_meta( $field_id, 'prior_date_format', true );
			if ( '' !== $prior_format && '' !== trim( $text ) ) {
				$timestamp = strtotime( trim( $text ) );
				if ( false !== $timestamp ) {
					$format = in_array( $prior_format, array( 'date', 'datetime' ), true )
						? ( 'date' === $prior_format ? 'Y-m-d' : DATE_RFC3339 )
						: $prior_format;
					return wp_date( $format, $timestamp );
				}
			}
			return $text;
		}

		return $stored;
	}

	/**
	 * Reads valid values for a select or multiselect field.
	 *
	 * @param int $field_id Field post ID whose options should be read.
	 * @return string[]
	 */
	private function valid_option_values( int $field_id ): array {
		$raw = (string) get_post_meta( $field_id, 'options', true );
		if ( '' === $raw ) {
			return array();
		}
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) {
			return array();
		}
		$values = array();
		foreach ( $decoded as $entry ) {
			if ( is_array( $entry ) && isset( $entry['value'] ) ) {
				$value = trim( (string) $entry['value'] );
				if ( '' !== $value ) {
					$values[] = $value;
				}
			}
		}
		return $values;
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
	 * @return array{id:int,title:array{raw:string,rendered:string},slug:string,manual_order_seeded:bool}
	 */
	private function collection_definition( WP_Post $collection, string $slug ): array {
		$manual_order = new RowsManualOrder();
		return array(
			'id'                  => $collection->ID,
			'title'               => array(
				'raw'      => $collection->post_title,
				'rendered' => $collection->post_title,
			),
			'slug'                => $slug,
			'manual_order_seeded' => $manual_order->is_seeded( $collection->ID ),
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
			$type    = (string) get_post_meta( $field_id, 'type', true );
			$options = get_post_meta( $field_id, 'options', true );

			$definitions[] = array(
				'id'      => $field_id,
				'label'   => $field->post_title,
				'type'    => $type,
				'options' => empty( $options ) ? null : $options,
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
