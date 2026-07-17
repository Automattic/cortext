<?php
/**
 * REST endpoint for the `rows view` of `crtxt_document`: the filtered, sorted,
 * paged listing the workspace consumes when rendering a DataView.
 *
 * Rows themselves are plain `crtxt_document` posts with a `crtxt_trait`
 * term pointing at their collection. Their CRUD goes through core REST
 * (`/wp/v2/crtxt_documents/...`), with relation reverse pointers and sidecar
 * cache maintained from `Document` hooks. This controller only owns the
 * power-query read endpoint because core REST cannot express server-side
 * calculations, manual sort, or field projection.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\Fields\FieldDefaults;
use Cortext\Fields\FieldTypeConverter;
use Cortext\FieldValues\FieldValueReadQuery;
use Cortext\Formula\Materializer as FormulaMaterializer;
use Cortext\PostType\Document;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;

final class RowsController {

	private const NAMESPACE                   = 'cortext/v1';
	private const COUNT_CALCULATIONS          = array(
		'count',
		'countValues',
		'countUnique',
		'empty',
		'notEmpty',
	);
	private const PRESENCE_COUNT_CALCULATIONS = array( 'count', 'empty', 'notEmpty' );
	private const BOOLEAN_COUNT_CALCULATIONS  = array( 'count' );
	private const PERCENT_CALCULATIONS        = array( 'percentEmpty', 'percentNotEmpty' );
	private const NUMBER_CALCULATIONS         = array(
		'sum',
		'average',
		'median',
		'min',
		'max',
		'range',
	);
	private const NUMBER_TYPES                = array( 'number', 'integer' );
	private const DATE_TYPES                  = array( 'date', 'datetime' );
	private const BOOLEAN_TYPES               = array( 'boolean', 'checkbox' );
	private const MULTI_VALUE_TYPES           = array( 'array', 'multiselect' );
	private const SCALAR_COUNT_TYPES          = array(
		'title',
		'text',
		'email',
		'url',
		'select',
		'number',
		'integer',
		'date',
		'datetime',
	);

	/**
	 * Formatting contexts cached for the lifetime of each core REST request.
	 *
	 * @var \WeakMap<WP_REST_Request,array<int,RowFormatContext>>
	 */
	private \WeakMap $rest_prepare_format_contexts;

	public function __construct() {
		$this->rest_prepare_format_contexts = new \WeakMap();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		// Add hydrated relations and rollups to the unified document REST
		// response. Peek/modal panes fetch rows with `useEntityRecord`;
		// without this hook, relation meta is still raw stored IDs and
		// rollups are missing. The filter only acts when the document has
		// trait membership (i.e. it is a row).
		add_filter(
			'rest_prepare_' . Document::POST_TYPE,
			array( $this, 'filter_rest_prepare_row' ),
			10,
			3
		);

		register_rest_route(
			self::NAMESPACE,
			'/rows',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_rows' ),
					'permission_callback' => array( $this, 'can_read' ),
					'args'                => array(
						'trait'        => array(
							'type'     => 'integer',
							'required' => true,
						),
						'page'         => array(
							'type'    => 'integer',
							'default' => 1,
							'minimum' => 1,
						),
						'per_page'     => array(
							'type'              => 'integer',
							'default'           => 25,
							'validate_callback' => array( $this, 'validate_per_page_param' ),
						),
						'shape'        => array(
							'type'    => 'string',
							'default' => 'full',
							'enum'    => array( 'full', 'ids' ),
						),
						'search'       => array(
							'type'    => 'string',
							'default' => '',
						),
						'sort'         => array(
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
						'filters'      => array(
							'type'    => 'array',
							'default' => array(),
						),
						'include'      => array(
							'type'              => 'array',
							'default'           => array(),
							'items'             => array( 'type' => 'integer' ),
							'sanitize_callback' => array( $this, 'sanitize_include_param' ),
							'validate_callback' => array( $this, 'validate_include_param' ),
						),
						'fields'       => array(
							'type'    => 'array',
							'default' => null,
							'items'   => array( 'type' => 'string' ),
						),
						'calculations' => array(
							'type'       => 'object',
							'default'    => array(),
							'properties' => array(),
						),
						'context'      => array(
							'type'    => 'string',
							'default' => 'edit',
							'enum'    => array( 'view', 'edit' ),
						),
					),
				),
			)
		);
	}

	/**
	 * Permission gate for the rows endpoint.
	 *
	 * `context=edit` is the default editor path and requires `edit_posts`.
	 * `context=view` is the public opt-in: anyone may read rows from a
	 * published collection.
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

		// context=view: allow if the collection document is published.
		$collection_id = (int) $request->get_param( 'trait' );
		$collection    = get_post( $collection_id );

		if ( ! $collection || ! Document::is_collection_post( $collection ) ) {
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

	/**
	 * Returns paginated, sortable, filterable rows for a collection.
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_rows( WP_REST_Request $request ) {
		$collection_id = (int) $request->get_param( 'trait' );

		$collection = $this->validate_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		$shape = (string) $request->get_param( 'shape' );
		if ( 'ids' === $shape && 'edit' !== (string) $request->get_param( 'context' ) ) {
			return new WP_Error(
				'cortext_rows_ids_shape_requires_edit_context',
				__( 'The ID-only response shape requires edit context.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$field_ids           = Document::collection_field_ids( $collection->ID );
		$requested_fields    = $request->get_param( 'fields' );
		$formatted_field_ids = is_array( $requested_fields )
			? $this->filter_requested_field_ids( $requested_fields, $field_ids )
			: $field_ids;
		$row_query           = new RowsFilterQuery();
		$field_schema        = $row_query->field_schema_for( $collection_id );
		$fields              = $this->field_definitions( $field_ids );

		$calculation_requests = $this->validated_calculations(
			$request->get_param( 'calculations' ),
			$field_schema,
			$collection_id
		);
		if ( is_wp_error( $calculation_requests ) ) {
			return $calculation_requests;
		}

		// If `include` was sent but sanitizes to an empty list, return no rows.
		// Falling through would return page 1 of the collection, which is not
		// what the caller asked for. The picker does not send empty ID lists,
		// but future callers might.
		$query_params = $request->get_query_params();
		if ( array_key_exists( 'include', $query_params ) && count( (array) $request->get_param( 'include' ) ) === 0 ) {
			if ( 'ids' === $shape ) {
				return new WP_REST_Response(
					array(
						'ids'        => array(),
						'total'      => 0,
						'totalPages' => 0,
					),
					200
				);
			}

			$response = array(
				'rows'       => array(),
				'total'      => 0,
				'totalPages' => 0,
				'collection' => $this->collection_definition( $collection ),
				'fields'     => $fields,
			);
			if ( count( $calculation_requests ) > 0 ) {
				$response['calculations'] = $this->calculate_rows(
					array(),
					$calculation_requests,
					$field_schema
				);
			}
			return new WP_REST_Response(
				$response,
				200
			);
		}

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

		$search       = (string) $request->get_param( 'search' );
		$search_where = $row_query->compile_search( $search, $field_schema );
		$where_parts  = array_values( array_filter( array( $filter_sql['where'], $search_where ) ) );
		$where_sql    = count( $where_parts ) > 0 ? '( ' . implode( ' AND ', $where_parts ) . ' )' : '';

		// tech-debt.md#td-formula-materialized-values: volatile formula sort/filter reads materialized meta.
		if ( $this->query_needs_volatile_formula_materialization( $collection_id, $request ) ) {
			FormulaMaterializer::recompute_collection( $collection_id );
		}

		$row_statuses = $this->row_statuses_for_request();

		if ( 'ids' === $shape ) {
			$ids_result = ( new FieldValueReadQuery() )->query_row_ids(
				$collection_id,
				$field_schema,
				$request->get_param( 'filters' ),
				$request->get_param( 'sort' ),
				$search,
				array_key_exists( 'include', $query_params ),
				(int) $request->get_param( 'page' ),
				(int) $request->get_param( 'per_page' ),
				$row_statuses
			);

			if ( null !== $ids_result ) {
				$ids         = $ids_result['ids'];
				$total       = $ids_result['total'];
				$total_pages = $ids_result['totalPages'];
			} else {
				$query = $this->run_rows_query_fallback(
					$request,
					$row_query,
					$field_schema,
					$where_sql,
					$filter_sql,
					$collection_id,
					$row_statuses,
					$search,
					'ids'
				);

				$ids         = array_map( 'intval', (array) $query->posts );
				$total       = (int) $query->found_posts;
				$total_pages = (int) $query->max_num_pages;
			}

			return new WP_REST_Response(
				array(
					'ids'        => $ids,
					'total'      => $total,
					'totalPages' => $total_pages,
				),
				200
			);
		}

		// Keep row-formatting metadata local to this rows response. Passing the
		// context through the helpers avoids stale state in CLI and test runs.
		$ctx              = new RowFormatContext();
		$ctx->field_types = $this->field_types_map( $formatted_field_ids );
		$multi_field_ids  = $this->multi_value_field_ids_from( $ctx->field_types );

		$sidecar_result = ( new FieldValueReadQuery() )->query_rows(
			$collection_id,
			$field_schema,
			$request->get_param( 'filters' ),
			$request->get_param( 'sort' ),
			$search,
			array_key_exists( 'include', $query_params ),
			(int) $request->get_param( 'page' ),
			(int) $request->get_param( 'per_page' ),
			$row_statuses
		);

		if ( null !== $sidecar_result ) {
			$posts       = $sidecar_result['posts'];
			$total       = $sidecar_result['total'];
			$total_pages = $sidecar_result['totalPages'];
		} else {
			$query = $this->run_rows_query_fallback(
				$request,
				$row_query,
				$field_schema,
				$where_sql,
				$filter_sql,
				$collection_id,
				$row_statuses,
				$search
			);

			$posts       = $query->posts;
			$total       = (int) $query->found_posts;
			$total_pages = (int) $query->max_num_pages;
		}

		FormulaMaterializer::recompute_posts( $collection_id, $posts );

		// Prime the user object cache once before mapping rows so per-row
		// display name lookups in format_row hit the cache instead of
		// running N+1 queries.
		$this->prime_user_cache( $posts );

		// Prime related rows once before formatting. Relation chips need post
		// objects, and rollups need post meta.
		$related_ids = $this->collect_related_row_ids( $posts, $formatted_field_ids, $ctx );
		if ( count( $related_ids ) > 0 ) {
			_prime_post_caches( $related_ids, false, true );
		}

		$rows = array_map(
			function ( WP_Post $post ) use ( $formatted_field_ids, $multi_field_ids, $ctx ) {
				return $this->format_row( $post, $formatted_field_ids, $multi_field_ids, $ctx );
			},
			$posts
		);

		$response = array(
			'rows'       => $rows,
			'total'      => $total,
			'totalPages' => $total_pages,
			'collection' => $this->collection_definition( $collection ),
			'fields'     => $fields,
		);

		if ( count( $calculation_requests ) > 0 ) {
			$calculation_posts        = $this->query_posts_for_calculations(
				$request,
				$collection_id,
				$row_statuses,
				$row_query,
				$field_schema,
				$where_sql,
				$filter_sql['join']
			);
			$response['calculations'] = $this->calculate_rows(
				$calculation_posts,
				$calculation_requests,
				$field_schema
			);
		}

		return new WP_REST_Response( $response, 200 );
	}

	/**
	 * Checks that the given ID points to a valid, registered collection.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return WP_Post|WP_Error
	 */
	private function validate_collection( int $collection_id ) {
		$collection = get_post( $collection_id );

		if ( ! $collection || ! Document::is_collection_post( $collection ) ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( Relations::trait_term_id_for_collection( $collection_id ) < 1 ) {
			return new WP_Error(
				'cortext_collection_not_registered',
				__( 'Collection mirror term is not registered.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $collection;
	}

	/**
	 * Filters a requested `fields[]` list down to this collection's live fields.
	 *
	 * Saved views may send system columns or field IDs that no longer exist.
	 * `format_row` only accepts custom field IDs, so keep only live `field-<n>`
	 * keys.
	 *
	 * @param array $requested Raw `fields[]` request value.
	 * @param int[] $field_ids Collection field IDs.
	 * @return int[] Field IDs to format for each row.
	 */
	private function filter_requested_field_ids( array $requested, array $field_ids ): array {
		$available = array_flip( $field_ids );
		$kept      = array();
		foreach ( $requested as $entry ) {
			if ( ! is_string( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^field-(\d+)$/', $entry, $matches ) ) {
				continue;
			}
			$id = (int) $matches[1];
			if ( isset( $available[ $id ] ) ) {
				$kept[ $id ] = $id;
			}
		}
		return array_values( $kept );
	}

	/**
	 * Translates REST params into WP_Query arguments.
	 *
	 * @param WP_REST_Request $request       Full request object.
	 * @param int             $collection_id Collection (trait) post ID.
	 * @param string[]        $row_statuses  Post statuses visible to this request.
	 * @return array
	 */
	private function build_query_args( WP_REST_Request $request, int $collection_id, array $row_statuses ): array {
		$args = array(
			'post_type'      => Document::POST_TYPE,
			'post_status'    => $row_statuses,
			'posts_per_page' => (int) $request->get_param( 'per_page' ),
			'paged'          => (int) $request->get_param( 'page' ),
		);

		$trait_term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $trait_term_id > 0 ) {
			$args['tax_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
				array(
					'taxonomy' => TraitTaxonomy::TAXONOMY,
					'field'    => 'term_id',
					'terms'    => array( $trait_term_id ),
				),
			);
		}

		$include = (array) $request->get_param( 'include' );
		if ( count( $include ) > 0 ) {
			// The by-ID response is read as a Map<id, row>, not an ordered list.
			// Keep a stable ID order so callers do not start depending on the
			// order of the include array.
			$args['post__in'] = $include;
		}

		$sort = $request->get_param( 'sort' );
		if ( ! is_array( $sort ) || empty( $sort['field'] ) ) {
			// Manual position lives in term_order, applied by
			// RowsFilterQuery::apply_manual_order_clauses. ID order is the
			// fallback when no collection term scope is available.
			$args['orderby'] = array( 'ID' => 'ASC' );
		} else {
			$direction = ( $sort['direction'] ?? 'asc' ) === 'desc' ? 'DESC' : 'ASC';

			if ( 'title' === $sort['field'] ) {
				$args['orderby'] = 'title';
				$args['order']   = $direction;
			} elseif ( 'manual' === $sort['field'] ) {
				// Manual position lives in term_order; the clause filter sets the
				// ORDER BY. Keep ID as the no-scope fallback.
				$args['orderby'] = array( 'ID' => 'ASC' );
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
	 * Runs a row query against postmeta when the field-value index cannot handle the request.
	 *
	 * Both response shapes share this path. Passing `ids` lets WP_Query skip
	 * post hydration.
	 *
	 * @param WP_REST_Request $request       REST request.
	 * @param RowsFilterQuery $row_query     Filter/sort SQL compiler.
	 * @param array           $field_schema  Field schema for the collection.
	 * @param string          $where_sql     Compiled filter/search WHERE clause.
	 * @param array           $filter_sql    Compiled filter SQL parts (join/where).
	 * @param int             $collection_id Collection (trait) post ID.
	 * @param string[]        $row_statuses  Post statuses visible to this request.
	 * @param string          $search        Raw REST search parameter.
	 * @param string          $fields        WP_Query `fields` value ('' or 'ids').
	 * @return WP_Query
	 */
	private function run_rows_query_fallback(
		WP_REST_Request $request,
		RowsFilterQuery $row_query,
		array $field_schema,
		string $where_sql,
		array $filter_sql,
		int $collection_id,
		array $row_statuses,
		string $search,
		string $fields = ''
	): WP_Query {
		$query_args = $this->build_query_args( $request, $collection_id, $row_statuses );
		if ( '' !== $fields ) {
			$query_args['fields'] = $fields;
		}

		$scope = new RowsQueryScope(
			$row_query,
			$field_schema,
			$where_sql,
			$filter_sql['join'],
			$request->get_param( 'sort' ),
			$search,
			TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id )
		);

		return $scope->run( $query_args );
	}

	/**
	 * Builds the unpaged query for table calculation totals.
	 *
	 * @param WP_REST_Request $request       Full request object.
	 * @param int             $collection_id Collection (trait) post ID.
	 * @param string[]        $row_statuses  Post statuses visible to this request.
	 * @return array
	 */
	private function build_calculation_query_args( WP_REST_Request $request, int $collection_id, array $row_statuses ): array {
		$args = array(
			'post_type'      => Document::POST_TYPE,
			'post_status'    => $row_statuses,
			'posts_per_page' => -1,
			'paged'          => 1,
			'no_found_rows'  => true,
			'orderby'        => array( 'ID' => 'ASC' ),
		);

		$trait_term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $trait_term_id > 0 ) {
			$args['tax_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
				array(
					'taxonomy' => TraitTaxonomy::TAXONOMY,
					'field'    => 'term_id',
					'terms'    => array( $trait_term_id ),
				),
			);
		}

		$include = (array) $request->get_param( 'include' );
		if ( count( $include ) > 0 ) {
			$args['post__in'] = $include;
		}

		return $args;
	}

	/**
	 * Queries every row in the current filter and search scope for calculations.
	 *
	 * @param WP_REST_Request $request       Full request object.
	 * @param int             $collection_id Collection (trait) post ID.
	 * @param string[]        $row_statuses  Post statuses visible to this request.
	 * @param RowsFilterQuery $row_query     Row filter/search compiler.
	 * @param array           $field_schema  Field schema from RowsFilterQuery.
	 * @param string          $where_sql     Compiled filter/search WHERE SQL.
	 * @param string          $join_sql      Compiled filter JOIN SQL.
	 * @return WP_Post[]
	 */
	private function query_posts_for_calculations(
		WP_REST_Request $request,
		int $collection_id,
		array $row_statuses,
		RowsFilterQuery $row_query,
		array $field_schema,
		string $where_sql,
		string $join_sql
	): array {
		$scope = new RowsQueryScope(
			$row_query,
			$field_schema,
			$where_sql,
			$join_sql,
			null,
			'',
			TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id )
		);
		$query = $scope->run(
			$this->build_calculation_query_args( $request, $collection_id, $row_statuses )
		);

		return array_values(
			array_filter(
				$query->posts,
				static fn( $post ): bool => $post instanceof WP_Post
			)
		);
	}

	/**
	 * Adds system fields that can be visible in DataViews, but are not sortable
	 * or filterable row-query fields.
	 *
	 * @param array $field_schema Base query field schema.
	 * @return array
	 */
	private function calculation_field_schema( array $field_schema ): array {
		unset( $field_schema['manual'] );

		$field_schema['cover']       = array(
			'id'     => 0,
			'key'    => 'cover',
			'type'   => 'media',
			'system' => true,
		);
		$field_schema['created_by']  = array(
			'id'     => 0,
			'key'    => 'created_by',
			'type'   => 'text',
			'system' => true,
		);
		$field_schema['modified_by'] = array(
			'id'     => 0,
			'key'    => 'modified_by',
			'type'   => 'text',
			'system' => true,
		);

		return $field_schema;
	}

	/**
	 * Validates the requested `calculations[field-id]=operation` map.
	 *
	 * @param mixed $raw           Raw request value.
	 * @param array $field_schema  Field schema from RowsFilterQuery.
	 * @param int   $collection_id Collection post ID for errors.
	 * @return array<string,string>|WP_Error
	 */
	private function validated_calculations( mixed $raw, array $field_schema, int $collection_id ): array|WP_Error {
		if ( null === $raw || array() === $raw || '' === $raw ) {
			return array();
		}
		if ( ! is_array( $raw ) ) {
			return new WP_Error(
				'cortext_invalid_calculations',
				__( 'Calculations must be an object keyed by field ID.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$schema   = $this->calculation_field_schema( $field_schema );
		$requests = array();
		foreach ( $raw as $field_key => $calculation ) {
			$field_key   = (string) $field_key;
			$calculation = (string) $calculation;

			if ( ! isset( $schema[ $field_key ] ) ) {
				return new WP_Error(
					'cortext_invalid_calculation_field',
					sprintf(
						/* translators: 1: field key, 2: collection ID */
						__( 'Field "%1$s" cannot be calculated for collection %2$d.', 'cortext' ),
						$field_key,
						$collection_id
					),
					array( 'status' => 400 )
				);
			}

			if ( ! $this->is_calculation_available( $schema[ $field_key ], $calculation ) ) {
				return new WP_Error(
					'cortext_invalid_calculation',
					sprintf(
						/* translators: 1: calculation key, 2: field key */
						__( 'Calculation "%1$s" is not available for field "%2$s".', 'cortext' ),
						$calculation,
						$field_key
					),
					array( 'status' => 400 )
				);
			}

			$requests[ $field_key ] = $calculation;
		}

		return $requests;
	}

	/**
	 * Returns all calculations available for a schema field.
	 *
	 * @param array $field Schema field entry.
	 * @return string[]
	 */
	private function calculation_options_for_field( array $field ): array {
		$type          = (string) ( $field['type'] ?? 'text' );
		$count_options = self::PRESENCE_COUNT_CALCULATIONS;
		if ( in_array( $type, self::BOOLEAN_TYPES, true ) ) {
			$count_options = self::BOOLEAN_COUNT_CALCULATIONS;
		} elseif ( in_array( $type, self::SCALAR_COUNT_TYPES, true ) ) {
			$count_options = self::COUNT_CALCULATIONS;
		} elseif ( in_array( $type, self::MULTI_VALUE_TYPES, true ) ) {
			$count_options = self::PRESENCE_COUNT_CALCULATIONS;
		}

		$options = $count_options;
		if ( in_array( 'empty', $count_options, true ) && in_array( 'notEmpty', $count_options, true ) ) {
			$options = array_merge( $options, self::PERCENT_CALCULATIONS );
		}
		if ( in_array( $type, self::NUMBER_TYPES, true ) ) {
			$options = array_merge( $options, self::NUMBER_CALCULATIONS );
		} elseif ( in_array( $type, self::DATE_TYPES, true ) ) {
			$options = array_merge( $options, array( 'min', 'max' ) );
		}

		return array_values( array_unique( $options ) );
	}

	private function is_calculation_available( array $field, string $calculation ): bool {
		return in_array( $calculation, $this->calculation_options_for_field( $field ), true );
	}

	/**
	 * Computes raw calculation values for a list of matching rows.
	 *
	 * @param WP_Post[]            $posts        Matching rows.
	 * @param array<string,string> $requests     Field key => calculation key.
	 * @param array                $field_schema Field schema from RowsFilterQuery.
	 * @return array<string,array{calculation:string,value:mixed}>
	 */
	private function calculate_rows( array $posts, array $requests, array $field_schema ): array {
		$schema           = $this->calculation_field_schema( $field_schema );
		$custom_field_ids = array();
		foreach ( $requests as $field_key => $calculation ) {
			if ( 'count' === $calculation ) {
				continue;
			}
			if ( preg_match( '/^field-(\d+)$/', $field_key, $matches ) ) {
				$custom_field_ids[] = (int) $matches[1];
			}
		}
		$custom_field_ids = array_values( array_unique( $custom_field_ids ) );

		$ctx              = new RowFormatContext();
		$ctx->field_types = $this->field_types_map( $custom_field_ids );
		$multi_field_ids  = $this->multi_value_field_ids_from( $ctx->field_types );

		$this->prime_user_cache( $posts );
		$related_ids = $this->collect_related_row_ids( $posts, $custom_field_ids, $ctx );
		if ( count( $related_ids ) > 0 ) {
			_prime_post_caches( $related_ids, false, true );
		}

		$results = array();
		foreach ( $requests as $field_key => $calculation ) {
			if ( ! isset( $schema[ $field_key ] ) ) {
				continue;
			}

			if ( 'count' === $calculation ) {
				$results[ $field_key ] = array(
					'calculation' => $calculation,
					'value'       => count( $posts ),
				);
				continue;
			}

			$field  = $schema[ $field_key ];
			$values = array_map(
				function ( WP_Post $post ) use ( $field_key, $field, $ctx, $multi_field_ids ) {
					return $this->calculation_value_for_post( $post, $field_key, $field, $ctx, $multi_field_ids );
				},
				$posts
			);

			$results[ $field_key ] = array(
				'calculation' => $calculation,
				'value'       => $this->calculate_values( $values, $field, $calculation, count( $posts ) ),
			);
		}

		return $results;
	}

	/**
	 * Reads the normalized row value used by table calculations.
	 *
	 * @param WP_Post          $post            Row post.
	 * @param string           $field_key       DataView field key.
	 * @param array            $field           Schema field entry.
	 * @param RowFormatContext $ctx            Formatting context.
	 * @param array<int,true>  $multi_field_ids Multi-value custom fields.
	 * @return mixed
	 */
	private function calculation_value_for_post( WP_Post $post, string $field_key, array $field, RowFormatContext $ctx, array $multi_field_ids ): mixed {
		if ( 'title' === $field_key ) {
			return $post->post_title;
		}
		if ( 'created_at' === $field_key ) {
			return $this->format_gmt_date( $post->post_date_gmt );
		}
		if ( 'modified_at' === $field_key ) {
			return $this->format_gmt_date( $post->post_modified_gmt );
		}
		if ( 'created_by' === $field_key ) {
			return $this->display_name_for( (int) $post->post_author );
		}
		if ( 'modified_by' === $field_key ) {
			$modified_by_id = (int) get_post_meta( $post->ID, '_modified_by', true );
			return $this->display_name_for( $modified_by_id > 0 ? $modified_by_id : (int) $post->post_author );
		}
		if ( 'cover' === $field_key ) {
			$cover = $this->cover_data_for_post( $post );
			return $cover['url'] ?? '';
		}

		if ( ! preg_match( '/^field-(\d+)$/', $field_key, $matches ) ) {
			return null;
		}

		$field_id   = (int) $matches[1];
		$field_type = (string) ( $field['type'] ?? '' );
		if ( 'relation' === $field_type ) {
			return $this->format_relation_value( $post->ID, $field_id, $ctx );
		}
		if ( 'rollup' === $field_type ) {
			return $this->compute_rollup_value( $post->ID, $field_id, $ctx );
		}
		return $this->format_typed_value(
			$post->ID,
			$field_id,
			$field_type,
			isset( $multi_field_ids[ $field_id ] )
		);
	}

	/**
	 * Computes one raw calculation value.
	 *
	 * @param array  $values      Normalized row values.
	 * @param array  $field       Schema field entry.
	 * @param string $calculation Calculation key.
	 * @param int    $row_count   Matching row count.
	 * @return mixed
	 */
	private function calculate_values( array $values, array $field, string $calculation, int $row_count ): mixed {
		if ( 'count' === $calculation ) {
			return $row_count;
		}

		$populated = array_values(
			array_filter(
				$values,
				fn( $value ): bool => ! $this->is_empty_calculation_value( $value )
			)
		);

		return match ( $calculation ) {
			'countValues' => count( $populated ),
			'countUnique' => count( array_unique( array_map( array( $this, 'unique_calculation_key' ), $populated ) ) ),
			'empty' => $row_count - count( $populated ),
			'notEmpty' => count( $populated ),
			'percentEmpty' => $row_count > 0 ? ( $row_count - count( $populated ) ) / $row_count : null,
			'percentNotEmpty' => $row_count > 0 ? count( $populated ) / $row_count : null,
			'sum' => $this->sum_calculation_value( $values ),
			'average' => $this->average_calculation_value( $values ),
			'median' => $this->median_calculation_value( $values ),
			'range' => $this->range_calculation_value( $values ),
			'min', 'max' => $this->extrema_calculation_value( $values, $field, $calculation ),
			default => null,
		};
	}

	private function is_empty_calculation_value( mixed $value ): bool {
		return null === $value || '' === $value || ( is_array( $value ) && count( $value ) === 0 );
	}

	private function unique_calculation_key( mixed $value ): string {
		if ( is_array( $value ) ) {
			$items = array_map( 'strval', $value );
			sort( $items, SORT_STRING );
			return (string) wp_json_encode( $items );
		}
		return (string) $value;
	}

	/**
	 * Returns finite numeric values used by math calculations.
	 *
	 * @param array $values Normalized row values.
	 * @return float[]
	 */
	private function numeric_calculation_values( array $values ): array {
		$numbers = array();
		foreach ( $values as $value ) {
			if ( $this->is_empty_calculation_value( $value ) || ! is_numeric( $value ) ) {
				continue;
			}
			$numbers[] = (float) $value;
		}
		return $numbers;
	}

	private function sum_calculation_value( array $values ): ?float {
		$numbers = $this->numeric_calculation_values( $values );
		return count( $numbers ) > 0 ? array_sum( $numbers ) : null;
	}

	private function average_calculation_value( array $values ): ?float {
		$numbers = $this->numeric_calculation_values( $values );
		return count( $numbers ) > 0 ? array_sum( $numbers ) / count( $numbers ) : null;
	}

	private function median_calculation_value( array $values ): ?float {
		$numbers = $this->numeric_calculation_values( $values );
		if ( count( $numbers ) === 0 ) {
			return null;
		}
		sort( $numbers, SORT_NUMERIC );
		$count  = count( $numbers );
		$middle = intdiv( $count, 2 );
		if ( 1 === $count % 2 ) {
			return $numbers[ $middle ];
		}
		return ( $numbers[ $middle - 1 ] + $numbers[ $middle ] ) / 2;
	}

	private function range_calculation_value( array $values ): ?float {
		$numbers = $this->numeric_calculation_values( $values );
		return count( $numbers ) > 0 ? max( $numbers ) - min( $numbers ) : null;
	}

	private function extrema_calculation_value( array $values, array $field, string $direction ): mixed {
		$type = (string) ( $field['type'] ?? 'text' );
		$best = null;
		foreach ( $values as $value ) {
			$comparable = $this->comparable_calculation_value( $value, $type );
			if ( null === $comparable ) {
				continue;
			}

			if (
				null === $best ||
				( 'min' === $direction && $comparable < $best['comparable'] ) ||
				( 'max' === $direction && $comparable > $best['comparable'] )
			) {
				$best = array(
					'comparable' => $comparable,
					'value'      => $value,
				);
			}
		}

		return $best['value'] ?? null;
	}

	private function comparable_calculation_value( mixed $value, string $type ): int|float|null {
		if ( $this->is_empty_calculation_value( $value ) ) {
			return null;
		}
		if ( in_array( $type, self::NUMBER_TYPES, true ) ) {
			return is_numeric( $value ) ? (float) $value : null;
		}
		if ( in_array( $type, self::DATE_TYPES, true ) ) {
			$timestamp = strtotime( (string) $value );
			return false === $timestamp ? null : $timestamp;
		}
		return null;
	}

	private function row_statuses_for_request(): array {
		// Rows default to private; public visibility is controlled by the
		// published collection/page gate, not each row's internal status.
		return array( 'draft', 'private', 'publish' );
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

	/**
	 * Validates the row page size. Full row responses keep the existing cap, while
	 * ID responses allow larger pages because they skip row formatting.
	 *
	 * @param mixed           $value   Raw per_page value.
	 * @param WP_REST_Request $request REST request.
	 * @return true|WP_Error
	 */
	public function validate_per_page_param( mixed $value, WP_REST_Request $request ): bool|WP_Error {
		$per_page = (int) $value;
		$max      = 'ids' === (string) $request->get_param( 'shape' ) ? 1000 : 100;
		if ( $per_page >= 1 && $per_page <= $max ) {
			return true;
		}

		return new WP_Error(
			'rest_invalid_param',
			sprintf(
				/* translators: %d: maximum number of rows allowed per page. */
				__( 'per_page must be between 1 and %d.', 'cortext' ),
				$max
			),
			array( 'status' => 400 )
		);
	}

	/**
	 * Formats resolved references for a relation field.
	 *
	 * @param int                   $row_id   Row post ID.
	 * @param int                   $field_id Relation field post ID.
	 * @param RowFormatContext|null $ctx      Formatting context for rows responses.
	 * @return array<int,array{id:int,slug:string,title:array{raw:string,rendered:string},collectionId:int}>
	 */
	private function format_relation_value( int $row_id, int $field_id, ?RowFormatContext $ctx = null ): array {
		$relation_meta        = $this->relation_field_meta_for( $field_id, $ctx );
		$target_collection_id = $relation_meta['related_collection_id'];

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
				'id'           => $target_id,
				'slug'         => (string) $target->post_name,
				'title'        => array(
					'raw'      => $target->post_title,
					'rendered' => $target->post_title,
				),
				'collectionId' => $target_collection_id,
			);
		}

		return $refs;
	}

	/**
	 * Reads relation field config through the current formatting context.
	 *
	 * @param int                   $field_id Relation field post ID.
	 * @param RowFormatContext|null $ctx      Optional formatting context.
	 * @return array{related_collection_id: int}
	 */
	private function relation_field_meta_for( int $field_id, ?RowFormatContext $ctx ): array {
		if ( null !== $ctx && isset( $ctx->relation_field_meta[ $field_id ] ) ) {
			return $ctx->relation_field_meta[ $field_id ];
		}
		$target_collection_id = (int) get_post_meta( $field_id, 'related_collection_id', true );
		$entry                = array(
			'related_collection_id' => $target_collection_id,
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
	 * @param WP_REST_Request  $request  REST request used to prepare the post.
	 * @return WP_REST_Response
	 */
	public function filter_rest_prepare_row( $response, WP_Post $post, ?WP_REST_Request $request = null ): WP_REST_Response {
		if ( ! $response instanceof WP_REST_Response ) {
			return $response;
		}

		if ( Document::POST_TYPE !== $post->post_type ) {
			return $response;
		}

		$requested_fields    = $this->requested_rest_row_fields( $request );
		$include             = static fn( string $field ): bool => null === $requested_fields
			|| rest_is_field_included( $field, $requested_fields );
		$include_created_at  = $include( 'created_at' );
		$include_modified_at = $include( 'modified_at' );
		$include_created_by  = $include( 'created_by' );
		$include_modified_by = $include( 'modified_by' );
		$include_cover       = $include( 'cover' );
		$include_hydrated    = $include( 'cortext_hydrated_meta' );

		if ( ! $include_created_at && ! $include_modified_at && ! $include_created_by
			&& ! $include_modified_by && ! $include_cover && ! $include_hydrated ) {
			return $response;
		}

		$collection = $this->find_trait_for_document( $post->ID );
		if ( ! $collection instanceof WP_Post ) {
			return $response;
		}

		$data = $response->get_data();

		// Match `format_row` for system fields too. The normal WP response
		// exposes `author` / `date_gmt`, which the row field getters do not
		// read, so detail views would otherwise show "Empty".
		$created_by_id = (int) $post->post_author;
		if ( $include_created_at ) {
			$data['created_at'] = $this->format_gmt_date( $post->post_date_gmt );
		}
		if ( $include_modified_at ) {
			$data['modified_at'] = $this->format_gmt_date( $post->post_modified_gmt );
		}
		if ( $include_created_by ) {
			$data['created_by'] = $this->display_name_for( $created_by_id );
		}
		if ( $include_modified_by ) {
			$modified_by_id      = (int) get_post_meta( $post->ID, '_modified_by', true );
			$data['modified_by'] = $this->display_name_for(
				$modified_by_id > 0 ? $modified_by_id : $created_by_id
			);
		}
		if ( $include_cover ) {
			$data['cover'] = $this->cover_data_for_post( $post );
		}

		$field_ids = $include_hydrated ? Document::collection_field_ids( $collection->ID ) : array();
		if ( count( $field_ids ) > 0 ) {
			FormulaMaterializer::recompute_row( $collection->ID, $post->ID );

			// Keep hydrated values out of `meta`. Those keys are registered as
			// strings; if autosave sends hydrated objects back, REST rejects the
			// save with 400. `cortext_hydrated_meta` is read-only display data.
			$ctx             = $this->row_format_context_for_collection( $request, $collection->ID, $field_ids );
			$related_row_ids = $this->collect_related_row_ids( array( $post ), $field_ids, $ctx );
			if ( count( $related_row_ids ) > 0 ) {
				_prime_post_caches( $related_row_ids, false, true );
			}

			$hydrated        = array();
			$multi_field_ids = $this->multi_value_field_ids_from( $ctx->field_types );
			foreach ( $field_ids as $field_id ) {
				$field_type = $ctx->field_types[ $field_id ] ?? (string) get_post_meta( $field_id, 'type', true );
				$key        = "field-{$field_id}";

				if ( 'relation' === $field_type ) {
					$hydrated[ $key ] = $this->format_relation_value( $post->ID, $field_id, $ctx );
				} elseif ( 'rollup' === $field_type ) {
					$hydrated[ $key ] = $this->compute_rollup_value( $post->ID, $field_id, $ctx );
				} elseif ( 'formula' === $field_type ) {
					$hydrated[ $key ] = $this->format_typed_value(
						$post->ID,
						$field_id,
						$this->formula_result_type_for( $field_id ),
						false
					);
				} else {
					$hydrated[ $key ] = $this->format_typed_value(
						$post->ID,
						$field_id,
						$field_type,
						isset( $multi_field_ids[ $field_id ] )
					);
				}
			}

			$data['cortext_hydrated_meta'] = $hydrated;
		}

		$response->set_data( $data );
		return $response;
	}

	/**
	 * Reads the core REST field projection to decide which row fields to add.
	 *
	 * WordPress treats a missing or empty `_fields` value as a full response.
	 *
	 * @param WP_REST_Request|null $request REST request used to prepare the post.
	 * @return string[]|null Requested fields, or null for a full response.
	 */
	private function requested_rest_row_fields( ?WP_REST_Request $request ): ?array {
		if ( null === $request || ! isset( $request['_fields'] ) ) {
			return null;
		}

		$fields = array_map( 'trim', wp_parse_list( $request['_fields'] ) );
		return count( $fields ) > 0 ? $fields : null;
	}

	/**
	 * Resolves the trait (collection) that a document is a row of, by reading
	 * the document's `crtxt_trait` term and extracting the trait id
	 * from the deterministic mirror-term slug.
	 *
	 * @param int $document_id Document post id.
	 * @return WP_Post|null
	 */
	private function find_trait_for_document( int $document_id ): ?WP_Post {
		$terms = get_the_terms( $document_id, TraitTaxonomy::TAXONOMY );
		if ( ! is_array( $terms ) || count( $terms ) === 0 ) {
			return null;
		}
		$trait_id = TraitTaxonomy::trait_id_from_slug( (string) $terms[0]->slug );
		if ( $trait_id < 1 ) {
			return null;
		}
		$trait = get_post( $trait_id );
		return $trait instanceof WP_Post && Document::is_collection_post( $trait ) ? $trait : null;
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
			} elseif ( 'formula' === $field_type ) {
				$meta[ $key ] = $this->format_typed_value(
					$post->ID,
					$field_id,
					$this->formula_result_type_for( $field_id ),
					false
				);
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
		$cover_id       = (int) get_post_thumbnail_id( $post );

		return array(
			'id'             => $post->ID,
			'title'          => array(
				'raw'      => $post->post_title,
				'rendered' => $post->post_title,
			),
			'status'         => $post->post_status,
			'created_at'     => $this->format_gmt_date( $post->post_date_gmt ),
			'modified_at'    => $this->format_gmt_date( $post->post_modified_gmt ),
			'created_by'     => $this->display_name_for( $created_by_id ),
			'modified_by'    => $this->display_name_for( $modified_by_id > 0 ? $modified_by_id : $created_by_id ),
			'featured_media' => $cover_id,
			'cover'          => $this->cover_data_for_post( $post ),
			'meta'           => $meta,
		);
	}

	/**
	 * Returns the row cover payload used in row responses.
	 *
	 * @param WP_Post $post Row post object.
	 * @return array{id:int,url:string,alt:string}|null
	 */
	private function cover_data_for_post( WP_Post $post ): ?array {
		$cover_id = (int) get_post_thumbnail_id( $post );
		if ( $cover_id < 1 ) {
			return null;
		}

		$cover_src = wp_get_attachment_image_src( $cover_id, 'large' );
		if ( ! is_array( $cover_src ) ) {
			$cover_src = wp_get_attachment_image_src( $cover_id, 'full' );
		}
		if ( ! is_array( $cover_src ) || empty( $cover_src[0] ) ) {
			return null;
		}

		return array(
			'id'  => $cover_id,
			'url' => $cover_src[0],
			'alt' => (string) get_post_meta( $cover_id, '_wp_attachment_image_alt', true ),
		);
	}

	/**
	 * Returns the formatter context shared by rows in one core REST request.
	 *
	 * @param WP_REST_Request|null $request       REST request used to prepare the post.
	 * @param int                  $collection_id Collection post ID.
	 * @param int[]                $field_ids     Field IDs in the collection.
	 */
	private function row_format_context_for_collection(
		?WP_REST_Request $request,
		int $collection_id,
		array $field_ids
	): RowFormatContext {
		$contexts = null !== $request && isset( $this->rest_prepare_format_contexts[ $request ] )
			? $this->rest_prepare_format_contexts[ $request ]
			: array();
		$ctx      = $contexts[ $collection_id ] ?? new RowFormatContext();
		foreach ( $field_ids as $field_id ) {
			if ( ! isset( $ctx->field_types[ $field_id ] ) ) {
				$ctx->field_types[ $field_id ] = (string) get_post_meta( $field_id, 'type', true );
			}
		}

		if ( null !== $request ) {
			$contexts[ $collection_id ]                     = $ctx;
			$this->rest_prepare_format_contexts[ $request ] = $contexts;
		}

		return $ctx;
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

	private function formula_result_type_for( int $field_id ): string {
		$type = (string) get_post_meta( $field_id, 'formula_result_type', true );
		return in_array( $type, array( 'text', 'number', 'date', 'datetime', 'checkbox' ), true ) ? $type : 'text';
	}

	private function query_needs_volatile_formula_materialization( int $collection_id, WP_REST_Request $request ): bool {
		if ( ! FormulaMaterializer::collection_has_volatile_formula( $collection_id ) ) {
			return false;
		}

		$sort = $request->get_param( 'sort' );
		if ( is_array( $sort ) && $this->field_key_is_volatile_formula( (string) ( $sort['field'] ?? '' ) ) ) {
			return true;
		}

		return $this->filters_include_volatile_formula( $request->get_param( 'filters' ) );
	}

	private function filters_include_volatile_formula( mixed $filters ): bool {
		if ( ! is_array( $filters ) ) {
			return false;
		}

		if ( isset( $filters['field'] ) && $this->field_key_is_volatile_formula( (string) $filters['field'] ) ) {
			return true;
		}

		foreach ( $filters as $filter ) {
			if ( is_array( $filter ) && $this->filters_include_volatile_formula( $filter ) ) {
				return true;
			}
		}
		return false;
	}

	private function field_key_is_volatile_formula( string $field_key ): bool {
		if ( ! str_starts_with( $field_key, 'field-' ) ) {
			return false;
		}

		$field_id = $this->field_id_from_key( $field_key );
		return (
			$field_id > 0 &&
			'formula' === (string) get_post_meta( $field_id, 'type', true ) &&
			'1' === (string) get_post_meta( $field_id, 'formula_is_volatile', true )
		);
	}

	private function field_id_from_key( string $field_key ): int {
		if ( 1 !== preg_match( '/^field-(\d+)$/', $field_key, $matches ) ) {
			return 0;
		}
		return (int) $matches[1];
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
	 * @return array{id:int,title:array{raw:string,rendered:string},manual_order_seeded:bool}
	 */
	private function collection_definition( WP_Post $collection ): array {
		$manual_order = new RowsManualOrder();
		return array(
			'id'                  => $collection->ID,
			'title'               => array(
				'raw'      => $collection->post_title,
				'rendered' => $collection->post_title,
			),
			'manual_order_seeded' => $manual_order->is_seeded( $collection->ID ),
		);
	}

	/**
	 * Builds lightweight field definitions for the response.
	 *
	 * @param int[] $field_ids Field post IDs.
	 * @return array<int, array{id: int, label: string, type: string, description: string, options: string|null, formulaResultType: ?string}>
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
				'id'                => $field_id,
				'label'             => $field->post_title,
				'type'              => $type,
				'description'       => (string) get_post_meta( $field_id, 'description', true ),
				'options'           => empty( $options ) ? null : $options,
				'formulaResultType' => 'formula' === $type ? $this->formula_result_type_for( $field_id ) : null,
			);
		}
		return $definitions;
	}
}
