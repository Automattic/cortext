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
use WP_Error;
use WP_Post;

final class Field {

	public const POST_TYPE = 'crtxt_field';

	/**
	 * Cortext-specific meta keys exposed directly on the save payload so
	 * callers do not need to know the internal storage names. Anything
	 * outside this list goes through the `meta` escape hatch.
	 *
	 * @var string[]
	 */
	private const DIRECT_META_KEYS = array(
		'type',
		'description',
		'number_format',
		'date_format',
		'expression',
		'related_collection_id',
		'relation_multiple',
		'relation_reverse_field_id',
		'rollup_aggregator',
		'rollup_target_type',
		'rollup_target_options',
		'rollup_target_number_format',
		'rollup_target_date_format',
		'rollup_relation_field_id',
		'rollup_target_field_id',
		'rollup_target_related_collection_id',
		'rollup_target_relation_multiple',
	);

	/**
	 * Creates or updates a `crtxt_field` post. Same shape covers create
	 * (no `id`) and update (with `id`).
	 *
	 * Payload keys:
	 *   - id          (int)             Update when present; create otherwise.
	 *   - title       (string)          post_title.
	 *   - status      (string)          post_status. Default 'private' on create.
	 *   - type        (string)          Cortext field type.
	 *   - options     (array|string)    Option list. Arrays are JSON-encoded.
	 *   - default     (string)          Default value (stored as `default_value`).
	 *   - description (string)          Field description.
	 *   - meta        (array)           Extra meta_input merged last
	 *                                   (escape hatch for breadcrumbs,
	 *                                   e.g. `cortext_notion_property_id`).
	 *   - Plus any of the direct meta keys above.
	 *
	 * @param array<string,mixed> $payload Save payload.
	 *
	 * @return int|WP_Error Field id, or WP_Error.
	 */
	public static function save( array $payload ): int|WP_Error {
		$is_update = isset( $payload['id'] ) && (int) $payload['id'] > 0;

		$postarr = array( 'post_type' => self::POST_TYPE );

		if ( $is_update ) {
			$field_id = (int) $payload['id'];
			$existing = get_post( $field_id );
			if ( ! $existing instanceof WP_Post || self::POST_TYPE !== $existing->post_type ) {
				return new WP_Error(
					'cortext_field_not_found',
					__( 'Field not found.', 'cortext' ),
					array( 'status' => 404 )
				);
			}
			$postarr['ID'] = $field_id;
		} else {
			$postarr['post_status'] = isset( $payload['status'] )
				? (string) $payload['status']
				: 'private';
		}

		if ( array_key_exists( 'title', $payload ) ) {
			$postarr['post_title'] = (string) $payload['title'];
		}
		if ( $is_update && array_key_exists( 'status', $payload ) ) {
			$postarr['post_status'] = (string) $payload['status'];
		}

		$meta = array();
		foreach ( self::DIRECT_META_KEYS as $key ) {
			if ( array_key_exists( $key, $payload ) ) {
				$meta[ $key ] = $payload[ $key ];
			}
		}

		if ( array_key_exists( 'options', $payload ) ) {
			$opts            = $payload['options'];
			$meta['options'] = is_array( $opts ) ? (string) wp_json_encode( $opts ) : (string) $opts;
		}

		if ( array_key_exists( 'default', $payload ) ) {
			$meta[ FieldDefaults::META_KEY ] = (string) $payload['default'];
		}

		if ( isset( $payload['meta'] ) && is_array( $payload['meta'] ) ) {
			$meta = array_merge( $meta, $payload['meta'] );
		}

		if ( count( $meta ) > 0 ) {
			$postarr['meta_input'] = $meta;
		}

		$result = $is_update
			? wp_update_post( $postarr, true )
			: wp_insert_post( $postarr, true );

		if ( $result instanceof WP_Error ) {
			return $result;
		}

		return (int) $result;
	}

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
