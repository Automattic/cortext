<?php
/**
 * Registers what Cortext can do with the WordPress Abilities API.
 *
 * Each ability runs the same code as the REST endpoint behind it, so the
 * command palette, AI tools and the API get the same results and the same
 * permission checks.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Abilities;

use Cortext\Documents;
use Cortext\PostType\Document;
use Cortext\Rest\RowsFilterQuery;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;
use WP_REST_Request;

defined( 'ABSPATH' ) || exit;

final class Abilities {

	public const CATEGORY = 'cortext';

	private const READ_ONLY = array(
		'annotations'  => array(
			'readonly'    => true,
			'destructive' => false,
			'idempotent'  => true,
		),
		'show_in_rest' => true,
	);

	public function register(): void {
		add_action( 'wp_abilities_api_categories_init', array( $this, 'register_category' ) );
		add_action( 'wp_abilities_api_init', array( $this, 'register_abilities' ) );
	}

	public function register_category(): void {
		wp_register_ability_category(
			self::CATEGORY,
			array(
				'label'       => __( 'Cortext', 'cortext' ),
				'description' => __( 'Find, read and change documents and collections in Cortext.', 'cortext' ),
			)
		);
	}

	public function register_abilities(): void {
		wp_register_ability(
			'cortext/search-documents',
			array(
				'label'               => __( 'Search documents', 'cortext' ),
				'description'         => __( 'Finds documents, collections included, by title or content. Without a search term, returns the most recently changed documents first.', 'cortext' ),
				'category'            => self::CATEGORY,
				'input_schema'        => array(
					'type'                 => 'object',
					'properties'           => array(
						'search'   => array(
							'type'        => 'string',
							'description' => __( 'Words to look for in titles and content.', 'cortext' ),
						),
						'page'     => array(
							'type'    => 'integer',
							'minimum' => 1,
						),
						'per_page' => array(
							'type'    => 'integer',
							'minimum' => 1,
							'maximum' => 100,
						),
					),
					'additionalProperties' => false,
					'default'              => array(),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'documents' => array(
							'type'  => 'array',
							'items' => array( 'type' => 'object' ),
						),
						'total'     => array( 'type' => 'integer' ),
					),
				),
				'execute_callback'    => array( $this, 'search_documents' ),
				'permission_callback' => array( $this, 'can_read' ),
				'meta'                => self::READ_ONLY,
			)
		);

		wp_register_ability(
			'cortext/list-collections',
			array(
				'label'               => __( 'List collections', 'cortext' ),
				'description'         => __( 'Lists every collection with its properties. Each property says how it can be sorted and which filter operators it takes, so you can query the documents in it.', 'cortext' ),
				'category'            => self::CATEGORY,
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'collections' => array(
							'type'  => 'array',
							'items' => array(
								'type'       => 'object',
								'properties' => array(
									'id'         => array( 'type' => 'integer' ),
									'title'      => array( 'type' => 'string' ),
									'properties' => array(
										'type'  => 'array',
										'items' => array( 'type' => 'object' ),
									),
								),
							),
						),
					),
				),
				'execute_callback'    => array( $this, 'list_collections' ),
				'permission_callback' => array( $this, 'can_read' ),
				'meta'                => self::READ_ONLY,
			)
		);

		wp_register_ability(
			'cortext/query-rows',
			array(
				'label'               => __( 'Query a collection\'s documents', 'cortext' ),
				'description'         => __( 'Returns the documents in a collection with their property values. They can be searched, filtered and sorted by the properties listed for that collection.', 'cortext' ),
				'category'            => self::CATEGORY,
				'input_schema'        => array(
					'type'                 => 'object',
					'properties'           => array(
						'collection' => array(
							'type'        => 'integer',
							'description' => __( 'ID of the collection.', 'cortext' ),
						),
						'search'     => array(
							'type'        => 'string',
							'description' => __( 'Words to look for in the title and text properties.', 'cortext' ),
						),
						'filters'    => array(
							'type'        => 'array',
							'description' => __( 'Filters that all have to match. A filter is { field, operator, value }, where field is a property key and operator is one the property takes. Use { relation: "AND" | "OR", filters: [...] } to group them.', 'cortext' ),
							'items'       => array( 'type' => 'object' ),
						),
						'sort'       => array(
							'type'       => 'object',
							'properties' => array(
								'field'     => array( 'type' => 'string' ),
								'direction' => array(
									'type' => 'string',
									'enum' => array( 'asc', 'desc' ),
								),
							),
						),
						'page'       => array(
							'type'    => 'integer',
							'minimum' => 1,
						),
						'per_page'   => array(
							'type'    => 'integer',
							'minimum' => 1,
							'maximum' => 100,
						),
					),
					'required'             => array( 'collection' ),
					'additionalProperties' => false,
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'rows'       => array(
							'type'  => 'array',
							'items' => array( 'type' => 'object' ),
						),
						'total'      => array( 'type' => 'integer' ),
						'totalPages' => array( 'type' => 'integer' ),
						'collection' => array( 'type' => 'object' ),
						'fields'     => array( 'type' => 'array' ),
					),
				),
				'execute_callback'    => array( $this, 'query_rows' ),
				'permission_callback' => array( $this, 'can_read' ),
				'meta'                => self::READ_ONLY,
			)
		);
	}

	/**
	 * Same gate as the `/cortext/v1/documents` and `/cortext/v1/rows` editor
	 * reads. Each document is still checked on its own when listed.
	 */
	public function can_read(): bool {
		return current_user_can( Document::CAPABILITY );
	}

	/**
	 * Lists documents through the same query as `/cortext/v1/documents`.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array{documents: array<int,array<string,mixed>>, total: int}
	 */
	public function search_documents( array $input ): array {
		return ( new Documents() )->list( array( 'include_excerpt' => true ) + $input );
	}

	/**
	 * Lists the collections the user can edit, with their properties. Archived
	 * and trashed collections are left out, as in search.
	 *
	 * @return array{collections: array<int,array<string,mixed>>}
	 */
	public function list_collections(): array {
		$collection_ids = TraitTaxonomy::all_trait_ids();
		_prime_post_caches( $collection_ids, false, true );

		$posts = array();
		foreach ( $collection_ids as $collection_id ) {
			$post = get_post( $collection_id );
			if (
				$post instanceof WP_Post
				&& in_array( $post->post_status, Documents::DEFAULT_STATUSES, true )
				&& current_user_can( 'edit_post', $collection_id )
			) {
				$posts[] = $post;
			}
		}

		$field_ids = array();
		foreach ( $posts as $post ) {
			$field_ids = array_merge( $field_ids, Document::collection_field_ids( $post->ID ) );
		}
		_prime_post_caches( $field_ids, false, true );

		$documents   = new Documents();
		$rows_query  = new RowsFilterQuery();
		$collections = array();

		foreach ( $posts as $post ) {
			$collection_id = $post->ID;
			$collection    = $documents->format_document( $post );
			if ( null === $collection ) {
				continue;
			}

			$collection['properties'] = $this->properties_for( $rows_query, $collection_id );
			$collections[]            = $collection;
		}

		return array( 'collections' => $collections );
	}

	/**
	 * Runs the `/cortext/v1/rows` route, so its validation, filters and
	 * permission gate stay the only ones.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array<string,mixed>|WP_Error
	 */
	public function query_rows( array $input ) {
		$params = array(
			'trait'   => (int) $input['collection'],
			'context' => 'edit',
		) + array_diff_key( $input, array( 'collection' => true ) );

		return self::dispatch( 'GET', '/cortext/v1/rows', $params );
	}

	/**
	 * Runs a REST route in the current request, so its permission checks,
	 * validation and hooks apply as they do for the app.
	 *
	 * @param string              $method HTTP method.
	 * @param string              $route  Route path.
	 * @param array<string,mixed> $params Query params for GET, body params otherwise.
	 * @return mixed|WP_Error Response data, or the route's error.
	 */
	public static function dispatch( string $method, string $route, array $params = array() ) {
		$request = new WP_REST_Request( $method, $route );
		if ( 'GET' === $method ) {
			$request->set_query_params( $params );
		} else {
			$request->set_body_params( $params );
		}

		$response = rest_do_request( $request );
		if ( $response->is_error() ) {
			return $response->as_error();
		}

		return $response->get_data();
	}

	/**
	 * The keys `query-rows` takes in `filters` and `sort`, with the operators
	 * each one accepts. Manual order is left out: it only means something in
	 * the table.
	 *
	 * @param RowsFilterQuery $rows_query    Shared query, so field schemas are read once.
	 * @param int             $collection_id Collection post ID.
	 * @return array<int,array<string,mixed>>
	 */
	private function properties_for( RowsFilterQuery $rows_query, int $collection_id ): array {
		$system_labels = array(
			'title'       => __( 'Title', 'cortext' ),
			'created_at'  => __( 'Created', 'cortext' ),
			'modified_at' => __( 'Last edited', 'cortext' ),
		);
		$properties    = array();

		foreach ( $rows_query->field_schema_for( $collection_id ) as $key => $field ) {
			if ( 'manual' === $key ) {
				continue;
			}

			$properties[] = array(
				'key'        => $key,
				'label'      => $system_labels[ $key ] ?? get_post_field( 'post_title', $field['id'] ),
				'type'       => $field['type'],
				'sortable'   => $field['sortable'],
				'filterable' => $field['filterable'],
				'operators'  => $field['operators'],
			);
		}

		return $properties;
	}
}
