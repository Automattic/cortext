<?php
/**
 * Registers the `crtxt_collection` custom post type.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

use Cortext\Documents;
use WP_Error;
use WP_REST_Request;

final class Collection {

	public const POST_TYPE = 'crtxt_collection';

	public const MODE_META_KEY         = 'workspace_mode';
	public const INLINE_OWNER_META_KEY = '_cortext_inline_owner_page';

	public const MODE_INLINE    = 'inline';
	public const MODE_FULL_PAGE = 'full_page';

	private ?Documents $documents = null;

	public function register(): void {
		add_action( 'init', array( $this, 'register_post_type' ) );
		add_action( 'rest_api_init', array( $this, 'register_rest_filters' ) );
	}

	public function register_post_type(): void {
		// Collections use the shared document lifecycle: title, identity,
		// trash, restore, permanent delete, and command palette search.
		// DataView is their editing surface, so block-editor content support
		// stays off for now.
		DocumentTypeRegistrar::register(
			self::POST_TYPE,
			array(
				'labels'             => array(
					'name'          => __( 'Collections', 'cortext' ),
					'singular_name' => __( 'Collection', 'cortext' ),
					'menu_name'     => __( 'Collections', 'cortext' ),
					'add_new_item'  => __( 'Add New Collection', 'cortext' ),
					'edit_item'     => __( 'Edit Collection', 'cortext' ),
					'new_item'      => __( 'New Collection', 'cortext' ),
					'view_item'     => __( 'View Collection', 'cortext' ),
					'search_items'  => __( 'Search Collections', 'cortext' ),
					'all_items'     => __( 'All Collections', 'cortext' ),
				),
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
				'show_in_menu'       => false,
				'show_in_rest'       => true,
				'rest_base'          => 'crtxt_collections',
				'has_archive'        => false,
				// Expose `post_parent` in REST for full-page collections.
				// Inline collections keep `post_parent = 0`; their owner lives
				// in `_cortext_inline_owner_page`.
				'hierarchical'       => true,
				'supports'           => array( 'title', 'custom-fields', 'page-attributes' ),
				'capability_type'    => 'post',
				'map_meta_cap'       => true,
				'can_export'         => true,
				'delete_with_user'   => false,
			)
		);

		$this->register_meta();
	}

	/**
	 * Adds the REST filters for the generated `crtxt_collection` endpoint.
	 * They hide inline collections from default lists, block invalid parents,
	 * and let the sidebar filter by `workspace_mode`.
	 */
	public function register_rest_filters(): void {
		// Keep inline collections out of workspace lists unless a caller
		// explicitly asks for ?workspace_mode=inline.
		add_filter( 'rest_' . self::POST_TYPE . '_query', array( $this, 'filter_collection_query' ), 10, 2 );
		add_filter( 'rest_' . self::POST_TYPE . '_collection_params', array( $this, 'add_collection_params' ) );
		// Keep PATCH from moving inline collections or nesting collections
		// under invalid parents.
		add_filter( 'rest_pre_insert_' . self::POST_TYPE, array( $this, 'validate_pre_insert' ), 10, 2 );
	}

	/**
	 * Whether the collection is inline. Missing meta means `full_page`, so
	 * existing collections keep their sidebar behavior after the mode split.
	 *
	 * @param int $collection_id Collection post id.
	 */
	public static function is_inline( int $collection_id ): bool {
		$mode = get_post_meta( $collection_id, self::MODE_META_KEY, true );
		return self::MODE_INLINE === $mode;
	}

	/**
	 * Generates a unique slug for a collection. The slug is also the dynamic
	 * row CPT suffix, so cap it to WordPress's 20-character post type limit
	 * and add a numeric suffix when the preferred slug is taken.
	 *
	 * @param string $raw_slug Source title or slug.
	 */
	public static function unique_slug( string $raw_slug ): string {
		$max_length = CollectionEntries::MAX_CPT_LEN - strlen( CollectionEntries::CPT_PREFIX );
		$base       = sanitize_key( sanitize_title( $raw_slug ) );

		if ( '' === $base ) {
			$base = 'items';
		}

		$base = trim( substr( $base, 0, $max_length ), '-' );
		if ( '' === $base ) {
			$base = 'items';
		}

		$taken = self::existing_slugs();

		for ( $suffix = 0; $suffix < 1000; $suffix++ ) {
			$suffix_text = $suffix > 0 ? '-' . ( $suffix + 1 ) : '';
			$stem_length = $max_length - strlen( $suffix_text );
			$stem        = trim( substr( $base, 0, $stem_length ), '-' );
			if ( '' === $stem ) {
				$stem = 'items';
			}

			$candidate = $stem . $suffix_text;
			if ( ! self::slug_taken( $candidate, $taken ) ) {
				return $candidate;
			}
		}

		return substr( uniqid( 'c', false ), 0, $max_length );
	}

	/**
	 * Returns existing collection slugs.
	 *
	 * @return array<string, true> Set of slugs already in use, keyed by slug.
	 */
	public static function existing_slugs(): array {
		$collection_ids = get_posts(
			array(
				'post_type'   => self::POST_TYPE,
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

	/**
	 * Checks whether a candidate slug is already taken by a collection, the
	 * reserved-slug list, or a registered row CPT.
	 *
	 * @param string              $slug  Candidate slug.
	 * @param array<string, true> $taken Set of slugs from `existing_slugs()`.
	 */
	public static function slug_taken( string $slug, array $taken ): bool {
		if ( CollectionEntries::is_reserved_slug( $slug ) ) {
			return true;
		}

		if ( post_type_exists( CollectionEntries::CPT_PREFIX . $slug ) ) {
			return true;
		}

		return isset( $taken[ $slug ] );
	}

	/**
	 * Validates a candidate parent document for a collection. Collections sit
	 * under pages or rows, not under other collections. The current user must
	 * be able to edit the parent.
	 *
	 * @param int $parent_id Parent post id (already > 0 by the caller).
	 */
	public function validate_parent_document( int $parent_id ): ?WP_Error {
		if ( $parent_id < 1 ) {
			return null;
		}

		$parent = get_post( $parent_id );
		if ( ! $parent instanceof \WP_Post || 'trash' === $parent->post_status ) {
			return new WP_Error(
				'cortext_collection_parent_not_found',
				__( 'The parent document was not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		// Collections are documents now, so `kind_for_post_type` alone would
		// allow collection-under-collection nesting. Keep collections under
		// pages or rows instead.
		if (
			null === $this->documents()->kind_for_post_type( $parent->post_type ) ||
			self::POST_TYPE === $parent->post_type
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

	/**
	 * Adds `workspace_mode` to the generated collection list endpoint. The
	 * sidebar uses it to request full-page collections only.
	 *
	 * @param array<string, array<string, mixed>> $params Existing params.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public function add_collection_params( array $params ): array {
		$params['workspace_mode'] = array(
			'description' => __( 'Return collections in this workspace mode. Collections without mode meta count as full_page.', 'cortext' ),
			'type'        => 'string',
			'enum'        => array( self::MODE_INLINE, self::MODE_FULL_PAGE ),
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

		if ( self::MODE_FULL_PAGE === $requested ) {
			$meta_query[] = array(
				'relation' => 'OR',
				array(
					'key'     => self::MODE_META_KEY,
					'value'   => self::MODE_FULL_PAGE,
					'compare' => '=',
				),
				array(
					'key'     => self::MODE_META_KEY,
					'compare' => 'NOT EXISTS',
				),
			);
		} elseif ( self::MODE_INLINE === $requested ) {
			$meta_query[] = array(
				'key'     => self::MODE_META_KEY,
				'value'   => self::MODE_INLINE,
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
			? (string) get_post_meta( $existing_id, self::MODE_META_KEY, true )
			: (string) $request->get_param( 'workspace_mode' );

		if ( self::MODE_INLINE === $mode && $next_parent > 0 ) {
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

	private function documents(): Documents {
		if ( null === $this->documents ) {
			$this->documents = new Documents();
		}
		return $this->documents;
	}

	private function register_meta(): void {
		$meta = array(
			'slug'   => array(
				'type'   => 'string',
				'single' => true,
			),
			'fields' => array(
				'type'   => 'string',
				'single' => false,
			),
		);

		foreach ( $meta as $key => $args ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				array_merge(
					$args,
					array(
						'show_in_rest'      => true,
						'sanitize_callback' => 'sanitize_text_field',
					)
				)
			);
		}

		// Readable via REST, but write-locked. Mode is set on creation only;
		// changing it later is out of scope for this pass.
		register_post_meta(
			self::POST_TYPE,
			self::MODE_META_KEY,
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_text_field',
				'auth_callback'     => static function () {
					return false;
				},
			)
		);

		// Server-only. The editor does not need the owner id, and leaving it
		// writable would let an inline collection drift to the wrong page.
		register_post_meta(
			self::POST_TYPE,
			self::INLINE_OWNER_META_KEY,
			array(
				'type'              => 'integer',
				'single'            => true,
				'show_in_rest'      => false,
				'sanitize_callback' => 'absint',
				'auth_callback'     => static function () {
					return false;
				},
			)
		);
	}
}
