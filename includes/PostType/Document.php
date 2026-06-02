<?php
/**
 * Registers the `crtxt_document` custom post type, the single CPT that holds
 * all editable Cortext content. "Page", "row", and "collection" are not
 * separate data types; they emerge from the document's state:
 *   - `cortext_fields` meta -> the document defines a schema (collection).
 *   - `crtxt_trait` term    -> the document belongs to a collection (row).
 *   - neither               -> plain page.
 *
 * Capabilities compose: a document can both define a schema and belong to a
 * parent collection. UX conventions (e.g., rows stay at the top of the page
 * tree) live in `Documents`, not in the schema.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use Cortext\Fields\FieldTypeRegistry;
use Cortext\FieldValues\FieldValueIndex;
use Cortext\Formula\Materializer as FormulaMaterializer;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;
use WP_REST_Request;

final class Document {

	public const POST_TYPE = 'crtxt_document';

	/**
	 * Relation updates prepared in `rest_pre_insert_crtxt_document` and
	 * consumed in `rest_after_insert_crtxt_document`. Keyed by [row_id][field_id].
	 *
	 * @var array<int, array<int, array<string, mixed>>>
	 */
	private static array $relation_prepared = array();

	public function register(): void {
		add_action( 'init', array( $this, 'register_post_type' ) );
		// Schema meta (`cortext_fields`, `cortext_detail_layout`) is what
		// promotes a document to a collection. Registered at priority 10 so
		// it lands before `register_field_meta` (which depends on
		// `crtxt_field` existing).
		add_action( 'init', array( $this, 'register_collection_meta' ), 10 );
		// Row field meta lives on `crtxt_document`. Register at priority 11
		// so the post type and `crtxt_field` are already in place.
		add_action( 'init', array( $this, 'register_field_meta' ), 11 );
		add_filter( 'rest_' . self::POST_TYPE . '_query', array( $this, 'apply_trait_filters' ), 10, 2 );
		add_filter( 'rest_' . self::POST_TYPE . '_collection_params', array( $this, 'expose_trait_filter_params' ) );
		// `cortext_trait` in a POST body promotes the new document to a row of
		// the given trait. Core REST has no native way to express
		// "create a document attached to this taxonomy term by post id of the
		// trait", so this filter bridges it.
		add_action( 'rest_after_insert_' . self::POST_TYPE, array( $this, 'assign_trait_from_request' ), 10, 3 );
		// Relation meta writes need pre-validation (the desired targets must be
		// valid rows of the related collection) and post-write reverse-pointer
		// sync. WP REST writes the forward meta itself between these two hooks.
		add_filter( 'rest_pre_insert_' . self::POST_TYPE, array( $this, 'prepare_meta_updates' ), 10, 2 );
		add_action( 'rest_after_insert_' . self::POST_TYPE, array( $this, 'apply_meta_updates' ), 20, 3 );
		// Defense in depth for a collection's body invariant. The block editor
		// cleans foreign data-view blocks on render; this catch ensures a
		// transient autosave that fires before the cleanup never persists.
		add_filter( 'wp_insert_post_data', array( $this, 'strip_foreign_root_data_views' ), 10, 2 );
		add_action( 'rest_api_init', array( $this, 'register_rest_fields' ) );
		// `field-<id>` meta is registered on every `crtxt_document`, so a REST
		// response would carry every collection's fields on every document.
		// Trim it to the document's own collection before it goes out.
		add_filter( 'rest_prepare_' . self::POST_TYPE, array( $this, 'limit_field_meta_to_collection' ), 10, 2 );
	}

	/**
	 * Exposes whether a document defines a trait (is a collection) as a
	 * read-only REST field, so the client can tell a collection apart from a
	 * page without reading meta. Mirrors `is_collection`: a document defines a
	 * trait when its mirror term exists.
	 */
	public function register_rest_fields(): void {
		register_rest_field(
			self::POST_TYPE,
			'cortext_defines_trait',
			array(
				'get_callback' => static function ( array $record ): bool {
					return in_array( (int) $record['id'], TraitTaxonomy::all_trait_ids(), true );
				},
				'schema'       => array(
					'type'     => 'boolean',
					'context'  => array( 'view', 'edit' ),
					'readonly' => true,
				),
			)
		);
	}

	/**
	 * Trims `field-<id>` meta in the REST response to the document's own
	 * collection. `field-<id>` is registered on every `crtxt_document`, so
	 * without this trim the response carries every collection's fields on every
	 * document. A row keeps its collection's writable fields. Rollups and
	 * formulas stay out of `meta` because they are computed and read-only,
	 * exposed in `cortext_hydrated_meta`. Pages and collections keep no field values.
	 * Schema and identity meta stay.
	 *
	 * @param \WP_REST_Response $response Prepared response.
	 * @param \WP_Post          $post     Document being prepared.
	 * @return \WP_REST_Response
	 */
	public function limit_field_meta_to_collection( $response, $post ) {
		$data = $response->get_data();
		if ( ! is_array( $data ) || ! isset( $data['meta'] ) || ! is_array( $data['meta'] ) ) {
			return $response;
		}

		$allowed    = array();
		$trait_post = ( new Documents() )->find_trait_for_document( $post );
		if ( $trait_post instanceof WP_Post ) {
			foreach ( self::collection_field_ids( (int) $trait_post->ID ) as $field_id ) {
				$field_type = (string) get_post_meta( $field_id, 'type', true );
				if ( in_array( $field_type, array( 'rollup', 'formula' ), true ) ) {
					continue;
				}
				$allowed[ 'field-' . $field_id ] = true;
			}
		}

		foreach ( array_keys( $data['meta'] ) as $key ) {
			if ( is_string( $key ) && str_starts_with( $key, 'field-' ) && ! isset( $allowed[ $key ] ) ) {
				unset( $data['meta'][ $key ] );
			}
		}

		$response->set_data( $data );
		return $response;
	}

	/**
	 * Registers the schema meta keys a `crtxt_document` collection can carry:
	 * `cortext_fields` (schema definition) and `cortext_detail_layout`
	 * (row-detail layout settings).
	 */
	public function register_collection_meta(): void {
		register_post_meta(
			self::POST_TYPE,
			'cortext_fields',
			array(
				'type'              => 'string',
				'single'            => false,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_text_field',
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'cortext_detail_layout',
			array(
				'type'              => 'object',
				'single'            => true,
				'show_in_rest'      => array(
					'schema' => array(
						'type'                 => 'object',
						'properties'           => array(
							'fields' => array(
								'type'    => 'array',
								'items'   => array(
									'type'                 => 'object',
									'properties'           => array(
										'field'   => array(
											'type' => 'string',
										),
										'visible' => array(
											'type' => 'boolean',
										),
									),
									'required'             => array( 'field', 'visible' ),
									'additionalProperties' => false,
								),
								'default' => array(),
							),
						),
						'additionalProperties' => false,
					),
				),
				'sanitize_callback' => array( self::class, 'sanitize_detail_layout' ),
				'auth_callback'     => static function ( $allowed, $meta_key, $post_id ): bool {
					return current_user_can( 'edit_post', (int) $post_id );
				},
			)
		);
	}

	/**
	 * Cleans up the saved row-detail layout for a collection document.
	 *
	 * @param mixed $value Incoming REST/meta value.
	 * @return array{fields: array<int, array{field: string, visible: bool}>}
	 */
	public static function sanitize_detail_layout( $value ): array {
		if ( is_object( $value ) ) {
			$value = (array) $value;
		}
		if ( ! is_array( $value ) ) {
			return array( 'fields' => array() );
		}
		$raw_fields = isset( $value['fields'] ) && is_array( $value['fields'] )
			? $value['fields']
			: array();
		$seen       = array();
		$fields     = array();
		foreach ( $raw_fields as $entry ) {
			if ( is_object( $entry ) ) {
				$entry = (array) $entry;
			}
			if ( ! is_array( $entry ) || ! isset( $entry['field'] ) ) {
				continue;
			}
			$field = sanitize_text_field( (string) $entry['field'] );
			if ( '' === $field || isset( $seen[ $field ] ) || ! self::is_detail_layout_field_id( $field ) ) {
				continue;
			}
			$fields[]       = array(
				'field'   => $field,
				'visible' => isset( $entry['visible'] ) ? rest_sanitize_boolean( $entry['visible'] ) : true,
			);
			$seen[ $field ] = true;
		}
		return array( 'fields' => $fields );
	}

	private static function is_detail_layout_field_id( string $field ): bool {
		if ( 1 === preg_match( '/^field-[1-9][0-9]*$/', $field ) ) {
			return true;
		}
		return in_array(
			$field,
			array( 'created_at', 'created_by', 'modified_at', 'modified_by' ),
			true
		);
	}

	/**
	 * Seeds a collection document's canvas with the locked `cortext/data-view`
	 * block when it does not yet carry its owner block. Idempotent: a document
	 * that already holds the block, or that is not a `crtxt_document`, is left
	 * untouched. An empty collection (no custom fields) still gets its block.
	 *
	 * @param int $document_id Collection document id.
	 */
	public static function seed_data_view_block( int $document_id ): void {
		$post = get_post( $document_id );
		if ( ! $post instanceof WP_Post || self::POST_TYPE !== $post->post_type ) {
			return;
		}
		if ( self::has_owner_data_view_block( (string) $post->post_content, $document_id ) ) {
			return;
		}
		wp_update_post(
			array(
				'ID'           => $document_id,
				'post_content' => $post->post_content . self::build_data_view_block_markup( $document_id ),
			)
		);
	}

	/**
	 * Whether `$post_content` already carries a `cortext/data-view` block
	 * pointing at `$document_id`. A foreign data-view does not count, so the
	 * self-referencing owner block gets seeded as expected.
	 *
	 * @param string $post_content Stored post content.
	 * @param int    $document_id  Collection document id to match against.
	 */
	public static function has_owner_data_view_block( string $post_content, int $document_id ): bool {
		if ( '' === $post_content || ! str_contains( $post_content, '<!-- wp:cortext/data-view' ) ) {
			return false;
		}
		foreach ( parse_blocks( $post_content ) as $block ) {
			if ( 'cortext/data-view' !== ( $block['blockName'] ?? '' ) ) {
				continue;
			}
			$attr_id = isset( $block['attrs']['collectionId'] )
				? (int) $block['attrs']['collectionId']
				: 0;
			if ( $attr_id === $document_id ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Serialized markup for the locked data-view block used as a collection
	 * document's body.
	 *
	 * @param int $document_id Collection document id the block points at.
	 */
	public static function build_data_view_block_markup( int $document_id ): string {
		return serialize_blocks(
			array(
				array(
					'blockName'    => 'cortext/data-view',
					'attrs'        => array(
						'collectionId' => $document_id,
						'align'        => 'full',
						'lock'         => array(
							'move'   => true,
							'remove' => true,
						),
					),
					'innerBlocks'  => array(),
					'innerHTML'    => '',
					'innerContent' => array(),
				),
			)
		);
	}

	/**
	 * Strips root-level `cortext/data-view` blocks whose `collectionId` does
	 * not match the document being saved. A collection's body is owned by its
	 * self-referencing data-view; a foreign one at the root can only arrive
	 * via stale block-editor state during a document switch.
	 *
	 * Skips pages and rows (no schema): those legitimately embed data-views
	 * pointing at any collection. Skips creates (no `ID` yet) because the
	 * self-reference cannot be evaluated until the post id exists.
	 *
	 * @param array<string,mixed> $data    Slashed post data about to be inserted.
	 * @param array<string,mixed> $postarr Original input passed to wp_insert_post.
	 * @return array<string,mixed>
	 */
	public function strip_foreign_root_data_views( array $data, array $postarr ): array {
		if ( self::POST_TYPE !== (string) ( $data['post_type'] ?? '' ) ) {
			return $data;
		}
		$post_id = (int) ( $postarr['ID'] ?? 0 );
		if ( $post_id < 1 || ! self::is_collection( $post_id ) ) {
			return $data;
		}

		$content = (string) ( $data['post_content'] ?? '' );
		if ( '' === $content || ! str_contains( $content, '<!-- wp:cortext/data-view' ) ) {
			return $data;
		}

		$blocks   = parse_blocks( wp_unslash( $content ) );
		$filtered = self::drop_foreign_root_data_views( $blocks, $post_id );
		if ( count( $filtered ) === count( $blocks ) ) {
			return $data;
		}

		$data['post_content'] = wp_slash( serialize_blocks( $filtered ) );
		return $data;
	}

	/**
	 * Drops root-level `cortext/data-view` blocks whose `collectionId` differs
	 * from `$post_id`. Public so tests can exercise the rule directly.
	 *
	 * @param array<int,array<string,mixed>> $blocks  Parsed root-level blocks.
	 * @param int                            $post_id Collection document id.
	 * @return array<int,array<string,mixed>>
	 */
	public static function drop_foreign_root_data_views( array $blocks, int $post_id ): array {
		$filtered = array();
		foreach ( $blocks as $block ) {
			if ( 'cortext/data-view' === ( $block['blockName'] ?? null ) ) {
				$collection_id = (int) ( $block['attrs']['collectionId'] ?? 0 );
				if ( $collection_id !== $post_id ) {
					continue;
				}
			}
			$filtered[] = $block;
		}
		return $filtered;
	}

	/**
	 * Returns true when the document is a collection.
	 *
	 * A document is a collection when it defines a trait, that is when its
	 * mirror term (slug = document id) exists. Identity lives in the term, not
	 * in a meta marker, so a collection with no custom fields still reads as a
	 * collection. `term_id_for_trait` resolves the term.
	 *
	 * @param int $document_id Document post id.
	 */
	public static function is_collection( int $document_id ): bool {
		return TraitTaxonomy::term_id_for_trait( $document_id ) > 0;
	}

	/**
	 * Convenience: post is a collection document. Combines the post type
	 * and meta check.
	 *
	 * @param \WP_Post $post Post to check.
	 */
	public static function is_collection_post( \WP_Post $post ): bool {
		return self::POST_TYPE === $post->post_type
			&& self::is_collection( (int) $post->ID );
	}

	/**
	 * Returns the field ids (`crtxt_field` post ids) that make up a
	 * collection's schema. Empty array for non-collection documents.
	 *
	 * @param int $document_id Document post id.
	 * @return int[]
	 */
	public static function collection_field_ids( int $document_id ): array {
		$values = get_post_meta( $document_id, 'cortext_fields', false );
		if ( ! is_array( $values ) ) {
			return array();
		}
		return array_values(
			array_filter(
				array_map( 'intval', $values ),
				static fn( int $id ): bool => $id > 0
			)
		);
	}

	/**
	 * Reads `cortext_trait` from the REST request body. Used by both the
	 * REST insert hook (to assign the term after a create) and the schema
	 * description so the param is discoverable.
	 *
	 * @param \WP_Post         $post     Inserted document.
	 * @param \WP_REST_Request $request  REST request.
	 * @param bool             $creating Whether this is a create or update.
	 */
	public function assign_trait_from_request( \WP_Post $post, \WP_REST_Request $request, bool $creating ): void {
		unset( $creating ); // The caller may pass an update; assigning is idempotent either way.

		// `cortext_collection` designates this document a collection: create its
		// mirror term even with zero custom fields (a brand-new collection only
		// has the implicit title). The term is the collection's identity.
		if ( $request->get_param( 'cortext_collection' ) ) {
			( new TraitTaxonomy() )->ensure_mirror_term( (int) $post->ID );
		}

		$trait_id = (int) $request->get_param( 'cortext_trait' );
		if ( $trait_id < 1 ) {
			return;
		}
		$term_id = TraitTaxonomy::term_id_for_trait( $trait_id );
		if ( $term_id < 1 ) {
			return;
		}
		wp_set_object_terms( (int) $post->ID, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
	}

	/**
	 * Registers `field-<id>` post meta on `crtxt_document` for every defined
	 * field so REST writes through `/wp/v2/crtxt_documents/{id}` accept it.
	 * One pass against the single document type, regardless of which
	 * collections own which fields.
	 */
	public function register_field_meta(): void {
		$field_ids = get_posts(
			array(
				'post_type'      => Field::POST_TYPE,
				'post_status'    => array( 'draft', 'private', 'publish' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);
		// Prime every field's meta in one query so the per-field reads below are
		// cache hits. This runs on `init` for every request, so without priming
		// it costs one query per field and the per-request cost grows with the
		// workspace.
		update_meta_cache( 'post', $field_ids );
		foreach ( $field_ids as $field_id ) {
			$type     = (string) get_post_meta( (int) $field_id, 'type', true );
			$wp_meta  = FieldTypeRegistry::exists( $type )
				? FieldTypeRegistry::wp_meta_type_for_field( (int) $field_id, $type )
				: 'string';
			$is_multi = in_array( $type, array( 'multiselect', 'relation' ), true );
			// Relation values are row IDs. Storing them as numeric strings in
			// postmeta is fine (WP normalises scalars to strings on write),
			// but the REST schema should declare integer so the API accepts
			// numeric arrays directly without coercion gymnastics in the
			// client.
			if ( 'relation' === $type ) {
				$wp_meta = 'integer';
			}
			$config = array(
				'type'         => $wp_meta,
				'single'       => ! $is_multi,
				'show_in_rest' => 'formula' !== $type,
			);
			if ( 'string' === $wp_meta ) {
				$config['sanitize_callback'] = 'sanitize_text_field';
			}
			register_post_meta( self::POST_TYPE, 'field-' . (int) $field_id, $config );
		}
	}

	/**
	 * Returns a `WP_Error` when `$meta` carries `field-<id>` keys for fields
	 * that do not belong to the document's collection, otherwise null. Page
	 * documents (no trait) and collection documents (no parent collection)
	 * reject any field meta; rows only accept meta for fields attached to
	 * their collection.
	 *
	 * @param int                 $post_id Document id being updated.
	 * @param array<string,mixed> $meta    Meta payload from the REST request.
	 */
	private function reject_foreign_field_meta( int $post_id, array $meta ): ?WP_Error {
		$field_keys = array();
		foreach ( $meta as $key => $_ ) {
			if ( ! is_string( $key ) || ! str_starts_with( $key, 'field-' ) ) {
				continue;
			}
			$field_id = (int) substr( $key, 6 );
			if ( $field_id > 0 ) {
				$field_keys[ $field_id ] = $key;
			}
		}
		if ( count( $field_keys ) === 0 ) {
			return null;
		}

		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post || self::POST_TYPE !== $post->post_type ) {
			return new WP_Error(
				'cortext_field_not_in_collection',
				__( 'Field meta is only accepted on document rows.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$trait_post = ( new Documents() )->find_trait_for_document( $post );
		$allowed    = $trait_post instanceof WP_Post
			? array_flip( self::collection_field_ids( (int) $trait_post->ID ) )
			: array();

		foreach ( $field_keys as $field_id => $key ) {
			if ( ! isset( $allowed[ $field_id ] ) ) {
				return new WP_Error(
					'cortext_field_not_in_collection',
					/* translators: %s: meta key being rejected. */
					sprintf( __( 'Field meta "%s" does not belong to this row\'s collection.', 'cortext' ), $key ),
					array(
						'status' => 400,
						'key'    => $key,
					)
				);
			}
		}

		return null;
	}

	/**
	 * Validates a `meta` payload arriving via core REST before WP writes any
	 * of it. For each `field-<id>` that is a relation field, this stashes the
	 * prepared update (validation result + current values) so the after-insert
	 * hook can sync reverse pointers without re-doing the work.
	 *
	 * Returns the original `$prepared_post` on success, or a `WP_Error` to
	 * abort the request when a relation value is invalid.
	 *
	 * @param \stdClass|WP_Error $prepared_post Prepared post (or earlier error).
	 * @param WP_REST_Request    $request       REST request.
	 * @return \stdClass|WP_Error
	 */
	public function prepare_meta_updates( $prepared_post, WP_REST_Request $request ) {
		if ( $prepared_post instanceof WP_Error ) {
			return $prepared_post;
		}
		$meta = $request->get_param( 'meta' );
		if ( ! is_array( $meta ) || count( $meta ) === 0 ) {
			return $prepared_post;
		}
		// Rollups and formulas are computed and read-only, exposed in
		// `cortext_hydrated_meta`. Drop any computed `field-<id>` from the
		// write, so a stray one (stale client, hand-built request) is ignored
		// instead of failing the whole save.
		foreach ( $meta as $key => $_value ) {
			if ( ! is_string( $key ) || ! str_starts_with( $key, 'field-' ) ) {
				continue;
			}
			$field_id   = (int) substr( $key, 6 );
			$field_type = $field_id > 0 ? (string) get_post_meta( $field_id, 'type', true ) : '';
			if ( in_array( $field_type, array( 'rollup', 'formula' ), true ) ) {
				unset( $meta[ $key ] );
			}
		}
		$request->set_param( 'meta', $meta );
		if ( count( $meta ) === 0 ) {
			return $prepared_post;
		}

		$post_id = (int) ( $prepared_post->ID ?? 0 );
		if ( $post_id < 1 ) {
			$post_id = (int) $request->get_param( 'id' );
		}
		if ( $post_id < 1 ) {
			// Creating a row: the post id does not exist yet, so relation
			// targets cannot be validated and their reverse pointers cannot be
			// synced here. `apply_meta_updates` does both after core REST
			// inserts the row and its trait is assigned.
			return $prepared_post;
		}

		// `field-<id>` post meta is registered globally on `crtxt_document`,
		// so without an extra check WP REST will accept writes for any field
		// id on any row. Reject keys whose field does not belong to this
		// row's collection before the meta touches the wire.
		$reject = $this->reject_foreign_field_meta( $post_id, $meta );
		if ( $reject instanceof WP_Error ) {
			return $reject;
		}

		$relation_keys_consumed = array();
		foreach ( $meta as $key => $value ) {
			if ( ! is_string( $key ) || ! str_starts_with( $key, 'field-' ) ) {
				continue;
			}
			$field_id = (int) substr( $key, 6 );
			if ( $field_id < 1 ) {
				continue;
			}
			$field_type = (string) get_post_meta( $field_id, 'type', true );
			if ( 'relation' !== $field_type ) {
				continue;
			}
			$prep = Relations::prepare_relation_update( $post_id, $field_id, $value );
			if ( $prep instanceof WP_Error ) {
				return $prep;
			}
			self::$relation_prepared[ $post_id ][ $field_id ] = $prep;
			// Write the forward meta ourselves. WP REST's
			// `update_multi_meta_value` would otherwise run an O(N*M) diff
			// (each pair through `sanitize_meta`), which dominates the
			// request (~18s for a 250-target update). The values were
			// already validated in `prepare_relation_update`.
			Relations::fast_write_forward_meta( $post_id, $field_id, $prep['current'], $prep['desired'] );
			$relation_keys_consumed[] = $key;
		}
		if ( count( $relation_keys_consumed ) > 0 ) {
			foreach ( $relation_keys_consumed as $key ) {
				unset( $meta[ $key ] );
			}
			$request->set_param( 'meta', $meta );
		}
		return $prepared_post;
	}

	/**
	 * After WP REST has written the meta, applies relation reverse pointers
	 * and re-indexes the sidecar so the field-value cache stays in sync.
	 *
	 * @param WP_Post         $post     Inserted document.
	 * @param WP_REST_Request $request  REST request.
	 * @param bool            $creating Whether this is a create or update.
	 */
	public function apply_meta_updates( WP_Post $post, WP_REST_Request $request, bool $creating ): void {
		$row_id = (int) $post->ID;

		$relation_field_ids = array();
		if ( isset( self::$relation_prepared[ $row_id ] ) ) {
			foreach ( self::$relation_prepared[ $row_id ] as $field_id => $prepared ) {
				Relations::apply_relation_pointers( $row_id, (int) $field_id, $prepared );
				$relation_field_ids[] = (int) $field_id;
			}
			unset( self::$relation_prepared[ $row_id ] );
		}

		$meta     = $request->get_param( 'meta' );
		$has_meta = is_array( $meta ) && count( $meta ) > 0;
		$trait    = ( new Documents() )->find_trait_for_document( $post );
		if ( ! $trait instanceof WP_Post ) {
			return;
		}
		$collection_id = (int) $trait->ID;
		$index         = new FieldValueIndex();

		// On create, `prepare_meta_updates` ran before the row's id existed, so
		// relation fields were written by core REST without their reverse
		// pointers, and core's forward write leaves a later re-sync seeing no
		// diff. Clear each relation field and let `sync_relation_value` rebuild
		// the forward and reverse pointers from an empty set now that the row
		// and its trait exist.
		if ( $creating && $has_meta ) {
			foreach ( $meta as $key => $value ) {
				if ( ! is_string( $key ) || ! str_starts_with( $key, 'field-' ) ) {
					continue;
				}
				$relation_field_id = (int) substr( $key, 6 );
				if ( $relation_field_id < 1 || 'relation' !== (string) get_post_meta( $relation_field_id, 'type', true ) ) {
					continue;
				}
				delete_post_meta( $row_id, Relations::meta_key( $relation_field_id ) );
				Relations::sync_relation_value( $row_id, $relation_field_id, $value );
			}
		}

		// Forward index for non-relation meta written by WP REST.
		if ( $has_meta ) {
			foreach ( $meta as $key => $_ ) {
				if ( ! is_string( $key ) || ! str_starts_with( $key, 'field-' ) ) {
					continue;
				}
				$field_id = (int) substr( $key, 6 );
				if ( $field_id < 1 ) {
					continue;
				}
				$field_type = (string) get_post_meta( $field_id, 'type', true );
				if ( '' === $field_type || in_array( $field_type, array( 'rollup', 'formula' ), true ) ) {
					continue;
				}
				$index->index_row_field( $row_id, $field_id, $collection_id );
			}
		}

		// `prepare_meta_updates` consumes relation keys from `$meta` before
		// the WP REST loop, so the iteration above never sees them. Re-index
		// the source row's forward field here so `query_relation_contains_ids`
		// doesn't return stale results after a relation update.
		foreach ( $relation_field_ids as $field_id ) {
			$index->index_row_field( $row_id, $field_id, $collection_id );
		}

		FormulaMaterializer::recompute_row( $collection_id, $row_id );
		foreach ( self::collection_field_ids( $collection_id ) as $field_id ) {
			if ( 'formula' === (string) get_post_meta( $field_id, 'type', true ) ) {
				$index->index_row_field( $row_id, $field_id, $collection_id );
			}
		}
	}

	/**
	 * Adds support for filtering documents by trait membership via the standard
	 * WP REST endpoint. The React shell uses these to list pages
	 * (documents without trait) and rows (documents with a specific trait) via
	 * `useEntityRecords( 'postType', 'crtxt_document', ... )`.
	 *
	 * @param array<string,mixed> $args    Query args being built for the REST request.
	 * @param \WP_REST_Request    $request REST request.
	 * @return array<string,mixed>
	 */
	public function apply_trait_filters( array $args, \WP_REST_Request $request ): array {
		$no_trait       = $request->get_param( 'cortext_no_trait' );
		$with_trait     = $request->get_param( 'cortext_trait' );
		$collections    = $request->get_param( 'cortext_collections' );
		$no_collections = $request->get_param( 'cortext_no_collections' );

		$tax_query = $args['tax_query'] ?? array();

		if ( null !== $no_trait && '' !== (string) $no_trait && '0' !== (string) $no_trait ) {
			$tax_query[] = array(
				'taxonomy' => TraitTaxonomy::TAXONOMY,
				'operator' => 'NOT EXISTS',
			);
		}
		if ( null !== $with_trait && '' !== (string) $with_trait ) {
			$term_id = TraitTaxonomy::term_id_for_trait( (int) $with_trait );
			if ( $term_id > 0 ) {
				$tax_query[] = array(
					'taxonomy' => TraitTaxonomy::TAXONOMY,
					'field'    => 'term_id',
					'terms'    => array( $term_id ),
				);
			}
		}
		if ( null !== $collections && '' !== (string) $collections && '0' !== (string) $collections ) {
			// A document is a collection when its mirror term exists, so the
			// set of collection ids is the trait term slugs. Restrict to them
			// by id. An empty `post__in` in WP_Query matches everything, so
			// stand in `array( 0 )` when there are no collections to force an
			// empty result.
			$ids              = TraitTaxonomy::all_trait_ids();
			$args['post__in'] = array() === $ids ? array( 0 ) : $ids;
		}
		// `cortext_no_trait` only excludes rows. Screens that list pages on
		// their own (the trash list and the published-documents screen) also
		// exclude collections, since a collection is not a page. The sidebar
		// document tree does not use this filter: it keeps collections and shows
		// them nested. A collection is identified by its mirror term, so an
		// empty collection (only the title, no custom fields) is still excluded
		// here.
		if ( null !== $no_collections && '' !== (string) $no_collections && '0' !== (string) $no_collections ) {
			$ids = TraitTaxonomy::all_trait_ids();
			if ( array() !== $ids ) {
				$args['post__not_in'] = array_merge( $args['post__not_in'] ?? array(), $ids );
			}
		}

		if ( count( $tax_query ) > 0 ) {
			$args['tax_query'] = $tax_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
		}
		return $args;
	}

	/**
	 * Declares the trait filter params so REST schema introspection lists them.
	 *
	 * @param array<string,array<string,mixed>> $params Collection params.
	 * @return array<string,array<string,mixed>>
	 */
	public function expose_trait_filter_params( array $params ): array {
		$params['cortext_no_trait']       = array(
			'description' => __( 'Limit to documents without a trait (excludes rows).', 'cortext' ),
			'type'        => 'boolean',
		);
		$params['cortext_no_collections'] = array(
			'description' => __( 'Limit to documents without a schema (excludes collections).', 'cortext' ),
			'type'        => 'boolean',
		);
		$params['cortext_trait']          = array(
			'description' => __( 'Limit to documents that are rows of the given trait post ID.', 'cortext' ),
			'type'        => 'integer',
		);
		$params['cortext_collections']    = array(
			'description' => __( 'Limit to documents that define a schema (collections).', 'cortext' ),
			'type'        => 'boolean',
		);
		return $params;
	}

	public function register_post_type(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'                => array(
					'name'          => __( 'Cortext Documents', 'cortext' ),
					'singular_name' => __( 'Cortext Document', 'cortext' ),
					'menu_name'     => __( 'Cortext Documents', 'cortext' ),
					'add_new_item'  => __( 'Add New Cortext Document', 'cortext' ),
					'edit_item'     => __( 'Edit Cortext Document', 'cortext' ),
					'new_item'      => __( 'New Cortext Document', 'cortext' ),
					'view_item'     => __( 'View Cortext Document', 'cortext' ),
					'search_items'  => __( 'Search Cortext Documents', 'cortext' ),
					'all_items'     => __( 'All Cortext Documents', 'cortext' ),
				),
				'public'                => false,
				'publicly_queryable'    => true,
				'exclude_from_search'   => true,
				'rewrite'               => array(
					'slug'       => 'cortext',
					'with_front' => false,
				),
				// Documents are edited in the React shell. REST stays on for the
				// shell, but the core list table and post.php editor stay hidden.
				'show_ui'               => false,
				'show_in_menu'          => false,
				'show_in_rest'          => true,
				'rest_base'             => 'crtxt_documents',
				'rest_controller_class' => 'WP_REST_Posts_Controller',
				'has_archive'           => false,
				// `post_parent` carries the workspace-tree hierarchy. Any
				// document can hang under any other; the tree is content,
				// not type.
				'hierarchical'          => true,
				'supports'              => array(
					'title',
					'editor',
					// Load-bearing: RevisionThrottle's filters only fire on post types that support revisions. Do not remove.
					'revisions',
					'page-attributes',
					// `meta` only appears in the REST schema when a CPT supports
					// custom-fields. The page hierarchy cascade's marker meta
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
