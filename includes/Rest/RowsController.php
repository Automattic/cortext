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
use WP_REST_Request;
use WP_REST_Response;

final class RowsController {

	private const NAMESPACE = 'cortext/v1';

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
						'trait'    => array(
							'type'     => 'integer',
							'required' => true,
						),
						'page'     => array(
							'type'    => 'integer',
							'default' => 1,
							'minimum' => 1,
						),
						'per_page' => array(
							'type'              => 'integer',
							'default'           => 25,
							'validate_callback' => static fn( $value ) => (int) $value >= 1 && (int) $value <= 100,
						),
						'search'   => array(
							'type'    => 'string',
							'default' => '',
						),
						'sort'     => array(
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
						'filters'  => array(
							'type'    => 'array',
							'default' => array(),
						),
						'include'  => array(
							'type'              => 'array',
							'default'           => array(),
							'items'             => array( 'type' => 'integer' ),
							'sanitize_callback' => array( $this, 'sanitize_include_param' ),
							'validate_callback' => array( $this, 'validate_include_param' ),
						),
						'fields'   => array(
							'type'    => 'array',
							'default' => null,
							'items'   => array( 'type' => 'string' ),
						),
						'context'  => array(
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

		$field_ids           = Document::collection_field_ids( $collection->ID );
		$requested_fields    = $request->get_param( 'fields' );
		$formatted_field_ids = is_array( $requested_fields )
			? $this->filter_requested_field_ids( $requested_fields, $field_ids )
			: $field_ids;

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
					'collection' => $this->collection_definition( $collection ),
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

		$search       = (string) $request->get_param( 'search' );
		$search_where = $row_query->compile_search( $search, $field_schema );
		$where_parts  = array_values( array_filter( array( $filter_sql['where'], $search_where ) ) );
		$where_sql    = count( $where_parts ) > 0 ? '( ' . implode( ' AND ', $where_parts ) . ' )' : '';

		// tech-debt.md#td-formula-materialized-values: volatile formula sort/filter reads materialized meta.
		if ( $this->query_needs_volatile_formula_materialization( $collection_id, $request ) ) {
			FormulaMaterializer::recompute_collection( $collection_id );
		}

		// Keep row-formatting metadata local to this rows response. Passing the
		// context through the helpers avoids stale state in CLI and test runs.
		$ctx              = new RowFormatContext();
		$ctx->field_types = $this->field_types_map( $formatted_field_ids );
		$multi_field_ids  = $this->multi_value_field_ids_from( $ctx->field_types );
		$row_statuses     = $this->row_statuses_for_request();

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
			$query_args = $this->build_query_args( $request, $collection_id, $row_statuses );
			$scope      = new RowsQueryScope(
				$row_query,
				$field_schema,
				$where_sql,
				$filter_sql['join'],
				$request->get_param( 'sort' ),
				$search,
				TraitTaxonomy::term_taxonomy_id_for_trait( $collection_id )
			);
			$query      = $scope->run( $query_args );

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

		$fields = $this->field_definitions( $field_ids );

		return new WP_REST_Response(
			array(
				'rows'       => $rows,
				'total'      => $total,
				'totalPages' => $total_pages,
				'collection' => $this->collection_definition( $collection ),
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
	 * @return WP_REST_Response
	 */
	public function filter_rest_prepare_row( $response, WP_Post $post ): WP_REST_Response {
		if ( ! $response instanceof WP_REST_Response ) {
			return $response;
		}

		if ( Document::POST_TYPE !== $post->post_type ) {
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
		$created_by_id       = (int) $post->post_author;
		$modified_by_id      = (int) get_post_meta( $post->ID, '_modified_by', true );
		$data['created_at']  = $this->format_gmt_date( $post->post_date_gmt );
		$data['modified_at'] = $this->format_gmt_date( $post->post_modified_gmt );
		$data['created_by']  = $this->display_name_for( $created_by_id );
		$data['modified_by'] = $this->display_name_for(
			$modified_by_id > 0 ? $modified_by_id : $created_by_id
		);

		$field_ids = Document::collection_field_ids( $collection->ID );
		if ( count( $field_ids ) > 0 ) {
			FormulaMaterializer::recompute_row( $collection->ID, $post->ID );

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
				} elseif ( 'formula' === $field_type ) {
					$hydrated[ $key ] = $this->format_typed_value(
						$post->ID,
						$field_id,
						$this->formula_result_type_for( $field_id ),
						false
					);
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
	 * Resolves the trait (collection) that a document is a row of, by reading
	 * the document's `crtxt_trait` term and extracting the trait id
	 * from the deterministic mirror-term slug.
	 *
	 * @param int $document_id Document post id.
	 * @return WP_Post|null
	 */
	private function find_trait_for_document( int $document_id ): ?WP_Post {
		$terms = wp_get_object_terms(
			$document_id,
			TraitTaxonomy::TAXONOMY,
			array( 'fields' => 'all' )
		);
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
		$cover          = null;
		if ( $cover_id > 0 ) {
			$cover_src = wp_get_attachment_image_src( $cover_id, 'large' );
			if ( ! is_array( $cover_src ) ) {
				$cover_src = wp_get_attachment_image_src( $cover_id, 'full' );
			}
			if ( is_array( $cover_src ) && ! empty( $cover_src[0] ) ) {
				$cover = array(
					'id'  => $cover_id,
					'url' => $cover_src[0],
					'alt' => (string) get_post_meta( $cover_id, '_wp_attachment_image_alt', true ),
				);
			}
		}

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
			'cover'          => $cover,
			'meta'           => $meta,
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
