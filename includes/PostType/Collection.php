<?php
/**
 * Registers the `crtxt_collection` custom post type.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

final class Collection {

	public const POST_TYPE = 'crtxt_collection';

	public const MODE_META_KEY         = 'workspace_mode';
	public const INLINE_OWNER_META_KEY = '_cortext_inline_owner_page';

	public const MODE_INLINE    = 'inline';
	public const MODE_FULL_PAGE = 'full_page';

	public function register(): void {
		add_action( 'init', array( $this, 'register_post_type' ) );
	}

	public function register_post_type(): void {
		register_post_type(
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

		// Collections share the document lifecycle: title, identity, trash,
		// restore, permanent delete, command palette search. The DataView is
		// their canvas; block-editor content support stays off for now.
		DocumentIdentity::register_for_post_type( self::POST_TYPE );

		$this->register_meta();
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

		// Server-only. The editor does not need the owner id, and exposing it
		// would make it easy to point an inline collection at the wrong page.
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
