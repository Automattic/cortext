<?php
/**
 * Registers the `crtxt_field` custom post type.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

defined( 'ABSPATH' ) || exit;

use Cortext\Fields\FieldDefaults;
use Cortext\Fields\FieldTypeRegistry;
use WP_Error;
use WP_Post;

final class Field {

	public const POST_TYPE = 'crtxt_field';

	/**
	 * Field IDs whose paired reverse deletion is already in progress, so the
	 * cascade does not bounce back when `wp_delete_post` fires on the reverse.
	 *
	 * @var array<int,true>
	 */
	private static array $deleting_relation_fields = array();

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
		add_action( 'before_delete_post', array( $this, 'cleanup_after_delete' ), 10, 2 );
	}

	/**
	 * Detaches a deleted field from the data model.
	 *
	 * Runs on every deletion path (REST, wp-admin, WP-CLI) and, in order:
	 *
	 * 1. Drops rollup fields that depend on the field, detaching them from
	 *    their owner collections.
	 * 2. For a relation field, detaches both sides of the pair from their
	 *    owner collections, drops their dependent rollups, and deletes the
	 *    reverse field (guarded against the reverse delete bouncing back).
	 * 3. Removes the `field-<id>` value meta from every row.
	 * 4. Removes the field's string ID from every collection's
	 *    `cortext_fields` schema list.
	 *
	 * @param int          $post_id Post being deleted.
	 * @param WP_Post|null $post    Post object, or null in pathological calls.
	 */
	public function cleanup_after_delete( int $post_id, ?WP_Post $post = null ): void {
		$post_type = $post instanceof WP_Post ? $post->post_type : get_post_type( $post_id );
		if ( self::POST_TYPE !== $post_type ) {
			return;
		}

		$this->delete_dependent_rollups( $post_id );

		$reverse_id = (int) get_post_meta( $post_id, 'relation_reverse_field_id', true );
		if ( $reverse_id > 0 && empty( self::$deleting_relation_fields[ $reverse_id ] ) ) {
			$reverse = get_post( $reverse_id );
			if ( $reverse instanceof WP_Post && self::POST_TYPE === $reverse->post_type ) {
				$this->detach_from_collections( $post_id );
				$this->detach_from_collections( $reverse_id );
				$this->delete_dependent_rollups( $reverse_id );

				self::$deleting_relation_fields[ $post_id ] = true;
				wp_delete_post( $reverse_id, true );
				unset( self::$deleting_relation_fields[ $post_id ] );
			}
		}

		// Drop the field's `field-<id>` value meta from every row.
		// `delete_post_meta_by_key` clears the key from every post, but the
		// key is naturally unique: `<id>` is a globally unique post ID for a
		// `crtxt_field`, so any `field-<id>` postmeta row belongs to a Cortext
		// row by construction.
		delete_post_meta_by_key( "field-{$post_id}" );

		// Detach the field's string ID from any collection's `cortext_fields`
		// schema list, preserving the order of the remaining IDs.
		$this->detach_from_collections( $post_id );
	}

	/**
	 * Removes a field's string ID from every collection that lists it in
	 * `cortext_fields`. Owners are resolved through a `meta_query` and filtered
	 * to documents that define a trait, so a stray `field-<id>` value on a
	 * page or row is left untouched.
	 *
	 * @param int $field_id Field post ID to detach.
	 */
	private function detach_from_collections( int $field_id ): void {
		$field_id_str = (string) $field_id;
		$owner_ids    = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => array( 'draft', 'private', 'publish', 'trash' ),
				'fields'         => 'ids',
				'posts_per_page' => -1,
				'no_found_rows'  => true,
				'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => 'cortext_fields',
						'value'   => $field_id_str,
						'compare' => '=',
					),
				),
			)
		);
		foreach ( array_map( 'intval', $owner_ids ) as $owner_id ) {
			if ( ! Document::is_collection( $owner_id ) ) {
				continue;
			}
			delete_post_meta( $owner_id, 'cortext_fields', $field_id_str );
		}
	}

	/**
	 * Deletes rollup fields that depend on a deleted relation or target field,
	 * detaching each from its owner collections before removing the post. A
	 * dangling rollup would otherwise leave a column whose source is gone.
	 *
	 * @param int $field_id Field post ID being deleted.
	 */
	private function delete_dependent_rollups( int $field_id ): void {
		$field_id_str = (string) $field_id;
		$rollup_ids   = array();
		foreach ( array( 'rollup_relation_field_id', 'rollup_target_field_id' ) as $meta_key ) {
			$dependents = get_posts(
				array(
					'post_type'      => self::POST_TYPE,
					'post_status'    => array( 'draft', 'private', 'publish' ),
					'fields'         => 'ids',
					'posts_per_page' => -1,
					'no_found_rows'  => true,
					'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
						array(
							'key'     => $meta_key,
							'value'   => $field_id_str,
							'compare' => '=',
						),
					),
				)
			);
			$rollup_ids = array_merge( $rollup_ids, array_map( 'intval', $dependents ) );
		}

		foreach ( array_unique( $rollup_ids ) as $rollup_id ) {
			if (
				$rollup_id === $field_id
				|| self::POST_TYPE !== get_post_type( $rollup_id )
				|| 'rollup' !== (string) get_post_meta( $rollup_id, 'type', true )
			) {
				continue;
			}
			$this->detach_from_collections( $rollup_id );
			wp_delete_post( $rollup_id, true );
		}
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

		register_rest_field(
			self::POST_TYPE,
			'cortext_formula',
			array(
				'get_callback' => array( $this, 'get_rest_formula' ),
				'schema'       => array(
					'type'       => array( 'object', 'null' ),
					'context'    => array( 'view', 'edit' ),
					'readonly'   => true,
					'properties' => array(
						'expression'  => array(
							'type'     => 'string',
							'readonly' => true,
						),
						'result_type' => array(
							'type'     => 'string',
							'readonly' => true,
						),
						'is_volatile' => array(
							'type'     => 'boolean',
							'readonly' => true,
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

		return FieldTypeRegistry::capabilities_for_field( $field_id, $type );
	}

	/**
	 * Returns formula metadata for one field REST record.
	 *
	 * Formula edits go through the dedicated formula endpoint so the
	 * compiled AST, dependencies, result type, and volatility stay in sync.
	 *
	 * @param array<string,mixed> $field_record REST post response data.
	 * @return array{expression:string,result_type:string,is_volatile:bool}|null
	 */
	public function get_rest_formula( array $field_record ): ?array {
		$field_id = isset( $field_record['id'] ) ? (int) $field_record['id'] : 0;
		if ( $field_id < 1 || 'formula' !== (string) get_post_meta( $field_id, 'type', true ) ) {
			return null;
		}

		return array(
			'expression'  => (string) get_post_meta( $field_id, 'expression', true ),
			'result_type' => (string) get_post_meta( $field_id, 'formula_result_type', true ),
			'is_volatile' => '1' === (string) get_post_meta( $field_id, 'formula_is_volatile', true ),
		);
	}

	private function register_meta(): void {
		$string_meta = array(
			'type',
			'options',
			'number_format',
			'date_format',
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
			'expression',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => false,
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
			'formula_result_type',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => false,
				'sanitize_callback' => 'sanitize_text_field',
			)
		);

		foreach ( array( 'formula_ast', 'formula_dep_field_ids', 'formula_resolved_refs' ) as $key ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				array(
					'type'              => 'string',
					'single'            => true,
					'show_in_rest'      => false,
					'sanitize_callback' => static fn( mixed $value ): string => is_string( $value ) ? $value : '',
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

		register_post_meta(
			self::POST_TYPE,
			'formula_is_volatile',
			array(
				'type'         => 'boolean',
				'single'       => true,
				'show_in_rest' => false,
			)
		);
	}
}
