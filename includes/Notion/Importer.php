<?php
/**
 * Server-side Notion → Cortext importer.
 *
 * Lives in two halves the controller drives separately:
 *   - `create_collection`: takes a Notion data-source payload and creates
 *     the Cortext collection document + per-property fields, then designates
 *     the document a collection (its mirror trait term), and stores Notion
 *     UUIDs in postmeta as breadcrumbs for v2 work.
 *   - `import_rows`: takes a batch of Notion `/query` results and inserts
 *     them as row documents tagged with the collection's trait term, with
 *     their property values mapped to `field-<id>` postmeta.
 *
 * Everything is a `crtxt_document`: a collection is a document designated by
 * its mirror term in the `crtxt_trait` taxonomy (its schema lives in
 * `cortext_fields`), and a row is a document tagged with that term (its values
 * live in `field-<id>` meta). Creation routes through `Documents::save` and
 * `Field::save` so the importer never reimplements the document/field write
 * paths.
 *
 * Field mapping is intentionally conservative — relations, rollups,
 * people, files etc. are skipped at v1. Breadcrumbs on the collection
 * (data-source id) and on each field (Notion property id + original
 * Notion type) let a future pass enrich the schema without a re-import.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Notion;

use Cortext\Documents;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use WP_Error;

final class Importer {

	public const META_COLLECTION_DS_ID    = 'cortext_notion_data_source_id';
	public const META_COLLECTION_DB_ID    = 'cortext_notion_parent_database_id';
	public const META_COLLECTION_IMPORTED = 'cortext_notion_imported_at';
	public const META_FIELD_PROPERTY_ID   = 'cortext_notion_property_id';
	public const META_FIELD_NOTION_TYPE   = 'cortext_notion_type';
	public const META_ROW_PAGE_ID         = 'cortext_notion_page_id';

	/**
	 * Hook breadcrumb meta keys onto `init` so they're visible via REST. All
	 * three subjects (collection, field, row) live on static post types now,
	 * so every key registers here.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_breadcrumb_meta' ) );
	}

	/**
	 * Register the breadcrumb meta keys so REST consumers can read them.
	 * Collection and row breadcrumbs both live on `crtxt_document`; field
	 * breadcrumbs live on `crtxt_field`.
	 */
	public function register_breadcrumb_meta(): void {
		foreach (
			array(
				self::META_COLLECTION_DS_ID,
				self::META_COLLECTION_DB_ID,
				self::META_COLLECTION_IMPORTED,
				self::META_ROW_PAGE_ID,
			) as $key
		) {
			register_post_meta(
				Document::POST_TYPE,
				$key,
				array(
					'type'         => 'string',
					'single'       => true,
					'show_in_rest' => true,
				)
			);
		}

		foreach (
			array(
				self::META_FIELD_PROPERTY_ID,
				self::META_FIELD_NOTION_TYPE,
			) as $key
		) {
			register_post_meta(
				Field::POST_TYPE,
				$key,
				array(
					'type'         => 'string',
					'single'       => true,
					'show_in_rest' => true,
				)
			);
		}
	}

	/**
	 * Build a Cortext collection from a Notion data-source object.
	 *
	 * Creates the document, its per-property fields, then designates it a
	 * collection by attaching the field schema (which seeds the mirror trait
	 * term and the locked data-view body).
	 *
	 * @param array $data_source The full `/data_sources/{id}` payload.
	 * @return int|WP_Error      Collection document ID or error.
	 */
	public function create_collection( array $data_source ) {
		$title     = $this->data_source_title( $data_source );
		$documents = new Documents();

		$collection_id = $documents->save(
			array(
				'title'  => $title,
				'status' => 'private',
				'meta'   => array(
					self::META_COLLECTION_DS_ID    => (string) ( $data_source['id'] ?? '' ),
					self::META_COLLECTION_DB_ID    => (string) ( $data_source['parent']['database_id'] ?? '' ),
					self::META_COLLECTION_IMPORTED => gmdate( 'c' ),
				),
			)
		);

		if ( $collection_id instanceof WP_Error ) {
			return $collection_id;
		}

		// Per-property field creation. Order matches the source payload,
		// which Notion documents as schema-creation order.
		$field_ids = array();
		foreach ( ( $data_source['properties'] ?? array() ) as $name => $prop ) {
			if ( ! is_array( $prop ) ) {
				continue;
			}
			$field_id = $this->create_field( (string) $name, $prop );
			if ( $field_id instanceof WP_Error ) {
				// FIXME: This needs better handling. Any previously created
				// fields need to be cleaned up too.
				wp_delete_post( (int) $collection_id, true );
				return $field_id;
			}
			if ( $field_id > 0 ) {
				$field_ids[] = $field_id;
			}
		}

		// Designate the document a collection. Passing `fields` (even an empty
		// list) creates the mirror trait term and seeds the data-view body;
		// with fields it also writes the `cortext_fields` schema.
		$designated = $documents->save(
			array(
				'id'     => (int) $collection_id,
				'fields' => $field_ids,
			)
		);
		if ( $designated instanceof WP_Error ) {
			wp_delete_post( (int) $collection_id, true );
			return $designated;
		}

		return (int) $collection_id;
	}

	/**
	 * Insert a batch of Notion rows into a Cortext collection.
	 *
	 * @param int   $collection_id Cortext collection document ID.
	 * @param array $raw_rows      Notion `/query` results (page objects).
	 * @return int                 Number of rows successfully inserted.
	 */
	public function import_rows( int $collection_id, array $raw_rows ): int {
		if ( ! Document::is_collection( $collection_id ) ) {
			return 0;
		}

		$documents = new Documents();
		$field_map = $this->build_field_map( $collection_id );

		$count = 0;
		foreach ( $raw_rows as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			$title   = $this->row_title( $row );
			$page_id = (string) ( $row['id'] ?? '' );

			// Single-valued cell meta rides along on the row create through
			// `meta`; multiselect needs one meta row per value, so collect
			// those and write them after the document exists.
			$single_meta  = array( self::META_ROW_PAGE_ID => $page_id );
			$multi_values = array();
			foreach ( ( $row['properties'] ?? array() ) as $prop ) {
				if ( ! is_array( $prop ) ) {
					continue;
				}
				$prop_id = $this->decode_property_id( (string) ( $prop['id'] ?? '' ) );
				if ( '' === $prop_id || ! isset( $field_map[ $prop_id ] ) ) {
					continue;
				}
				$mapping = $field_map[ $prop_id ];
				$value   = $this->cell_value( $prop, $mapping['type'] );
				$key     = "field-{$mapping['id']}";

				if ( 'multiselect' === $mapping['type'] ) {
					$multi_values[ $key ] = is_array( $value ) ? $value : array();
					continue;
				}
				if ( null === $value || '' === $value ) {
					continue;
				}
				$single_meta[ $key ] = $value;
			}

			$row_id = $documents->save(
				array(
					'title'  => $title,
					'status' => 'private',
					'trait'  => $collection_id,
					'meta'   => $single_meta,
				)
			);

			if ( $row_id instanceof WP_Error || $row_id < 1 ) {
				continue;
			}

			foreach ( $multi_values as $key => $items ) {
				delete_post_meta( (int) $row_id, $key );
				foreach ( $items as $item ) {
					if ( null !== $item && '' !== $item ) {
						add_post_meta( (int) $row_id, $key, (string) $item );
					}
				}
			}

			++$count;
		}

		return $count;
	}

	// ---------------------------------------------------------------
	// Schema mapping
	// ---------------------------------------------------------------

	/**
	 * Cortext type for a Notion property type, or null when we skip the
	 * field entirely at v1. `title` returns null because Notion's title
	 * becomes the row's `post_title`, not a separate Cortext field.
	 *
	 * @param string $notion_type One of Notion's property types.
	 */
	private function cortext_type_for( string $notion_type ): ?string {
		switch ( $notion_type ) {
			case 'rich_text':
				return 'text';
			case 'number':
				return 'number';
			case 'select':
			case 'status':
				return 'select';
			case 'multi_select':
				return 'multiselect';
			case 'date':
				return 'date';
			case 'checkbox':
				return 'checkbox';
			case 'url':
				return 'url';
			case 'email':
				return 'email';
			case 'phone_number':
				return 'text';
			case 'formula':
				return 'text';
			default:
				return null;
		}
	}

	/**
	 * Create one Cortext field for a Notion property. Returns the field id,
	 * 0 for clean skips (title, unsupported type), or a WP_Error only on an
	 * actual save failure. The caller attaches the returned id to the
	 * collection schema.
	 *
	 * @param string $name Property display name.
	 * @param array  $prop Notion property schema.
	 * @return int|WP_Error Field id, 0 on skip, WP_Error on hard failure.
	 */
	private function create_field( string $name, array $prop ) {
		$notion_type = (string) ( $prop['type'] ?? '' );
		if ( '' === $notion_type || 'title' === $notion_type ) {
			return 0;
		}

		$cortext_type = $this->cortext_type_for( $notion_type );
		if ( null === $cortext_type ) {
			return 0;
		}

		$payload = array(
			'title'  => $name,
			'status' => 'private',
			'type'   => $cortext_type,
			'meta'   => array(
				self::META_FIELD_PROPERTY_ID => $this->decode_property_id( (string) ( $prop['id'] ?? '' ) ),
				self::META_FIELD_NOTION_TYPE => $notion_type,
			),
		);

		// Type-specific extras.
		if ( 'select' === $cortext_type ) {
			$source             = 'status' === $notion_type ? ( $prop['status'] ?? array() ) : ( $prop['select'] ?? array() );
			$payload['options'] = $this->map_options( (array) ( $source['options'] ?? array() ) );
		} elseif ( 'multiselect' === $cortext_type ) {
			$payload['options'] = $this->map_options( (array) ( $prop['multi_select']['options'] ?? array() ) );
		} elseif ( 'number' === $cortext_type ) {
			$format                   = (string) ( $prop['number']['format'] ?? 'number' );
			$payload['number_format'] = (string) wp_json_encode( array( 'format' => $format ) );
		}

		$field_id = Field::save( $payload );
		if ( $field_id instanceof WP_Error ) {
			return $field_id;
		}

		return (int) $field_id;
	}

	/**
	 * Map Notion `select` / `multi_select` / `status` options to the
	 * Cortext `[{value, label, color}]` shape. Notion colors carry
	 * through verbatim — palette names like `red`, `blue`, etc. line up
	 * close enough with Cortext's option colors for the prototype.
	 *
	 * @param array $notion_options Notion option records.
	 */
	private function map_options( array $notion_options ): array {
		$out = array();
		foreach ( $notion_options as $opt ) {
			if ( ! is_array( $opt ) ) {
				continue;
			}
			$name = (string) ( $opt['name'] ?? '' );
			if ( '' === $name ) {
				continue;
			}
			$out[] = array(
				'value'                    => $name,
				'label'                    => $name,
				'color'                    => (string) ( $opt['color'] ?? 'default' ),
				'cortext_notion_option_id' => (string) ( $opt['id'] ?? '' ),
			);
		}
		return $out;
	}

	// ---------------------------------------------------------------
	// Row writes
	// ---------------------------------------------------------------

	/**
	 * Build a `decoded_property_id => { id: field_post_id, type }` map
	 * from a collection's attached field posts.
	 *
	 * @param int $collection_id Collection document ID.
	 * @return array<string,array{id:int,type:string}>
	 */
	private function build_field_map( int $collection_id ): array {
		$map = array();
		foreach ( Document::collection_field_ids( $collection_id ) as $field_id ) {
			$prop_id = (string) get_post_meta( $field_id, self::META_FIELD_PROPERTY_ID, true );
			if ( '' === $prop_id ) {
				continue;
			}
			$type = (string) get_post_meta( $field_id, 'type', true );
			if ( '' === $type ) {
				continue;
			}
			$map[ $prop_id ] = array(
				'id'   => $field_id,
				'type' => $type,
			);
		}
		return $map;
	}

	/**
	 * Convert a Notion property payload to its Cortext-shaped value.
	 * Mirrors `cellValue` in `src/components/notionImport.js` so the
	 * server writes the same shapes the client renders.
	 *
	 * @param array  $prop         Notion property object on a row.
	 * @param string $cortext_type Target Cortext field type.
	 * @return mixed
	 */
	private function cell_value( array $prop, string $cortext_type ) {
		$type = (string) ( $prop['type'] ?? '' );

		switch ( $type ) {
			case 'rich_text':
				return $this->plain_text( $prop['rich_text'] ?? array() );
			case 'number':
				return isset( $prop['number'] ) && is_numeric( $prop['number'] )
					? (float) $prop['number']
					: null;
			case 'select':
				return $prop['select']['name'] ?? null;
			case 'multi_select':
				$names = array();
				foreach ( (array) ( $prop['multi_select'] ?? array() ) as $entry ) {
					if ( isset( $entry['name'] ) ) {
						$names[] = (string) $entry['name'];
					}
				}
				return $names;
			case 'status':
				return $prop['status']['name'] ?? null;
			case 'date':
				return $prop['date']['start'] ?? null;
			case 'checkbox':
				return ! empty( $prop['checkbox'] );
			case 'url':
				return $prop['url'] ?? null;
			case 'email':
				return $prop['email'] ?? null;
			case 'phone_number':
				return $prop['phone_number'] ?? null;
			case 'formula':
				$formula = $prop['formula'] ?? array();
				$inner   = (string) ( $formula['type'] ?? '' );
				if ( '' === $inner || ! array_key_exists( $inner, $formula ) ) {
					return null;
				}
				$value = $formula[ $inner ];
				if ( is_array( $value ) ) {
					return wp_json_encode( $value );
				}
				if ( is_bool( $value ) ) {
					return $value ? '1' : '0';
				}
				return null === $value ? null : (string) $value;
		}

		// Defensive default — should never hit for v1 mapped types but
		// keeps unmapped types from blowing up if mapping changes.
		unset( $cortext_type );
		return null;
	}

	// ---------------------------------------------------------------
	// Small string helpers
	// ---------------------------------------------------------------

	/**
	 * Best-effort title for a Notion data source.
	 *
	 * @param array $data_source Notion data-source payload.
	 */
	private function data_source_title( array $data_source ): string {
		$title = '';
		if ( ! empty( $data_source['title'] ) && is_array( $data_source['title'] ) ) {
			$title = $this->plain_text( $data_source['title'] );
		}
		return '' === $title ? __( '(untitled)', 'cortext' ) : $title;
	}

	/**
	 * Pluck the title from a Notion row's properties.
	 *
	 * @param array $row Notion page payload.
	 */
	private function row_title( array $row ): string {
		foreach ( ( $row['properties'] ?? array() ) as $prop ) {
			if ( is_array( $prop ) && 'title' === ( $prop['type'] ?? '' ) ) {
				return $this->plain_text( $prop['title'] ?? array() );
			}
		}
		return '';
	}

	/**
	 * Join an array of Notion rich-text fragments into plain text.
	 *
	 * @param array $fragments Notion `rich_text` (or `title`) array.
	 */
	private function plain_text( array $fragments ): string {
		$out = '';
		foreach ( $fragments as $fragment ) {
			if ( is_array( $fragment ) && isset( $fragment['plain_text'] ) ) {
				$out .= (string) $fragment['plain_text'];
			}
		}
		return $out;
	}

	/**
	 * Notion returns property IDs URL-encoded inside property objects so
	 * they're safe for path params. We store the decoded form everywhere
	 * so callers can compare with view-config or query results without
	 * per-site encoding logic.
	 *
	 * @param string $id URL-encoded property id from Notion.
	 */
	private function decode_property_id( string $id ): string {
		if ( '' === $id ) {
			return '';
		}
		$decoded = rawurldecode( $id );
		return false === $decoded ? $id : $decoded;
	}
}
