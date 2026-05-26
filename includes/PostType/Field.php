<?php
/**
 * Registers the `crtxt_field` custom post type.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

use Cortext\Fields\FieldDefaults;
use Cortext\Fields\FieldTypeRegistry;

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
		$this->register_rest_fields();
	}

	public function register_rest_fields(): void {
		register_rest_field(
			self::POST_TYPE,
			'cortext_capabilities',
			array(
				'get_callback' => array( $this, 'get_rest_capabilities' ),
				'schema'       => array(
					'type'       => 'object',
					'context'    => array( 'view', 'edit' ),
					'readonly'   => true,
					'properties' => array(
						'sortable'   => array(
							'type'     => 'boolean',
							'readonly' => true,
						),
						'filterable' => array(
							'type'     => 'boolean',
							'readonly' => true,
						),
						'operators'  => array(
							'type'     => 'array',
							'readonly' => true,
							'items'    => array(
								'type' => 'string',
							),
						),
					),
				),
			)
		);
	}

	/**
	 * Returns query capabilities for one field REST record.
	 *
	 * @param array<string,mixed> $field_record REST post response data.
	 * @return array{sortable:bool,filterable:bool,operators:string[]}
	 */
	public function get_rest_capabilities( array $field_record ): array {
		$field_id = isset( $field_record['id'] ) ? (int) $field_record['id'] : 0;
		$type     = $field_id > 0 ? (string) get_post_meta( $field_id, 'type', true ) : '';

		return FieldTypeRegistry::capabilities_for( $type );
	}

	private function register_meta(): void {
		$string_meta = array(
			'type',
			'options',
			'number_format',
			'date_format',
			'expression',
			'rollup_aggregator',
			'rollup_target_type',
			'rollup_target_options',
			'rollup_target_number_format',
			'rollup_target_date_format',
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
			'description',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_textarea_field',
			)
		);

		register_post_meta(
			self::POST_TYPE,
			FieldDefaults::META_KEY,
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => array( FieldDefaults::class, 'sanitize_meta_value' ),
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'related_collection_id',
			array(
				'type'         => 'integer',
				'single'       => true,
				'show_in_rest' => true,
			)
		);

		$integer_meta = array(
			'relation_reverse_field_id',
			'rollup_relation_field_id',
			'rollup_target_field_id',
			'rollup_target_related_collection_id',
		);

		foreach ( $integer_meta as $key ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				array(
					'type'         => 'integer',
					'single'       => true,
					'show_in_rest' => true,
				)
			);
		}

		register_post_meta(
			self::POST_TYPE,
			'relation_multiple',
			array(
				'type'         => 'boolean',
				'single'       => true,
				'show_in_rest' => true,
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'rollup_target_relation_multiple',
			array(
				'type'         => 'boolean',
				'single'       => true,
				'show_in_rest' => true,
			)
		);
	}
}
