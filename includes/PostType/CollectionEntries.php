<?php
/**
 * Dynamically registers one CPT per published collection.
 *
 * Each `crtxt_collection` post produces a `crtxt_{slug}` post type
 * whose entries are the rows of that collection. Field-level post meta
 * is registered for each attached `crtxt_field`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

use WP_Post;

final class CollectionEntries {

	/**
	 * Prefix for dynamically registered entry CPTs.
	 *
	 * WordPress enforces a 20-character limit on post type slugs, so dynamic
	 * row CPTs use the shared `crtxt_` prefix and leave 14 characters for the
	 * collection slug.
	 */
	public const CPT_PREFIX  = 'crtxt_';
	public const MAX_CPT_LEN = 20;

	public function register(): void {
		add_action( 'init', array( $this, 'register_all' ), 20 );
	}

	public function register_all(): void {
		$collections = get_posts(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				'numberposts' => -1,
			)
		);

		foreach ( $collections as $collection ) {
			$this->register_for_collection( $collection );
		}
	}

	public function register_for_collection( WP_Post $collection ): void {
		$slug = get_post_meta( $collection->ID, 'slug', true );
		if ( ! $slug ) {
			return;
		}

		if ( strlen( self::CPT_PREFIX . $slug ) > self::MAX_CPT_LEN ) {
			_doing_it_wrong(
				__METHOD__,
				esc_html(
					sprintf(
						/* translators: 1: collection slug, 2: maximum allowed length */
						__( 'Collection slug "%1$s" exceeds the %2$d-character limit and was not registered.', 'cortext' ),
						$slug,
						self::MAX_CPT_LEN - strlen( self::CPT_PREFIX )
					)
				),
				'0.0.1'
			);
			return;
		}

		$post_type = self::CPT_PREFIX . $slug;
		if ( post_type_exists( $post_type ) ) {
			return;
		}

		register_post_type(
			$post_type,
			array(
				'labels'             => array(
					'name'          => $collection->post_title,
					'singular_name' => $collection->post_title,
				),
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
				'show_in_menu'       => false,
				'show_in_rest'       => true,
				'rest_base'          => $post_type,
				'has_archive'        => false,
				'hierarchical'       => false,
				'supports'           => array( 'title', 'custom-fields' ),
				'capability_type'    => 'post',
				'map_meta_cap'       => true,
				'can_export'         => true,
				'delete_with_user'   => false,
			)
		);

		register_post_meta(
			$post_type,
			'notion_id',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_text_field',
			)
		);

		$this->register_field_meta( $post_type, $collection->ID );
	}

	private function register_field_meta( string $post_type, int $collection_id ): void {
		$field_ids = get_post_meta( $collection_id, 'fields', false );

		foreach ( $field_ids as $field_id ) {
			$field = get_post( (int) $field_id );
			if ( ! $field ) {
				continue;
			}

			$field_type = get_post_meta( $field->ID, 'type', true );

			register_post_meta(
				$post_type,
				"field-{$field->ID}",
				array(
					'type'         => self::wp_meta_type_for( $field_type ),
					'single'       => ! in_array( $field_type, array( 'multiselect', 'relation' ), true ),
					'show_in_rest' => true,
				)
			);
		}
	}

	public static function wp_meta_type_for( string $cortext_type ): string {
		return match ( $cortext_type ) {
			'number'   => 'number',
			'checkbox' => 'boolean',
			default    => 'string',
		};
	}
}
