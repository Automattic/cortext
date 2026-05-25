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

	public const MODE_META_KEY          = 'workspace_mode';
	public const INLINE_OWNER_META_KEY  = '_cortext_inline_owner_page';
	public const DETAIL_LAYOUT_META_KEY = 'detail_layout';

	public const MODE_INLINE    = 'inline';
	public const MODE_FULL_PAGE = 'full_page';

	private ?Documents $documents = null;

	public function register(): void {
		add_action( 'init', array( $this, 'register_post_type' ) );
		add_action( 'rest_api_init', array( $this, 'register_rest_filters' ) );
		// The owner data-view needs the new post ID, so seed it after insert.
		// EditorBody still repairs old or empty content. See tech-debt.md#59.
		add_action( 'wp_after_insert_post', array( $this, 'maybe_seed_data_view_block' ), 10, 3 );
	}

	public function register_post_type(): void {
		// Collections use the document lifecycle. Full-page collections also
		// open in Canvas, with cover/icon controls and a data-view body.
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
				// Published collections can render on the front end; editing
				// still happens in the Cortext shell.
				'publicly_queryable' => true,
				'show_ui'            => true,
				'show_in_menu'       => false,
				'show_in_rest'       => true,
				'rest_base'          => 'crtxt_collections',
				'has_archive'        => false,
				'rewrite'            => array( 'slug' => 'cortext-collection' ),
				// Expose `post_parent` in REST for full-page collections.
				// Inline collections keep `post_parent = 0`; their owner lives
				// in `_cortext_inline_owner_page`.
				'hierarchical'       => true,
				'supports'           => array(
					'title',
					'editor',
					'thumbnail',
					'revisions',
					'custom-fields',
					'page-attributes',
				),
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
	 * Whether `$post_content` already carries a `cortext/data-view` block
	 * pointing at `$collection_id`. A foreign data-view (one that targets a
	 * different collection) does not count, so creation and backfill still
	 * seed the self-referencing owner block.
	 *
	 * @param string $post_content  Stored post content.
	 * @param int    $collection_id Collection post id to match against.
	 */
	public static function has_owner_data_view_block( string $post_content, int $collection_id ): bool {
		if ( '' === $post_content || ! str_contains( $post_content, '<!-- wp:cortext/data-view' ) ) {
			return false;
		}

		foreach ( parse_blocks( $post_content ) as $block ) {
			if ( 'cortext/data-view' !== ( $block['blockName'] ?? '' ) ) {
				continue;
			}
			$attr_id = isset( $block['attrs']['collectionId'] )
				? (int) $block['attrs']['collectionId']
				: 0;
			if ( $attr_id === $collection_id ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Serialized markup for the locked data-view block used as a full-page
	 * collection's body. Creation and backfill share this builder.
	 *
	 * @param int $collection_id Collection post id the block points at.
	 */
	public static function build_data_view_block_markup( int $collection_id ): string {
		return serialize_blocks(
			array(
				array(
					'blockName'    => 'cortext/data-view',
					'attrs'        => array(
						'collectionId' => $collection_id,
						'align'        => 'full',
						'lock'         => array(
							'move'   => true,
							'remove' => true,
						),
					),
					'innerBlocks'  => array(),
					'innerHTML'    => '',
					'innerContent' => array(),
				),
			)
		);
	}

	/**
	 * Adds the locked data-view block to a new full-page collection. Updates,
	 * inline collections, and content that already has the block are left alone.
	 *
	 * @param int      $post_id Post id.
	 * @param \WP_Post $post    Post object.
	 * @param bool     $update  True on subsequent saves.
	 */
	public function maybe_seed_data_view_block( int $post_id, \WP_Post $post, bool $update ): void {
		if ( $update ) {
			return;
		}
		if ( self::POST_TYPE !== $post->post_type ) {
			return;
		}
		if ( self::is_inline( $post_id ) ) {
			return;
		}
		if ( self::has_owner_data_view_block( (string) $post->post_content, $post_id ) ) {
			return;
		}

		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => $post->post_content . self::build_data_view_block_markup( $post_id ),
			)
		);
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

		// Collections are documents now, so `kind_for_post_type` would also
		// allow collection-under-collection nesting. Keep them under pages or
		// rows instead.
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
		$existing_id = isset( $prepared->ID ) ? (int) $prepared->ID : 0;
		$is_create   = 0 === $existing_id;
		$mode        = $is_create
			? self::normalize_mode( (string) $request->get_param( 'mode' ) )
			: (string) get_post_meta( $existing_id, self::MODE_META_KEY, true );

		// Read a client-supplied slug from the request before WP REST applies
		// the rest of `meta`. On create we stamp it through meta_input so the
		// row CPT registers against the same value the meta field stores.
		// After that, slug is locked: WP REST's meta path is gated by the
		// meta's `auth_callback`, and removing `meta.slug` from the request
		// keeps it from being applied via the meta API regardless.
		//
		// core-data posts the whole meta object when saving unrelated fields.
		// Strip write-locked keys so an icon-only save does not trip over an
		// unchanged `workspace_mode` or inline-owner value.
		$request_meta   = $request->get_param( 'meta' );
		$requested_slug = '';
		if ( is_array( $request_meta ) ) {
			if ( isset( $request_meta['slug'] ) ) {
				$requested_slug = (string) $request_meta['slug'];
				unset( $request_meta['slug'] );
			}
			unset(
				$request_meta[ self::MODE_META_KEY ],
				$request_meta[ self::INLINE_OWNER_META_KEY ]
			);
			$request->set_param( 'meta', $request_meta );
		}

		$next_parent = isset( $prepared->post_parent ) ? (int) $prepared->post_parent : 0;

		if ( $next_parent > 0 ) {
			$parent_error = $this->validate_parent_document( $next_parent );
			if ( $parent_error instanceof WP_Error ) {
				return $parent_error;
			}
		}

		if ( self::MODE_INLINE === $mode ) {
			if ( $is_create ) {
				if ( $next_parent < 1 ) {
					return new WP_Error(
						'cortext_collection_inline_parent_required',
						__( 'Inline collections need an owner document.', 'cortext' ),
						array( 'status' => 400 )
					);
				}
				// Inline collections keep their owner in meta. Leave post_parent
				// at 0 so they stay out of the workspace tree.
				$prepared->post_parent                     = 0;
				$meta_input                                = isset( $prepared->meta_input ) && is_array( $prepared->meta_input )
					? $prepared->meta_input
					: array();
				$meta_input[ self::INLINE_OWNER_META_KEY ] = $next_parent;
				$prepared->meta_input                      = $meta_input;
			} elseif ( $next_parent > 0 ) {
				return new WP_Error(
					'cortext_collection_inline_parent_locked',
					__( 'Inline collections cannot be reparented. Their owner is set when they are created.', 'cortext' ),
					array( 'status' => 400 )
				);
			}
		}

		if ( $is_create ) {
			$title = isset( $prepared->post_title ) ? trim( (string) $prepared->post_title ) : '';
			if ( '' === $title ) {
				return new WP_Error(
					'cortext_collection_title_required',
					__( 'Collection name is required.', 'cortext' ),
					array( 'status' => 400 )
				);
			}

			// Mode and slug are read-only through the REST meta fields. Set them
			// through meta_input on create; wp_insert_post can write them there,
			// and the new collection needs both before its row CPT can exist.
			$meta_input = isset( $prepared->meta_input ) && is_array( $prepared->meta_input )
				? $prepared->meta_input
				: array();

			$meta_input[ self::MODE_META_KEY ] = $mode;

			if ( empty( $meta_input['slug'] ) ) {
				$slug_candidate = '' !== trim( $requested_slug )
					? sanitize_key( $requested_slug )
					: '';
				if ( '' !== $slug_candidate ) {
					if ( self::slug_taken( $slug_candidate, self::existing_slugs() ) ) {
						return new WP_Error(
							'cortext_collection_slug_taken',
							__( 'Collection slug is already in use.', 'cortext' ),
							array( 'status' => 400 )
						);
					}
					$meta_input['slug'] = $slug_candidate;
				} else {
					$meta_input['slug'] = self::unique_slug( $title );
				}
			}

			$prepared->meta_input = $meta_input;
		}

		return $prepared;
	}

	/**
	 * Accepts the mode from a create request. Empty or unknown values fall back
	 * to full-page, matching the old collection create route.
	 *
	 * @param string $mode Raw mode value from the request body.
	 */
	private static function normalize_mode( string $mode ): string {
		$mode = trim( $mode );
		if ( self::MODE_INLINE === $mode || self::MODE_FULL_PAGE === $mode ) {
			return $mode;
		}
		return self::MODE_FULL_PAGE;
	}

	private function documents(): Documents {
		if ( null === $this->documents ) {
			$this->documents = new Documents();
		}
		return $this->documents;
	}

	private function register_meta(): void {
		// Slug is read-only through the REST meta API. `validate_pre_insert`
		// reads a desired slug from the request body on create, validates it,
		// and stamps the meta through meta_input before the row CPT
		// registers. After that, the slug can't change without orphaning the
		// CPT, so the REST meta path stays locked for updates.
		register_post_meta(
			self::POST_TYPE,
			'slug',
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

		// Field membership is a flat list of field post ids. FieldsController
		// owns the create/duplicate/delete paths, but the meta itself is the
		// canonical attachment list and stays writable through REST for
		// callers that manage attachment directly.
		register_post_meta(
			self::POST_TYPE,
			'fields',
			array(
				'type'              => 'string',
				'single'            => false,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_text_field',
			)
		);

		register_post_meta(
			self::POST_TYPE,
			self::DETAIL_LAYOUT_META_KEY,
			array(
				'type'              => 'object',
				'single'            => true,
				'show_in_rest'      => array(
					'schema' => array(
						'type'                 => 'object',
						'properties'           => array(
							'fields' => array(
								'type'    => 'array',
								'items'   => array(
									'type'                 => 'object',
									'properties'           => array(
										'field'   => array(
											'type' => 'string',
										),
										'visible' => array(
											'type' => 'boolean',
										),
									),
									'required'             => array( 'field', 'visible' ),
									'additionalProperties' => false,
								),
								'default' => array(),
							),
						),
						'additionalProperties' => false,
					),
				),
				'sanitize_callback' => array( self::class, 'sanitize_detail_layout' ),
				'auth_callback'     => static function ( $allowed, $meta_key, $post_id ): bool {
					return current_user_can( 'edit_post', (int) $post_id );
				},
			)
		);

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

		// Read-only via REST: the Published documents pane resolves the owner
		// page title for inline collections. Writes stay blocked by
		// `auth_callback` and by `validate_pre_insert` above, which rejects
		// re-parenting attempts on inline collections.
		register_post_meta(
			self::POST_TYPE,
			self::INLINE_OWNER_META_KEY,
			array(
				'type'              => 'integer',
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'absint',
				'auth_callback'     => static function () {
					return false;
				},
			)
		);
	}

	/**
	 * Cleans up the saved row-detail layout for a collection.
	 *
	 * @param mixed $value Incoming REST/meta value.
	 * @return array{fields: array<int, array{field: string, visible: bool}>}
	 */
	public static function sanitize_detail_layout( $value ): array {
		if ( is_object( $value ) ) {
			$value = (array) $value;
		}

		if ( ! is_array( $value ) ) {
			return array( 'fields' => array() );
		}

		$raw_fields = isset( $value['fields'] ) && is_array( $value['fields'] )
			? $value['fields']
			: array();

		$seen   = array();
		$fields = array();

		foreach ( $raw_fields as $entry ) {
			if ( is_object( $entry ) ) {
				$entry = (array) $entry;
			}

			if ( ! is_array( $entry ) || ! isset( $entry['field'] ) ) {
				continue;
			}

			$field = sanitize_text_field( (string) $entry['field'] );
			if ( '' === $field || isset( $seen[ $field ] ) || ! self::is_detail_layout_field_id( $field ) ) {
				continue;
			}

			$fields[]       = array(
				'field'   => $field,
				'visible' => isset( $entry['visible'] ) ? rest_sanitize_boolean( $entry['visible'] ) : true,
			);
			$seen[ $field ] = true;
		}

		return array( 'fields' => $fields );
	}

	private static function is_detail_layout_field_id( string $field ): bool {
		if ( 1 === preg_match( '/^field-[1-9][0-9]*$/', $field ) ) {
			return true;
		}

		return in_array(
			$field,
			array( 'created_at', 'created_by', 'modified_at', 'modified_by' ),
			true
		);
	}
}
