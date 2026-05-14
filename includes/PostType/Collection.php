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
				'hierarchical'       => false,
				'supports'           => array( 'title', 'custom-fields' ),
				'capability_type'    => 'post',
				'map_meta_cap'       => true,
				'can_export'         => true,
				'delete_with_user'   => false,
			)
		);

		$this->register_meta();
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
	}
}
