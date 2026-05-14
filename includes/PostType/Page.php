<?php
/**
 * Registers the `crtxt_page` custom post type.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

final class Page {

	public const POST_TYPE = 'crtxt_page';

	public function register(): void {
		add_action( 'init', array( $this, 'register_post_type' ) );
	}

	public function register_post_type(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'                => array(
					'name'          => __( 'Cortext Pages', 'cortext' ),
					'singular_name' => __( 'Cortext Page', 'cortext' ),
					'menu_name'     => __( 'Cortext Pages', 'cortext' ),
					'add_new_item'  => __( 'Add New Cortext Page', 'cortext' ),
					'edit_item'     => __( 'Edit Cortext Page', 'cortext' ),
					'new_item'      => __( 'New Cortext Page', 'cortext' ),
					'view_item'     => __( 'View Cortext Page', 'cortext' ),
					'search_items'  => __( 'Search Cortext Pages', 'cortext' ),
					'all_items'     => __( 'All Cortext Pages', 'cortext' ),
				),
				'public'                => false,
				'publicly_queryable'    => true,
				'exclude_from_search'   => true,
				'rewrite'               => array(
					'slug'       => 'cortext',
					'with_front' => false,
				),
				// The React shell is the primary UI. Core's admin screens
				// (edit.php list + post.php editor) stay enabled as an
				// escape hatch, exposed through Admin\Screen's submenu.
				'show_ui'               => true,
				'show_in_menu'          => false,
				'show_in_rest'          => true,
				// Matches useResolveEntity.js's `/wp/v2/${POST_TYPE}s?...` URL shape; core
				// defaults rest_base to the CPT slug (`crtxt_page`), which would 404 the
				// segment-walk resolver. Keep explicit.
				'rest_base'             => 'crtxt_pages',
				'rest_controller_class' => 'WP_REST_Posts_Controller',
				'has_archive'           => false,
				'hierarchical'          => true,
				'supports'              => array(
					'title',
					'editor',
					// Load-bearing: RevisionThrottle's filters only fire on post types that support revisions. Do not remove.
					'revisions',
					'page-attributes',
					// `meta` only appears in the REST schema when a CPT
					// supports custom-fields; PageTrashCascade's marker meta
					// (registered with `show_in_rest`) needs this so the
					// sidebar Trash filter can read it on the client.
					'custom-fields',
					// Document covers ride on the native featured image so REST
					// already exposes `featured_media`; the React shell reads
					// and writes it directly.
					'thumbnail',
				),
				'capability_type'       => 'post',
				'map_meta_cap'          => true,
				'can_export'            => true,
				'delete_with_user'      => false,
			)
		);

		DocumentIdentity::register_for_post_type( self::POST_TYPE );
	}
}
