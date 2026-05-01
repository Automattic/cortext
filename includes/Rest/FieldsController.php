<?php
/**
 * REST endpoints for creating and duplicating Cortext fields.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
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
						'collection_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'title'         => array(
							'type'     => 'string',
							'required' => true,
						),
						'type'          => array(
							'type'     => 'string',
							'required' => true,
							'enum'     => self::ALLOWED_TYPES,
						),
						'options'       => array(
							'type'     => 'array',
							'required' => false,
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'value' => array( 'type' => 'string' ),
									'label' => array( 'type' => 'string' ),
								),
							),
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
		$copy_title = trim( sprintf( __( 'Copy of %s', 'cortext' ), $source->post_title ) );

		$meta = array();
		foreach ( array( 'type', 'options', 'number_format', 'expression' ) as $key ) {
			$value = get_post_meta( $field_id, $key, true );
			if ( '' !== $value && null !== $value ) {
				$meta[ $key ] = (string) $value;
			}
		}

		return $this->insert_and_attach( $collection_id, $copy_title, $meta, (string) $field_id );
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

		$field = get_post( (int) $field_id );

		return new WP_REST_Response(
			array(
				'id'    => (int) $field_id,
				'title' => $field instanceof WP_Post ? $field->post_title : $title,
				'type'  => isset( $meta['type'] ) ? $meta['type'] : '',
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
		foreach ( $existing as $id ) {
			$reordered[] = $id;
			if ( $id === $insert_after_id ) {
				$reordered[] = $field_id_str;
			}
		}

		// Replace the multi-value meta in one shot to preserve order.
		delete_post_meta( $collection_id, 'fields' );
		foreach ( $reordered as $id ) {
			add_post_meta( $collection_id, 'fields', $id );
		}

		return true;
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
	 * Trims and rejects empty entries; preserves order.
	 *
	 * @param array<int,array<string,mixed>> $options Raw option records.
	 * @return array<int,array{value:string,label:string}>
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
			$normalized[] = array(
				'value' => $value,
				'label' => $label,
			);
		}
		return $normalized;
	}
}
