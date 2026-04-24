<?php
/**
 * WP-CLI command to seed a "Books" collection with dummy data.
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

final class SeedBooks extends WP_CLI_Command {

	/**
	 * Seeds a "Books" collection with Author/Year fields and three entries.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext seed-books
	 *
	 * @when after_wp_load
	 */
	public function __invoke( array $args, array $assoc_args ): void {
		// 1. Idempotency check.
		$existing = get_posts(
			array(
				'post_type'   => Collection::POST_TYPE,
				'meta_key'    => 'slug',
				'meta_value'  => 'books',
				'numberposts' => 1,
			)
		);

		if ( $existing ) {
			WP_CLI::warning( 'Books collection already exists (ID ' . $existing[0]->ID . '). Skipping.' );
			return;
		}

		// 2. Create collection.
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_title'  => 'Books',
				'post_status' => 'publish',
			),
			true
		);

		if ( is_wp_error( $collection_id ) ) {
			WP_CLI::error( 'Failed to create collection: ' . $collection_id->get_error_message() );
		}

		update_post_meta( $collection_id, 'slug', 'books' );
		WP_CLI::log( "Created collection 'Books' (ID {$collection_id})." );

		// 3. Register entry CPT mid-request.
		$collection_post = get_post( $collection_id );
		( new CollectionEntries() )->register_for_collection( $collection_post );
		WP_CLI::log( "Registered CPT 'crtxt_books'." );

		// 4. Create fields.
		$fields_spec = array(
			'Author' => 'text',
			'Year'   => 'number',
		);

		$field_ids = array();

		foreach ( $fields_spec as $title => $type ) {
			$field_id = wp_insert_post(
				array(
					'post_type'   => Field::POST_TYPE,
					'post_title'  => $title,
					'post_status' => 'publish',
				),
				true
			);

			if ( is_wp_error( $field_id ) ) {
				WP_CLI::error( "Failed to create field '{$title}': " . $field_id->get_error_message() );
			}

			update_post_meta( $field_id, 'type', $type );
			$field_ids[ $title ] = $field_id;
			WP_CLI::log( "Created field '{$title}' (ID {$field_id}, type: {$type})." );
		}

		// 5. Attach fields to collection.
		foreach ( $field_ids as $field_id ) {
			add_post_meta( $collection_id, 'fields', $field_id );
		}

		// 6. Register field meta on the entry CPT.
		$entry_cpt = CollectionEntries::CPT_PREFIX . 'books';

		foreach ( $field_ids as $title => $field_id ) {
			$type = $fields_spec[ $title ];
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

		// 7. Insert entries.
		$books = array(
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
		);

		foreach ( $books as $book ) {
			$entry_id = wp_insert_post(
				array(
					'post_type'   => $entry_cpt,
					'post_title'  => $book['title'],
					'post_status' => 'publish',
				),
				true
			);

			if ( is_wp_error( $entry_id ) ) {
				WP_CLI::error( "Failed to create entry '{$book['title']}': " . $entry_id->get_error_message() );
			}

			update_post_meta( $entry_id, "field-{$field_ids['Author']}", $book['Author'] );
			update_post_meta( $entry_id, "field-{$field_ids['Year']}", $book['Year'] );

			WP_CLI::log( "Created entry '{$book['title']}' (ID {$entry_id})." );
		}

		WP_CLI::success( 'Books collection seeded with 3 entries.' );
	}
}
