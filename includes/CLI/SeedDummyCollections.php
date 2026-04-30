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
use Cortext\PostType\Page;
use WP_CLI;
use WP_CLI_Command;

final class SeedDummyCollections extends WP_CLI_Command {

	/**
	 * Seeds sample collections (Books, Paintings, Demo) plus a small page
	 * hierarchy that exercises the trash + cascade flows.
	 *
	 * Idempotent: skips anything that already exists, unless --reset is passed.
	 *
	 * ## OPTIONS
	 *
	 * [--reset]
	 * : Delete all Cortext data (collections, fields, entries, pages) before seeding.
	 * Prompts for confirmation unless --force is also passed.
	 *
	 * [--force]
	 * : Skip the confirmation prompt when using --reset.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext seed
	 *     wp cortext seed --reset
	 *     wp cortext seed --reset --force
	 *
	 * @when after_wp_load
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function __invoke( array $args, array $assoc_args ): void {
		// Run as an administrator so seeded entries get a real `post_author`
		// (otherwise CLI's user-0 context produces empty Created by /
		// Last edited by columns) and the save_post hook records
		// `_modified_by` against the same user.
		wp_set_current_user( $this->default_seed_user_id() );

		if ( WP_CLI\Utils\get_flag_value( $assoc_args, 'reset', false ) ) {
			WP_CLI::confirm(
				'This will delete all Cortext collections, fields, and entries. Continue?',
				array( 'yes' => WP_CLI\Utils\get_flag_value( $assoc_args, 'force', false ) )
			);
			$this->reset();
		}

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
			array(
				'title'   => 'Demo',
				'slug'    => 'demo',
				'fields'  => array(
					'Notes'    => 'text',
					'Quantity' => 'number',
					'Contact'  => 'email',
					'Homepage' => 'url',
					'Status'   => array(
						'type'    => 'select',
						'options' => array(
							array(
								'value' => 'Draft',
								'label' => 'Draft',
								'color' => '#e8e8e7',
							),
							array(
								'value' => 'In review',
								'label' => 'In review',
								'color' => '#fbf3db',
							),
							array(
								'value' => 'Done',
								'label' => 'Done',
								'color' => '#ddedea',
							),
						),
					),
					'Tags'     => array(
						'type'    => 'multiselect',
						'options' => array(
							array(
								'value' => 'bug',
								'label' => 'bug',
								'color' => '#ffe2dd',
							),
							array(
								'value' => 'feature',
								'label' => 'feature',
								'color' => '#ddebf1',
							),
							array(
								'value' => 'chore',
								'label' => 'chore',
								'color' => '#fbdbc7',
							),
							array(
								'value' => 'docs',
								'label' => 'docs',
								'color' => '#eae4f2',
							),
						),
					),
					'Due'      => 'date',
					'Reminder' => 'datetime',
					'Done?'    => 'checkbox',
				),
				'entries' => array(
					array(
						'title'    => 'Wire up the inline editor',
						'Notes'    => 'Click into any cell to edit.',
						'Quantity' => 3,
						'Contact'  => 'editor@example.com',
						'Homepage' => 'https://example.com/editor',
						'Status'   => 'In review',
						'Tags'     => array( 'feature', 'docs' ),
						'Due'      => '2026-05-15',
						'Reminder' => '2026-05-14T09:00:00',
						'Done?'    => false,
					),
					array(
						'title'    => 'Polish the footer button',
						'Notes'    => 'Notion-style "+ New" lives below the table.',
						'Quantity' => 1,
						'Contact'  => 'design@example.com',
						'Homepage' => 'https://example.com/design',
						'Status'   => 'Draft',
						'Tags'     => array( 'chore' ),
						'Due'      => '2026-05-20',
						'Reminder' => '2026-05-19T15:30:00',
						'Done?'    => true,
					),
				),
			),
		);

		foreach ( $collections as $spec ) {
			$this->seed_collection( $spec );
		}

		$this->seed_pages();

		WP_CLI::success( 'Seeding complete.' );
	}

	/**
	 * Returns the ID of the first administrator, or 1 as a fallback.
	 *
	 * Used to give the seed run a real user context so seeded entries
	 * have a recognizable `post_author` and `_modified_by`.
	 */
	private function default_seed_user_id(): int {
		$users = get_users(
			array(
				'role'   => 'administrator',
				'number' => 1,
				'fields' => array( 'ID' ),
			)
		);
		return $users ? (int) $users[0]->ID : 1;
	}

	/**
	 * Seeds a small page hierarchy useful for exercising the sidebar Trash
	 * flow: a root with mixed-depth children, plus a sibling at the root so
	 * cascade trash and intermediate-node restore can be tried end-to-end.
	 */
	private function seed_pages(): void {
		$tree = array(
			array(
				'title'    => 'Workspace',
				'children' => array(
					array(
						'title'    => 'Engineering',
						'children' => array(
							array( 'title' => 'Onboarding' ),
							array(
								'title'    => 'Standards',
								'children' => array(
									array( 'title' => 'PHP' ),
									array( 'title' => 'JavaScript' ),
								),
							),
						),
					),
					array(
						'title'    => 'Design',
						'children' => array(
							array( 'title' => 'System' ),
							array( 'title' => 'Mockups' ),
						),
					),
				),
			),
			array( 'title' => 'Notes' ),
		);

		foreach ( $tree as $node ) {
			$this->seed_page_tree( $node, 0 );
		}
	}

	private function seed_page_tree( array $node, int $parent_id ): void {
		$existing = get_posts(
			array(
				'post_type'   => Page::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				'post_parent' => $parent_id,
				'title'       => $node['title'],
				'numberposts' => 1,
				'fields'      => 'ids',
			)
		);

		if ( $existing ) {
			$page_id = (int) $existing[0];
			WP_CLI::log( "Page '{$node['title']}' already exists (ID {$page_id})." );
		} else {
			$page_id = wp_insert_post(
				array(
					'post_type'   => Page::POST_TYPE,
					'post_status' => 'private',
					'post_title'  => $node['title'],
					'post_parent' => $parent_id,
				),
				true
			);

			if ( is_wp_error( $page_id ) ) {
				WP_CLI::error( "Failed to create page '{$node['title']}': " . $page_id->get_error_message() );
			}

			WP_CLI::log( "Created page '{$node['title']}' (ID {$page_id})." );
		}

		foreach ( $node['children'] ?? array() as $child ) {
			$this->seed_page_tree( $child, (int) $page_id );
		}
	}

	private function seed_collection( array $spec ): void {
		$slug      = $spec['slug'];
		$entry_cpt = CollectionEntries::CPT_PREFIX . $slug;

		// 1. Find or create collection. `get_posts` defaults to `post_status:
		// publish`, but our seeded collections are private; without an
		// explicit status the lookup never matches and re-running the
		// seeder accumulates duplicate collections sharing a slug.
		$existing = get_posts(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
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
		$field_types        = array();

		foreach ( $spec['fields'] as $title => $config ) {
			$type    = is_array( $config ) ? $config['type'] : $config;
			$options = is_array( $config ) && isset( $config['options'] ) ? $config['options'] : null;

			$field_types[ $title ] = $type;

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
			if ( null !== $options ) {
				update_post_meta( $field_id, 'options', wp_json_encode( $options ) );
			}
			add_post_meta( $collection_id, 'fields', $field_id );
			$field_ids[ $title ] = $field_id;
			WP_CLI::log( "Created field '{$title}' (ID {$field_id}, type: {$type})." );
		}

		// 4. Register field meta on the entry CPT (safe to call repeatedly).
		foreach ( $field_ids as $title => $field_id ) {
			$type = $field_types[ $title ];
			register_post_meta(
				$entry_cpt,
				"field-{$field_id}",
				array(
					'type'         => CollectionEntries::wp_meta_type_for( $type ),
					'single'       => 'multiselect' !== $type,
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
				if ( ! array_key_exists( $field_name, $entry ) ) {
					continue;
				}

				$value = $entry[ $field_name ];
				$type  = $field_types[ $field_name ];

				if ( 'multiselect' === $type && is_array( $value ) ) {
					foreach ( $value as $item ) {
						add_post_meta( $entry_id, "field-{$field_id}", $item );
					}
					continue;
				}

				update_post_meta( $entry_id, "field-{$field_id}", $value );
			}

			WP_CLI::log( "Created entry '{$entry['title']}' (ID {$entry_id})." );
		}
	}

	private function reset(): void {
		// 1. Delete entries for each collection.
		$collections = get_posts(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'any',
				'numberposts' => -1,
			)
		);

		foreach ( $collections as $collection ) {
			$slug      = get_post_meta( $collection->ID, 'slug', true );
			$entry_cpt = CollectionEntries::CPT_PREFIX . $slug;

			if ( ! post_type_exists( $entry_cpt ) ) {
				( new CollectionEntries() )->register_for_collection( $collection );
			}

			$entries = get_posts(
				array(
					'post_type'   => $entry_cpt,
					'post_status' => 'any',
					'numberposts' => -1,
					'fields'      => 'ids',
				)
			);

			foreach ( $entries as $entry_id ) {
				wp_delete_post( $entry_id, true );
			}

			if ( $entries ) {
				WP_CLI::log( sprintf( 'Deleted %d entries from "%s".', count( $entries ), $collection->post_title ) );
			}
		}

		// 2. Delete all fields.
		$fields = get_posts(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'any',
				'numberposts' => -1,
				'fields'      => 'ids',
			)
		);

		foreach ( $fields as $field_id ) {
			wp_delete_post( $field_id, true );
		}

		if ( $fields ) {
			WP_CLI::log( sprintf( 'Deleted %d fields.', count( $fields ) ) );
		}

		// 3. Delete all collections.
		foreach ( $collections as $collection ) {
			wp_delete_post( $collection->ID, true );
		}

		if ( $collections ) {
			WP_CLI::log( sprintf( 'Deleted %d collections.', count( $collections ) ) );
		}

		// 4. Delete all pages, including trashed ones. WP_Query's 'any'
		// excludes internal statuses like 'trash', so list them explicitly.
		$pages = get_posts(
			array(
				'post_type'   => Page::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish', 'pending', 'future', 'trash' ),
				'numberposts' => -1,
				'fields'      => 'ids',
			)
		);

		foreach ( $pages as $page_id ) {
			wp_delete_post( (int) $page_id, true );
		}

		if ( $pages ) {
			WP_CLI::log( sprintf( 'Deleted %d pages.', count( $pages ) ) );
		}

		WP_CLI::success( 'Reset complete.' );
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
