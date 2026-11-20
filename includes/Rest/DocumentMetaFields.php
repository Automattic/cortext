<?php
/**
 * REST meta fields for `crtxt_document`, read per document.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\PostType\Document;
use WP_Post;
use WP_REST_Post_Meta_Fields;

/**
 * Every field registers a `field-<id>` key on `crtxt_document`, so core would
 * read every field in the workspace for every document. Reads here cover only
 * the document's own keys: every non-field key plus the writable fields of the
 * row's collection. The schema and writes keep the full registry: core-data
 * reads `schema.properties.meta.properties` to learn the registered keys, and a
 * new row has no collection yet when core writes its meta.
 */
final class DocumentMetaFields extends WP_REST_Post_Meta_Fields {

	/**
	 * Raw registry arrays the built fields came from. Comparing with `===` is
	 * cheap while nobody registers or unregisters meta, because both sides
	 * still share one array.
	 *
	 * @var array<int, array<string, mixed>>|null
	 */
	private ?array $source = null;

	/**
	 * Fields as core builds them, keyed by meta key, in registry order.
	 *
	 * @var array<string, array<string, mixed>>
	 */
	private array $fields = array();

	/**
	 * Fields that are not `field-<id>` keys, in registry order.
	 *
	 * @var array<string, array<string, mixed>>
	 */
	private array $base_fields = array();

	/**
	 * Registry position of each meta key, to keep core's key order. Numeric
	 * meta keys become integer array keys, hence the untyped sort callback.
	 *
	 * @var array<string|int, int>
	 */
	private array $positions = array();

	/**
	 * Fields `get_registered_fields()` returns while `get_value()` runs.
	 *
	 * @var array<string, array<string, mixed>>|null
	 */
	private ?array $scope = null;

	/**
	 * Reads the meta of one document with core's loop over that document's keys.
	 *
	 * @param int              $object_id Document id.
	 * @param \WP_REST_Request $request   Current request.
	 * @return array<string, mixed>
	 */
	public function get_value( $object_id, $request ) {
		$this->scope = $this->fields_for( get_post( (int) $object_id ) );
		try {
			return parent::get_value( $object_id, $request );
		} finally {
			$this->scope = null;
		}
	}

	/**
	 * Returns the scoped fields during `get_value()`, the full registry otherwise.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	protected function get_registered_fields() {
		if ( null !== $this->scope ) {
			return $this->scope;
		}
		$this->refresh();
		return $this->fields;
	}

	/**
	 * Non-field keys plus the document's own `field-<id>` keys, in registry order.
	 *
	 * @param WP_Post $post Document.
	 * @return array<string, array<string, mixed>>
	 */
	private function fields_for( WP_Post $post ): array {
		$this->refresh();

		$own = array();
		foreach ( Document::rest_field_meta_keys( $post ) as $key ) {
			if ( isset( $this->fields[ $key ] ) ) {
				$own[ $key ] = $this->fields[ $key ];
			}
		}
		if ( array() === $own ) {
			return $this->base_fields;
		}

		$fields = $this->base_fields + $own;
		uksort( $fields, fn( $a, $b ): int => $this->positions[ $a ] <=> $this->positions[ $b ] );
		return $fields;
	}

	/**
	 * Rebuilds the fields when the meta registry changed since the last build.
	 */
	private function refresh(): void {
		$source = array(
			get_registered_meta_keys( $this->get_meta_type() ),
			get_registered_meta_keys( $this->get_meta_type(), $this->get_meta_subtype() ),
		);
		if ( $source === $this->source ) {
			return;
		}

		$this->source      = $source;
		$this->fields      = parent::get_registered_fields();
		$this->base_fields = array();
		$this->positions   = array();
		$position          = 0;
		foreach ( $this->fields as $key => $args ) {
			$this->positions[ $key ] = $position++;
			if ( ! str_starts_with( (string) $key, 'field-' ) ) {
				$this->base_fields[ $key ] = $args;
			}
		}
	}
}
