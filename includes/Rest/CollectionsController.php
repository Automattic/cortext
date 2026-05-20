<?php
/**
 * REST endpoint for creating Cortext collections.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Documents;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class CollectionsController {

	private const NAMESPACE = 'cortext/v1';

	private Documents $documents;

	public function __construct( ?Documents $documents = null ) {
		$this->documents = $documents ?? new Documents();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		// Keep inline collections out of workspace lists unless a caller
		// explicitly asks for ?workspace_mode=inline.
		add_filter( 'rest_' . Collection::POST_TYPE . '_query', array( $this, 'filter_collection_query' ), 10, 2 );
		add_filter( 'rest_' . Collection::POST_TYPE . '_collection_params', array( $this, 'add_collection_params' ) );
		// Keep PATCH from moving inline collections or nesting collections
		// under non-document posts.
		add_filter( 'rest_pre_insert_' . Collection::POST_TYPE, array( $this, 'validate_pre_insert' ), 10, 2 );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/collections',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'create' ),
					'permission_callback' => array( $this, 'can_create' ),
					'args'                => array(
						'title'  => array(
							'type'     => 'string',
							'required' => true,
						),
						'mode'   => array(
							'type'    => 'string',
							'enum'    => array( Collection::MODE_INLINE, Collection::MODE_FULL_PAGE ),
							'default' => Collection::MODE_FULL_PAGE,
						),
						'parent' => array(
							'type'    => 'integer',
							'minimum' => 0,
							'default' => 0,
						),
					),
				),
			)
		);
	}

	public function can_create(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function create( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$title = trim( sanitize_text_field( (string) $request->get_param( 'title' ) ) );

		if ( '' === $title ) {
			return new WP_Error(
				'cortext_collection_title_required',
				__( 'Collection name is required.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$mode   = (string) $request->get_param( 'mode' );
		$parent = (int) $request->get_param( 'parent' );

		if ( Collection::MODE_INLINE === $mode ) {
			if ( $parent < 1 ) {
				return new WP_Error(
					'cortext_collection_parent_required',
					__( 'Inline collections need an owner document.', 'cortext' ),
					array( 'status' => 400 )
				);
			}
			$parent_error = $this->validate_parent_document( $parent );
			if ( $parent_error instanceof WP_Error ) {
				return $parent_error;
			}
		} elseif ( $parent > 0 ) {
			// Full-page collections can sit under any Cortext document.
			$parent_error = $this->validate_parent_document( $parent );
			if ( $parent_error instanceof WP_Error ) {
				return $parent_error;
			}
		}

		$slug = $this->unique_slug( $title );

		$meta_input = array(
			'slug'                    => $slug,
			Collection::MODE_META_KEY => $mode,
		);

		// Inline collections store their owner in meta. Full-page collections
		// use post_parent so the sidebar can place them in the tree.
		$post_parent = 0;
		if ( Collection::MODE_INLINE === $mode ) {
			$meta_input[ Collection::INLINE_OWNER_META_KEY ] = $parent;
		} elseif ( $parent > 0 ) {
			$post_parent = $parent;
		}

		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'post_parent' => $post_parent,
				'meta_input'  => $meta_input,
			),
			true
		);

		if ( is_wp_error( $collection_id ) ) {
			return $collection_id;
		}

		$collection = get_post( (int) $collection_id );
		if ( ! $collection ) {
			wp_delete_post( (int) $collection_id, true );
			return new WP_Error(
				'cortext_collection_create_failed',
				__( 'Collection could not be created.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		( new CollectionEntries() )->register_for_collection( $collection );

		$rest_base = CollectionEntries::CPT_PREFIX . $slug;
		if ( ! post_type_exists( $rest_base ) ) {
			wp_delete_post( (int) $collection_id, true );
			return new WP_Error(
				'cortext_collection_cpt_failed',
				__( 'Collection rows could not be registered.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'id'       => (int) $collection_id,
				'title'    => $title,
				'slug'     => $slug,
				'restBase' => $rest_base,
				'mode'     => $mode,
				'parent'   => Collection::MODE_INLINE === $mode ? 0 : $post_parent,
			),
			201
		);
	}

	/**
	 * Adds `workspace_mode` to the generated collection list endpoint. The
	 * sidebar uses it to ask for full-page collections only.
	 *
	 * @param array<string, array<string, mixed>> $params Existing params.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public function add_collection_params( array $params ): array {
		$params['workspace_mode'] = array(
			'description' => __( 'Return only collections in this workspace mode. Collections without mode meta count as full_page.', 'cortext' ),
			'type'        => 'string',
			'enum'        => array( Collection::MODE_INLINE, Collection::MODE_FULL_PAGE ),
		);
		return $params;
	}

	/**
	 * Translates `workspace_mode` into a meta_query. Collections created
	 * before this field existed count as full_page.
	 *
	 * @param array<string, mixed> $args    Query args.
	 * @param WP_REST_Request      $request Inbound request.
	 *
	 * @return array<string, mixed>
	 */
	public function filter_collection_query( array $args, WP_REST_Request $request ): array {
		$requested = $request->get_param( 'workspace_mode' );
		if ( ! is_string( $requested ) || '' === $requested ) {
			return $args;
		}

		$meta_query = isset( $args['meta_query'] ) && is_array( $args['meta_query'] ) ? $args['meta_query'] : array();

		if ( Collection::MODE_FULL_PAGE === $requested ) {
			$meta_query[] = array(
				'relation' => 'OR',
				array(
					'key'     => Collection::MODE_META_KEY,
					'value'   => Collection::MODE_FULL_PAGE,
					'compare' => '=',
				),
				array(
					'key'     => Collection::MODE_META_KEY,
					'compare' => 'NOT EXISTS',
				),
			);
		} elseif ( Collection::MODE_INLINE === $requested ) {
			$meta_query[] = array(
				'key'     => Collection::MODE_META_KEY,
				'value'   => Collection::MODE_INLINE,
				'compare' => '=',
			);
		}

		$args['meta_query'] = $meta_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
		return $args;
	}

	/**
	 * Guards writes through the generated `crtxt_collection` REST endpoint.
	 *
	 * Inline collections must keep `post_parent = 0`; their owner lives in
	 * `_cortext_inline_owner_page`. Full-page collections may set a parent,
	 * but only to a Cortext document the user can edit.
	 *
	 * @param \stdClass       $prepared Sanitized post object about to be
	 *                                  inserted or updated.
	 * @param WP_REST_Request $request  The inbound REST request.
	 */
	public function validate_pre_insert( $prepared, WP_REST_Request $request ) {
		if ( ! isset( $prepared->post_parent ) ) {
			return $prepared;
		}

		$next_parent = (int) $prepared->post_parent;

		$existing_id = isset( $prepared->ID ) ? (int) $prepared->ID : 0;
		$mode        = $existing_id > 0
			? (string) get_post_meta( $existing_id, Collection::MODE_META_KEY, true )
			: (string) $request->get_param( 'workspace_mode' );

		if ( Collection::MODE_INLINE === $mode && $next_parent > 0 ) {
			return new WP_Error(
				'cortext_collection_inline_parent_locked',
				__( 'Inline collections cannot be reparented. Their owner is set when they are created.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( $next_parent > 0 ) {
			$parent_error = $this->validate_parent_document( $next_parent );
			if ( $parent_error instanceof WP_Error ) {
				return $parent_error;
			}
		}

		return $prepared;
	}

	private function validate_parent_document( int $parent_id ): ?WP_Error {
		if ( $parent_id < 1 ) {
			return null;
		}

		$parent = get_post( $parent_id );
		if ( ! $parent instanceof WP_Post || 'trash' === $parent->post_status ) {
			return new WP_Error(
				'cortext_collection_parent_not_found',
				__( 'The parent document was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		// Collections are documents now, so `kind_for_post_type` alone would
		// let a request nest a collection under another collection. Reject
		// that explicitly: collections live under pages or rows, not under
		// other collections.
		if (
			null === $this->documents->kind_for_post_type( $parent->post_type ) ||
			Collection::POST_TYPE === $parent->post_type
		) {
			return new WP_Error(
				'cortext_collection_parent_invalid_type',
				__( 'Collections can only be placed under pages or rows.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( ! current_user_can( 'edit_post', $parent_id ) ) {
			return new WP_Error(
				'cortext_collection_parent_forbidden',
				__( 'You cannot add a collection to that document.', 'cortext' ),
				array( 'status' => 403 )
			);
		}

		return null;
	}

	private function unique_slug( string $raw_slug ): string {
		$max_length = CollectionEntries::MAX_CPT_LEN - strlen( CollectionEntries::CPT_PREFIX );
		$base       = sanitize_key( sanitize_title( $raw_slug ) );

		if ( '' === $base ) {
			$base = 'items';
		}

		$base = trim( substr( $base, 0, $max_length ), '-' );
		if ( '' === $base ) {
			$base = 'items';
		}

		$taken = $this->existing_slugs();

		for ( $suffix = 0; $suffix < 1000; $suffix++ ) {
			$suffix_text = $suffix > 0 ? '-' . ( $suffix + 1 ) : '';
			$stem_length = $max_length - strlen( $suffix_text );
			$stem        = trim( substr( $base, 0, $stem_length ), '-' );
			if ( '' === $stem ) {
				$stem = 'items';
			}

			$candidate = $stem . $suffix_text;
			if ( ! $this->slug_taken( $candidate, $taken ) ) {
				return $candidate;
			}
		}

		return substr( uniqid( 'c', false ), 0, $max_length );
	}

	private function slug_taken( string $slug, array $taken ): bool {
		if ( CollectionEntries::is_reserved_slug( $slug ) ) {
			return true;
		}

		if ( post_type_exists( CollectionEntries::CPT_PREFIX . $slug ) ) {
			return true;
		}

		return isset( $taken[ $slug ] );
	}

	/**
	 * Gets existing collection slugs.
	 *
	 * @return array<string, true> Set of slugs already in use, keyed by slug.
	 */
	private function existing_slugs(): array {
		$collection_ids = get_posts(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'any',
				'numberposts' => -1,
				'fields'      => 'ids',
			)
		);

		$slugs = array();
		foreach ( $collection_ids as $collection_id ) {
			$slug = get_post_meta( (int) $collection_id, 'slug', true );
			if ( is_string( $slug ) && '' !== $slug ) {
				$slugs[ $slug ] = true;
			}
		}

		return $slugs;
	}
}
