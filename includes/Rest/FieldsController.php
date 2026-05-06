<?php
/**
 * REST endpoints for creating and duplicating Cortext fields.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\OptionPalette;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\Relations;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class FieldsController {

	private const NAMESPACE = 'cortext/v1';

	private const ALLOWED_TYPES = array(
		'text',
		'email',
		'url',
		'number',
		'date',
		'datetime',
		'checkbox',
		'select',
		'multiselect',
		'relation',
	);

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/collections/(?P<collection_id>\d+)/fields',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'create' ),
					'permission_callback' => array( $this, 'can_edit_collection' ),
					'args'                => array(
						'collection_id'         => array(
							'type'     => 'integer',
							'required' => true,
						),
						'title'                 => array(
							'type'     => 'string',
							'required' => true,
						),
						'type'                  => array(
							'type'     => 'string',
							'required' => true,
							'enum'     => self::ALLOWED_TYPES,
						),
						'options'               => array(
							'type'     => 'array',
							'required' => false,
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'value' => array( 'type' => 'string' ),
									'label' => array( 'type' => 'string' ),
									'color' => array( 'type' => 'string' ),
								),
							),
						),
						'related_collection_id' => array(
							'type'     => 'integer',
							'required' => false,
						),
						'relation_multiple'     => array(
							'type'     => 'boolean',
							'required' => false,
							'default'  => true,
						),
						'reverse_title'         => array(
							'type'     => 'string',
							'required' => false,
						),
						'reverse_multiple'      => array(
							'type'     => 'boolean',
							'required' => false,
							'default'  => true,
						),
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/collections/(?P<collection_id>\d+)/fields/(?P<field_id>\d+)/duplicate',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'duplicate' ),
					'permission_callback' => array( $this, 'can_edit_collection' ),
					'args'                => array(
						'collection_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'field_id'      => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/fields/(?P<field_id>\d+)/options',
			array(
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'update_options' ),
					'permission_callback' => array( $this, 'can_edit_field' ),
					'args'                => array(
						'field_id'   => array(
							'type'     => 'integer',
							'required' => true,
						),
						'options'    => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'value' => array( 'type' => 'string' ),
									'label' => array( 'type' => 'string' ),
									'color' => array( 'type' => 'string' ),
								),
							),
						),
						'migrations' => array(
							'type'     => 'array',
							'required' => false,
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'from'   => array( 'type' => 'string' ),
									'action' => array(
										'type' => 'string',
										'enum' => array( 'clear', 'replace' ),
									),
									'to'     => array( 'type' => 'string' ),
								),
							),
						),
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/fields/(?P<field_id>\d+)/options/(?P<value>[^/]+)/usage',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'option_usage' ),
					'permission_callback' => array( $this, 'can_edit_field' ),
					'args'                => array(
						'field_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'value'    => array(
							'type'     => 'string',
							'required' => true,
						),
					),
				),
			)
		);
	}

	public function can_edit_collection( WP_REST_Request $request ): bool|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$collection    = get_post( $collection_id );
		if ( ! $collection instanceof WP_Post || Collection::POST_TYPE !== $collection->post_type ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}
		return current_user_can( 'edit_post', $collection_id );
	}

	public function can_edit_field( WP_REST_Request $request ): bool|WP_Error {
		$field_id = (int) $request->get_param( 'field_id' );
		$field    = get_post( $field_id );
		if ( ! $field instanceof WP_Post || Field::POST_TYPE !== $field->post_type ) {
			return new WP_Error(
				'cortext_field_not_found',
				__( 'Field not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}
		return current_user_can( 'edit_post', $field_id );
	}

	public function create( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );

		$collection_or_error = $this->require_collection( $collection_id );
		if ( is_wp_error( $collection_or_error ) ) {
			return $collection_or_error;
		}

		$title = trim( sanitize_text_field( (string) $request->get_param( 'title' ) ) );
		if ( '' === $title ) {
			return new WP_Error(
				'cortext_field_title_required',
				__( 'Field name is required.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$type    = (string) $request->get_param( 'type' );
		$options = $request->get_param( 'options' );

		if ( 'relation' === $type ) {
			return $this->create_relation( $request, $collection_id, $title );
		}

		$meta = array( 'type' => $type );
		if ( $this->type_supports_options( $type ) && is_array( $options ) ) {
			$meta['options'] = wp_json_encode( $this->normalize_options( $options ) );
		}

		return $this->insert_and_attach( $collection_id, $title, $meta );
	}

	public function duplicate( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$field_id      = (int) $request->get_param( 'field_id' );

		$collection_or_error = $this->require_collection( $collection_id );
		if ( is_wp_error( $collection_or_error ) ) {
			return $collection_or_error;
		}

		$source = get_post( $field_id );
		if ( ! $source instanceof WP_Post || Field::POST_TYPE !== $source->post_type ) {
			return new WP_Error(
				'cortext_field_not_found',
				__( 'Field not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$existing_ids = $this->collection_field_ids( $collection_id );
		if ( ! in_array( (string) $field_id, $existing_ids, true ) ) {
			return new WP_Error(
				'cortext_field_not_in_collection',
				__( 'Field does not belong to this collection.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		/* translators: %s: source field title */
		$copy_title  = trim( sprintf( __( 'Copy of %s', 'cortext' ), $source->post_title ) );
		$source_type = (string) get_post_meta( $field_id, 'type', true );

		if ( 'relation' === $source_type ) {
			$reverse_id    = (int) get_post_meta( $field_id, 'relation_reverse_field_id', true );
			$reverse       = $reverse_id > 0 ? get_post( $reverse_id ) : null;
			$reverse_title = '';
			if ( $reverse instanceof WP_Post ) {
				/* translators: %s: reverse field title */
				$reverse_title = trim( sprintf( __( 'Copy of %s', 'cortext' ), $reverse->post_title ) );
			}

			$copy_request = new WP_REST_Request( 'POST', $request->get_route() );
			$copy_request->set_param( 'related_collection_id', (int) get_post_meta( $field_id, 'related_collection_id', true ) );
			$copy_request->set_param( 'relation_multiple', Relations::relation_is_multiple( $field_id ) );
			$copy_request->set_param( 'reverse_multiple', $reverse_id > 0 ? Relations::relation_is_multiple( $reverse_id ) : true );
			$copy_request->set_param( 'reverse_title', $reverse_title );
			return $this->create_relation( $copy_request, $collection_id, $copy_title, (string) $field_id );
		}

		$meta = array();
		foreach (
			array(
				'type',
				'options',
				'number_format',
				'date_format',
				'expression',
				'related_collection_id',
				'relation_multiple',
			) as $key
		) {
			$value = get_post_meta( $field_id, $key, true );
			if ( '' !== $value && null !== $value ) {
				$meta[ $key ] = (string) $value;
			}
		}

		return $this->insert_and_attach( $collection_id, $copy_title, $meta, (string) $field_id );
	}

	public function update_options( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$field_id = (int) $request->get_param( 'field_id' );
		$field    = get_post( $field_id );
		if ( ! $field instanceof WP_Post || Field::POST_TYPE !== $field->post_type ) {
			return new WP_Error(
				'cortext_field_not_found',
				__( 'Field not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$type = (string) get_post_meta( $field_id, 'type', true );
		if ( ! $this->type_supports_options( $type ) ) {
			return new WP_Error(
				'cortext_field_type_unsupported',
				__( 'This field type does not support options.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$options = $request->get_param( 'options' );
		if ( ! is_array( $options ) ) {
			$options = array();
		}
		$normalized = $this->normalize_options( $options );

		$migrations = $request->get_param( 'migrations' );
		$migrated   = array();
		if ( is_array( $migrations ) ) {
			$valid_values = array_column( $normalized, 'value' );
			foreach ( $migrations as $migration ) {
				$from   = isset( $migration['from'] ) ? (string) $migration['from'] : '';
				$action = isset( $migration['action'] ) ? (string) $migration['action'] : '';
				$to     = isset( $migration['to'] ) ? (string) $migration['to'] : '';
				if ( '' === $from || ! in_array( $action, array( 'clear', 'replace' ), true ) ) {
					continue;
				}
				if ( 'replace' === $action && ! in_array( $to, $valid_values, true ) ) {
					return new WP_Error(
						'cortext_invalid_replacement',
						__( 'Replacement option does not exist in the new option list.', 'cortext' ),
						array( 'status' => 400 )
					);
				}
				$count             = $this->migrate_rows( $field_id, $type, $from, $action, $to );
				$migrated[ $from ] = $count;
			}
		}

		update_post_meta( $field_id, 'options', wp_json_encode( $normalized ) );

		return new WP_REST_Response(
			array(
				'id'       => $field_id,
				'options'  => $normalized,
				'migrated' => (object) $migrated,
			),
			200
		);
	}

	public function option_usage( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$field_id = (int) $request->get_param( 'field_id' );
		$value    = (string) $request->get_param( 'value' );

		$field = get_post( $field_id );
		if ( ! $field instanceof WP_Post || Field::POST_TYPE !== $field->post_type ) {
			return new WP_Error(
				'cortext_field_not_found',
				__( 'Field not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response(
			array(
				'value' => $value,
				'count' => $this->count_rows_with_value( $field_id, $value ),
			),
			200
		);
	}

	/**
	 * Walks every Cortext entry CPT and applies the migration on rows that
	 * carry the old value in `field-<id>` postmeta.
	 *
	 * - clear: removes every matching meta row.
	 * - replace on a single-value (select) field: rewrites the row.
	 * - replace on a multi-value (multiselect) field: removes the old value
	 *   and adds the new one only when it is not already present, so a row
	 *   that already had both options does not gain a duplicate.
	 *
	 * @param int    $field_id Field post ID whose row meta is being rewritten.
	 * @param string $type     Field type (`select` or `multiselect`).
	 * @param string $from     Existing option value to migrate away from.
	 * @param string $action   `clear` or `replace`.
	 * @param string $to       New value when `$action` is `replace`.
	 * @return int Number of rows touched.
	 */
	private function migrate_rows( int $field_id, string $type, string $from, string $action, string $to ): int {
		$meta_key      = "field-{$field_id}";
		$is_multivalue = 'multiselect' === $type;
		$touched       = 0;

		foreach ( CollectionEntries::get_entry_post_types() as $post_type ) {
			$row_ids = get_posts(
				array(
					'post_type'      => $post_type,
					'post_status'    => array( 'draft', 'pending', 'private', 'publish', 'future', 'inherit' ),
					'posts_per_page' => -1,
					'fields'         => 'ids',
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- bounded migration over Cortext rows.
					'meta_query'     => array(
						array(
							'key'     => $meta_key,
							'value'   => $from,
							'compare' => '=',
						),
					),
				)
			);

			foreach ( $row_ids as $row_id ) {
				$row_id = (int) $row_id;
				if ( 'clear' === $action ) {
					if ( delete_post_meta( $row_id, $meta_key, $from ) ) {
						++$touched;
					}
					continue;
				}

				// Replace branch.
				if ( $is_multivalue ) {
					$existing = get_post_meta( $row_id, $meta_key, false );
					$has_to   = is_array( $existing ) && in_array( $to, $existing, true );
					if ( delete_post_meta( $row_id, $meta_key, $from ) ) {
						++$touched;
					}
					if ( ! $has_to ) {
						add_post_meta( $row_id, $meta_key, $to );
					}
				} elseif ( update_post_meta( $row_id, $meta_key, $to ) ) {
						++$touched;
				}
			}
		}

		return $touched;
	}

	private function count_rows_with_value( int $field_id, string $value ): int {
		$meta_key = "field-{$field_id}";
		$count    = 0;
		foreach ( CollectionEntries::get_entry_post_types() as $post_type ) {
			$row_ids = get_posts(
				array(
					'post_type'      => $post_type,
					'post_status'    => array( 'draft', 'pending', 'private', 'publish', 'future', 'inherit' ),
					'posts_per_page' => -1,
					'fields'         => 'ids',
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- bounded count over Cortext rows.
					'meta_query'     => array(
						array(
							'key'     => $meta_key,
							'value'   => $value,
							'compare' => '=',
						),
					),
				)
			);
			$count += count( $row_ids );
		}
		return $count;
	}

	private function create_relation(
		WP_REST_Request $request,
		int $collection_id,
		string $title,
		?string $insert_after_id = null
	): WP_REST_Response|WP_Error {
		$target_collection_id = (int) $request->get_param( 'related_collection_id' );
		$target_or_error      = $this->require_collection( $target_collection_id );
		if ( is_wp_error( $target_or_error ) ) {
			return new WP_Error(
				'cortext_relation_target_required',
				__( 'Relation target collection is required.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$source_collection = get_post( $collection_id );
		$source_title      = $source_collection instanceof WP_Post ? $source_collection->post_title : '';
		$reverse_title     = trim( sanitize_text_field( (string) $request->get_param( 'reverse_title' ) ) );
		if ( '' === $reverse_title ) {
			$reverse_title = trim(
				sprintf(
					/* translators: %s: collection name */
					__( 'Related %s', 'cortext' ),
					'' !== $source_title ? $source_title : __( 'items', 'cortext' )
				)
			);
		}

		$source_multiple_param  = $request->get_param( 'relation_multiple' );
		$reverse_multiple_param = $request->get_param( 'reverse_multiple' );
		$source_multiple        = null === $source_multiple_param ? true : Relations::is_truthy( $source_multiple_param );
		$reverse_multiple       = null === $reverse_multiple_param ? true : Relations::is_truthy( $reverse_multiple_param );

		$source_meta  = array(
			'type'                  => 'relation',
			'related_collection_id' => (string) $target_collection_id,
			'relation_multiple'     => $source_multiple ? '1' : '0',
		);
		$reverse_meta = array(
			'type'                  => 'relation',
			'related_collection_id' => (string) $collection_id,
			'relation_multiple'     => $reverse_multiple ? '1' : '0',
		);

		$source_id = $this->insert_and_attach_id( $collection_id, $title, $source_meta, $insert_after_id );
		if ( is_wp_error( $source_id ) ) {
			return $source_id;
		}

		$reverse_id = $this->insert_and_attach_id( $target_collection_id, $reverse_title, $reverse_meta );
		if ( is_wp_error( $reverse_id ) ) {
			$this->detach_field( $collection_id, $source_id );
			wp_delete_post( $source_id, true );
			return $reverse_id;
		}

		$linked_source  = update_post_meta( $source_id, 'relation_reverse_field_id', (string) $reverse_id );
		$linked_reverse = update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $source_id );
		if ( false === $linked_source || false === $linked_reverse ) {
			$this->detach_field( $collection_id, $source_id );
			$this->detach_field( $target_collection_id, $reverse_id );
			wp_delete_post( $source_id, true );
			wp_delete_post( $reverse_id, true );
			return new WP_Error(
				'cortext_relation_link_failed',
				__( 'Relation fields could not be linked.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		return $this->field_response( $source_id, $title, 'relation' );
	}

	/**
	 * Inserts a new field post and attaches it to the collection.
	 *
	 * If the attach step fails the just-created field post is force-deleted so
	 * callers never observe an orphan field. When `$insert_after_id` is set the
	 * new field's string ID is spliced into the collection's `meta.fields`
	 * directly after that ID; otherwise it appends to the end.
	 *
	 * @param int                  $collection_id   Collection post ID.
	 * @param string               $title           Field title.
	 * @param array<string,string> $meta            Meta keys to write on the new field.
	 * @param string|null          $insert_after_id String ID to insert after, or null to append.
	 */
	private function insert_and_attach(
		int $collection_id,
		string $title,
		array $meta,
		?string $insert_after_id = null
	): WP_REST_Response|WP_Error {
		$field_id = $this->insert_and_attach_id( $collection_id, $title, $meta, $insert_after_id );
		if ( is_wp_error( $field_id ) ) {
			return $field_id;
		}

		return $this->field_response( $field_id, $title, isset( $meta['type'] ) ? $meta['type'] : '' );
	}

	/**
	 * Inserts a field post and attaches it to a collection.
	 *
	 * @param int                  $collection_id   Collection post ID.
	 * @param string               $title           Field title.
	 * @param array<string,string> $meta Meta keys to write on the new field.
	 * @param string|null          $insert_after_id String ID to insert after, or null to append.
	 * @return int|WP_Error
	 */
	private function insert_and_attach_id(
		int $collection_id,
		string $title,
		array $meta,
		?string $insert_after_id = null
	): int|WP_Error {
		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => $meta,
			),
			true
		);

		if ( is_wp_error( $field_id ) ) {
			return $field_id;
		}

		$attached = $this->attach_field( $collection_id, (int) $field_id, $insert_after_id );
		if ( ! $attached ) {
			$this->detach_field( $collection_id, (int) $field_id );
			wp_delete_post( (int) $field_id, true );
			return new WP_Error(
				'cortext_field_attach_failed',
				__( 'Field could not be attached to the collection.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		$collection = get_post( $collection_id );
		if ( $collection instanceof WP_Post ) {
			( new CollectionEntries() )->register_for_collection( $collection );
		}

		return (int) $field_id;
	}

	private function field_response( int $field_id, string $title, string $type ): WP_REST_Response {
		$field = get_post( (int) $field_id );

		return new WP_REST_Response(
			array(
				'id'    => (int) $field_id,
				'title' => $field instanceof WP_Post ? $field->post_title : $title,
				'type'  => $type,
			),
			201
		);
	}

	private function attach_field( int $collection_id, int $field_id, ?string $insert_after_id ): bool {
		$field_id_str = (string) $field_id;

		if ( null === $insert_after_id ) {
			$result = add_post_meta( $collection_id, 'fields', $field_id_str );
			return false !== $result;
		}

		$existing  = $this->collection_field_ids( $collection_id );
		$reordered = array();
		$inserted  = false;
		foreach ( $existing as $id ) {
			$reordered[] = $id;
			if ( $id === $insert_after_id ) {
				$reordered[] = $field_id_str;
				$inserted    = true;
			}
		}

		// Source ID disappeared between `duplicate()`'s validation and
		// this re-read (race, or a meta_query filter quirk). Don't write
		// `$reordered` — that would silently drop the new ID. Caller
		// force-deletes the orphan field post.
		if ( ! $inserted ) {
			return false;
		}

		// WordPress doesn't expose an atomic multi-value meta update; the
		// sequence is delete-then-add. If a re-add fails (filter, DB
		// error), best-effort restore the previous list so the schema
		// isn't lost.
		delete_post_meta( $collection_id, 'fields' );
		foreach ( $reordered as $id ) {
			if ( false === add_post_meta( $collection_id, 'fields', $id ) ) {
				delete_post_meta( $collection_id, 'fields' );
				foreach ( $existing as $rollback_id ) {
					add_post_meta( $collection_id, 'fields', $rollback_id );
				}
				return false;
			}
		}

		return true;
	}

	private function detach_field( int $collection_id, int $field_id ): void {
		delete_post_meta( $collection_id, 'fields', (string) $field_id );
	}

	/**
	 * Returns the field IDs stored in a collection's `meta.fields`.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return array<int,string> Stringified IDs in display order.
	 */
	private function collection_field_ids( int $collection_id ): array {
		$raw = get_post_meta( $collection_id, 'fields', false );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$ids = array();
		foreach ( $raw as $id ) {
			$ids[] = (string) $id;
		}
		return $ids;
	}

	private function require_collection( int $collection_id ): WP_Post|WP_Error {
		$collection = get_post( $collection_id );
		if ( ! $collection instanceof WP_Post || Collection::POST_TYPE !== $collection->post_type ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}
		return $collection;
	}

	private function type_supports_options( string $type ): bool {
		return 'select' === $type || 'multiselect' === $type;
	}

	/**
	 * Trims and rejects empty entries; preserves order. Keeps an optional
	 * `color` when it names a palette entry, drops it otherwise.
	 *
	 * @param array<int,array<string,mixed>> $options Raw option records.
	 * @return array<int,array{value:string,label:string,color?:string}>
	 */
	private function normalize_options( array $options ): array {
		$normalized = array();
		foreach ( $options as $option ) {
			$value = isset( $option['value'] ) ? trim( (string) $option['value'] ) : '';
			$label = isset( $option['label'] ) ? trim( (string) $option['label'] ) : '';
			if ( '' === $value && '' === $label ) {
				continue;
			}
			if ( '' === $value ) {
				$value = $label;
			}
			if ( '' === $label ) {
				$label = $value;
			}
			$record = array(
				'value' => $value,
				'label' => $label,
			);
			if ( isset( $option['color'] ) ) {
				$color = trim( (string) $option['color'] );
				if ( '' !== $color && OptionPalette::is_valid( $color ) ) {
					$record['color'] = $color;
				}
			}
			$normalized[] = $record;
		}
		return $normalized;
	}
}
