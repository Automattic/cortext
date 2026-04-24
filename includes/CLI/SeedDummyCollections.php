<?php
/**
 * WP-CLI command to seed sample collections with dummy data.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\CLI;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use WP_CLI;
use WP_CLI_Command;

final class SeedDummyCollections extends WP_CLI_Command {

	/**
	 * Seeds sample collections (Books, Paintings) with fields and entries.
	 *
	 * Idempotent: skips any collection, field, or entry that already exists.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext seed
	 *
	 * @when after_wp_load
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function __invoke( array $args, array $assoc_args ): void {
		$collections = array(
			array(
				'title'   => 'Books',
				'slug'    => 'books',
				'fields'  => array(
					'Author' => 'text',
					'Year'   => 'number',
				),
				'entries' => array(
					array(
						'title'  => 'Terre des Hommes',
						'Author' => 'Antoine de Saint-Exupéry',
						'Year'   => 1939,
					),
					array(
						'title'  => 'Die Welt als Wille und Vorstellung',
						'Author' => 'Arthur Schopenhauer',
						'Year'   => 1818,
					),
					array(
						'title'  => 'Cien Años de Soledad',
						'Author' => 'Gabriel García Márquez',
						'Year'   => 1967,
					),
				),
			),
			array(
				'title'   => 'Paintings',
				'slug'    => 'paintings',
				'fields'  => array(
					'Author' => 'text',
					'Year'   => 'number',
				),
				'entries' => array(
					array(
						'title'  => 'Bal du moulin de la Galette',
						'Author' => 'Pierre-Auguste Renoir',
						'Year'   => 1876,
					),
					array(
						'title'  => 'Constellations',
						'Author' => 'Joan Miró',
						'Year'   => 1941,
					),
					array(
						'title'  => 'Nymphéas',
						'Author' => 'Claude Monet',
						'Year'   => 1906,
					),
				),
			),
		);

		foreach ( $collections as $spec ) {
			$this->seed_collection( $spec );
		}

		WP_CLI::success( 'Seeding complete.' );
	}

	private function seed_collection( array $spec ): void {
		$slug      = $spec['slug'];
		$entry_cpt = CollectionEntries::CPT_PREFIX . $slug;

		// 1. Find or create collection.
		$existing = get_posts(
			array(
				'post_type'   => Collection::POST_TYPE,
				// phpcs:ignore WordPress.DB.SlowDBQuery
				'meta_key'    => 'slug',
				// phpcs:ignore WordPress.DB.SlowDBQuery
				'meta_value'  => $slug,
				'numberposts' => 1,
			)
		);

		if ( $existing ) {
			$collection_id = $existing[0]->ID;
			WP_CLI::log( "Collection '{$spec['title']}' already exists (ID {$collection_id})." );
		} else {
			$collection_id = wp_insert_post(
				array(
					'post_type'   => Collection::POST_TYPE,
					'post_title'  => $spec['title'],
					'post_status' => 'private',
				),
				true
			);

			if ( is_wp_error( $collection_id ) ) {
				WP_CLI::error( "Failed to create collection '{$spec['title']}': " . $collection_id->get_error_message() );
			}

			update_post_meta( $collection_id, 'slug', $slug );
			WP_CLI::log( "Created collection '{$spec['title']}' (ID {$collection_id})." );
		}

		// 2. Ensure entry CPT is registered for this request.
		if ( ! post_type_exists( $entry_cpt ) ) {
			( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );
			WP_CLI::log( "Registered CPT '{$entry_cpt}'." );
		}

		// 3. Find or create fields, attach to collection.
		$existing_field_ids = get_post_meta( $collection_id, 'fields', false );
		$field_ids          = array();

		foreach ( $spec['fields'] as $title => $type ) {
			$found = $this->find_attached_field( $title, $existing_field_ids );

			if ( $found ) {
				$field_ids[ $title ] = $found;
				WP_CLI::log( "Field '{$title}' already exists (ID {$found})." );
				continue;
			}

			$field_id = wp_insert_post(
				array(
					'post_type'   => Field::POST_TYPE,
					'post_title'  => $title,
					'post_status' => 'private',
				),
				true
			);

			if ( is_wp_error( $field_id ) ) {
				WP_CLI::error( "Failed to create field '{$title}': " . $field_id->get_error_message() );
			}

			update_post_meta( $field_id, 'type', $type );
			add_post_meta( $collection_id, 'fields', $field_id );
			$field_ids[ $title ] = $field_id;
			WP_CLI::log( "Created field '{$title}' (ID {$field_id}, type: {$type})." );
		}

		// 4. Register field meta on the entry CPT (safe to call repeatedly).
		foreach ( $field_ids as $title => $field_id ) {
			$type = $spec['fields'][ $title ];
			register_post_meta(
				$entry_cpt,
				"field-{$field_id}",
				array(
					'type'         => CollectionEntries::wp_meta_type_for( $type ),
					'single'       => true,
					'show_in_rest' => true,
				)
			);
		}

		// 5. Insert entries that don't already exist (matched by title).
		$existing_entries = get_posts(
			array(
				'post_type'   => $entry_cpt,
				'post_status' => 'any',
				'numberposts' => -1,
				'fields'      => 'ids',
			)
		);

		$existing_titles = array();
		foreach ( $existing_entries as $entry_id ) {
			$existing_titles[] = get_the_title( $entry_id );
		}

		foreach ( $spec['entries'] as $entry ) {
			if ( in_array( $entry['title'], $existing_titles, true ) ) {
				WP_CLI::log( "Entry '{$entry['title']}' already exists. Skipping." );
				continue;
			}

			$entry_id = wp_insert_post(
				array(
					'post_type'   => $entry_cpt,
					'post_title'  => $entry['title'],
					'post_status' => 'private',
				),
				true
			);

			if ( is_wp_error( $entry_id ) ) {
				WP_CLI::error( "Failed to create entry '{$entry['title']}': " . $entry_id->get_error_message() );
			}

			foreach ( $field_ids as $field_name => $field_id ) {
				if ( isset( $entry[ $field_name ] ) ) {
					update_post_meta( $entry_id, "field-{$field_id}", $entry[ $field_name ] );
				}
			}

			WP_CLI::log( "Created entry '{$entry['title']}' (ID {$entry_id})." );
		}
	}

	/**
	 * Finds a field by title among IDs already attached to a collection.
	 *
	 * @param string $title     The field title to search for.
	 * @param array  $field_ids Array of field post IDs to search within.
	 */
	private function find_attached_field( string $title, array $field_ids ): ?int {
		foreach ( $field_ids as $field_id ) {
			$field = get_post( (int) $field_id );
			if ( $field && $field->post_title === $title ) {
				return $field->ID;
			}
		}
		return null;
	}
}
