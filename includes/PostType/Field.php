<?php
/**
 * Registers the `crtxt_field` custom post type.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

final class Field {

	public const POST_TYPE = 'crtxt_field';

	public function register(): void {
		add_action( 'init', array( $this, 'register_post_type' ) );
	}

	public function register_post_type(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'             => array(
					'name'          => __( 'Fields', 'cortext' ),
					'singular_name' => __( 'Field', 'cortext' ),
					'menu_name'     => __( 'Fields', 'cortext' ),
					'add_new_item'  => __( 'Add New Field', 'cortext' ),
					'edit_item'     => __( 'Edit Field', 'cortext' ),
					'new_item'      => __( 'New Field', 'cortext' ),
					'view_item'     => __( 'View Field', 'cortext' ),
					'search_items'  => __( 'Search Fields', 'cortext' ),
					'all_items'     => __( 'All Fields', 'cortext' ),
				),
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
				'show_in_menu'       => false,
				'show_in_rest'       => true,
				'rest_base'          => 'crtxt_fields',
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
		$string_meta = array(
			'notion_id',
			'type',
			'options',
			'number_format',
			'date_format',
			'expression',
		);

		foreach ( $string_meta as $key ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				array(
					'type'              => 'string',
					'single'            => true,
					'show_in_rest'      => true,
					'sanitize_callback' => 'sanitize_text_field',
				)
			);
		}

		register_post_meta(
			self::POST_TYPE,
			'related_collection_id',
			array(
				'type'         => 'integer',
				'single'       => true,
				'show_in_rest' => true,
			)
		);
	}
}
