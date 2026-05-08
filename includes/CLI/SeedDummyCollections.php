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
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Page;
use Cortext\Relations;
use WP_CLI;
use WP_CLI_Command;

final class SeedDummyCollections extends WP_CLI_Command {

	private const WORKSPACE_HOME_META_KEY = 'cortext_workspace_home';

	/**
	 * Seeds sample collections (Books, Paintings, Demo, Projects) plus a
	 * realistic page hierarchy with embedded collection views.
	 *
	 * Idempotent: skips anything that already exists, unless --reset is passed.
	 *
	 * ## OPTIONS
	 *
	 * [--reset]
	 * : Delete all Cortext data and workspace home preferences before seeding.
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
		$seed_user_id = $this->default_seed_user_id();
		wp_set_current_user( $seed_user_id );

		if ( WP_CLI\Utils\get_flag_value( $assoc_args, 'reset', false ) ) {
			WP_CLI::confirm(
				'This will delete all Cortext collections, fields, entries, pages, and workspace home preferences. Continue?',
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
					array(
						'title'  => 'The Left Hand of Darkness',
						'Author' => 'Ursula K. Le Guin',
						'Year'   => 1969,
					),
					array(
						'title'  => 'Invisible Cities',
						'Author' => 'Italo Calvino',
						'Year'   => 1972,
					),
					array(
						'title'  => 'The Dispossessed',
						'Author' => 'Ursula K. Le Guin',
						'Year'   => 1974,
					),
					array(
						'title'  => 'Ficciones',
						'Author' => 'Jorge Luis Borges',
						'Year'   => 1944,
					),
					array(
						'title'  => 'The Master and Margarita',
						'Author' => 'Mikhail Bulgakov',
						'Year'   => 1967,
					),
					array(
						'title'  => 'Things Fall Apart',
						'Author' => 'Chinua Achebe',
						'Year'   => 1958,
					),
					array(
						'title'  => 'The Name of the Rose',
						'Author' => 'Umberto Eco',
						'Year'   => 1980,
					),
					array(
						'title'  => 'Kindred',
						'Author' => 'Octavia E. Butler',
						'Year'   => 1979,
					),
					array(
						'title'  => 'The Rings of Saturn',
						'Author' => 'W. G. Sebald',
						'Year'   => 1995,
					),
					array(
						'title'  => 'Beloved',
						'Author' => 'Toni Morrison',
						'Year'   => 1987,
					),
					array(
						'title'  => 'The Trial',
						'Author' => 'Franz Kafka',
						'Year'   => 1925,
					),
					array(
						'title'  => 'Mrs Dalloway',
						'Author' => 'Virginia Woolf',
						'Year'   => 1925,
					),
					array(
						'title'  => 'Pedro Páramo',
						'Author' => 'Juan Rulfo',
						'Year'   => 1955,
					),
					array(
						'title'  => 'Season of Migration to the North',
						'Author' => 'Tayeb Salih',
						'Year'   => 1966,
					),
					array(
						'title'  => 'The Tale of Genji',
						'Author' => 'Murasaki Shikibu',
						'Year'   => 1021,
					),
					array(
						'title'  => 'The Vegetarian',
						'Author' => 'Han Kang',
						'Year'   => 2007,
					),
					array(
						'title'  => 'Pale Fire',
						'Author' => 'Vladimir Nabokov',
						'Year'   => 1962,
					),
					array(
						'title'  => 'The Savage Detectives',
						'Author' => 'Roberto Bolaño',
						'Year'   => 1998,
					),
					array(
						'title'  => 'Austerlitz',
						'Author' => 'W. G. Sebald',
						'Year'   => 2001,
					),
					array(
						'title'  => 'The Passion According to G.H.',
						'Author' => 'Clarice Lispector',
						'Year'   => 1964,
					),
					array(
						'title'  => 'Midnight’s Children',
						'Author' => 'Salman Rushdie',
						'Year'   => 1981,
					),
					array(
						'title'  => 'The God of Small Things',
						'Author' => 'Arundhati Roy',
						'Year'   => 1997,
					),
					array(
						'title'  => 'Snow Country',
						'Author' => 'Yasunari Kawabata',
						'Year'   => 1948,
					),
					array(
						'title'  => 'The Invention of Morel',
						'Author' => 'Adolfo Bioy Casares',
						'Year'   => 1940,
					),
					array(
						'title'  => 'The Sound and the Fury',
						'Author' => 'William Faulkner',
						'Year'   => 1929,
					),
					array(
						'title'  => 'The Leopard',
						'Author' => 'Giuseppe Tomasi di Lampedusa',
						'Year'   => 1958,
					),
					array(
						'title'  => 'Parable of the Sower',
						'Author' => 'Octavia E. Butler',
						'Year'   => 1993,
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
					array(
						'title'  => 'Las Meninas',
						'Author' => 'Diego Velázquez',
						'Year'   => 1656,
					),
					array(
						'title'  => 'The Starry Night',
						'Author' => 'Vincent van Gogh',
						'Year'   => 1889,
					),
					array(
						'title'  => 'Guernica',
						'Author' => 'Pablo Picasso',
						'Year'   => 1937,
					),
					array(
						'title'  => 'The Persistence of Memory',
						'Author' => 'Salvador Dalí',
						'Year'   => 1931,
					),
					array(
						'title'  => 'The Birth of Venus',
						'Author' => 'Sandro Botticelli',
						'Year'   => 1486,
					),
					array(
						'title'  => 'The Kiss',
						'Author' => 'Gustav Klimt',
						'Year'   => 1908,
					),
					array(
						'title'  => 'Composition VIII',
						'Author' => 'Wassily Kandinsky',
						'Year'   => 1923,
					),
					array(
						'title'  => 'American Gothic',
						'Author' => 'Grant Wood',
						'Year'   => 1930,
					),
					array(
						'title'  => 'The Two Fridas',
						'Author' => 'Frida Kahlo',
						'Year'   => 1939,
					),
					array(
						'title'  => 'Girl with a Pearl Earring',
						'Author' => 'Johannes Vermeer',
						'Year'   => 1665,
					),
					array(
						'title'  => 'The Garden of Earthly Delights',
						'Author' => 'Hieronymus Bosch',
						'Year'   => 1515,
					),
					array(
						'title'  => 'Liberty Leading the People',
						'Author' => 'Eugène Delacroix',
						'Year'   => 1830,
					),
					array(
						'title'  => 'The Night Watch',
						'Author' => 'Rembrandt van Rijn',
						'Year'   => 1642,
					),
					array(
						'title'  => 'The Arnolfini Portrait',
						'Author' => 'Jan van Eyck',
						'Year'   => 1434,
					),
					array(
						'title'  => 'A Sunday Afternoon on the Island of La Grande Jatte',
						'Author' => 'Georges Seurat',
						'Year'   => 1886,
					),
					array(
						'title'  => 'The School of Athens',
						'Author' => 'Raphael',
						'Year'   => 1511,
					),
					array(
						'title'  => 'The Scream',
						'Author' => 'Edvard Munch',
						'Year'   => 1893,
					),
					array(
						'title'  => 'Impression, Sunrise',
						'Author' => 'Claude Monet',
						'Year'   => 1872,
					),
					array(
						'title'  => 'No. 5, 1948',
						'Author' => 'Jackson Pollock',
						'Year'   => 1948,
					),
					array(
						'title'  => 'Campbell’s Soup Cans',
						'Author' => 'Andy Warhol',
						'Year'   => 1962,
					),
					array(
						'title'  => 'The Sleeping Gypsy',
						'Author' => 'Henri Rousseau',
						'Year'   => 1897,
					),
					array(
						'title'  => 'Christina’s World',
						'Author' => 'Andrew Wyeth',
						'Year'   => 1948,
					),
					array(
						'title'  => 'The Gross Clinic',
						'Author' => 'Thomas Eakins',
						'Year'   => 1875,
					),
					array(
						'title'  => 'The Oxbow',
						'Author' => 'Thomas Cole',
						'Year'   => 1836,
					),
					array(
						'title'  => 'Black Square',
						'Author' => 'Kazimir Malevich',
						'Year'   => 1915,
					),
					array(
						'title'  => 'Broadway Boogie Woogie',
						'Author' => 'Piet Mondrian',
						'Year'   => 1943,
					),
					array(
						'title'  => 'The Treachery of Images',
						'Author' => 'René Magritte',
						'Year'   => 1929,
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
					array(
						'title'    => 'Add keyboard traversal coverage',
						'Notes'    => 'Use Tab and Shift+Tab across editable cells.',
						'Quantity' => 6,
						'Contact'  => '',
						'Homepage' => 'https://example.com/testing',
						'Status'   => 'In review',
						'Tags'     => array( 'bug', 'feature' ),
						'Due'      => '2026-05-22',
						'Reminder' => '',
						'Done?'    => false,
					),
					array(
						'title'    => 'Document wp-env demo seed',
						'Notes'    => 'The seed command is safe to run after every start.',
						'Quantity' => 2,
						'Contact'  => 'docs@example.com',
						'Homepage' => '',
						'Status'   => 'Done',
						'Tags'     => array( 'docs' ),
						'Due'      => '2026-05-12',
						'Reminder' => '2026-05-11T10:00:00',
						'Done?'    => true,
					),
				),
			),
			array(
				'title'   => 'Projects',
				'slug'    => 'projects',
				'fields'  => array(
					'Status'      => array(
						'type'    => 'select',
						'options' => array(
							array(
								'value' => 'Backlog',
								'label' => 'Backlog',
								'color' => '#e8e8e7',
							),
							array(
								'value' => 'Planned',
								'label' => 'Planned',
								'color' => '#ddebf1',
							),
							array(
								'value' => 'In progress',
								'label' => 'In progress',
								'color' => '#fbf3db',
							),
							array(
								'value' => 'Shipped',
								'label' => 'Shipped',
								'color' => '#ddedea',
							),
						),
					),
					'Priority'    => array(
						'type'    => 'select',
						'options' => array(
							array(
								'value' => 'Low',
								'label' => 'Low',
								'color' => '#e8e8e7',
							),
							array(
								'value' => 'Medium',
								'label' => 'Medium',
								'color' => '#ddebf1',
							),
							array(
								'value' => 'High',
								'label' => 'High',
								'color' => '#ffe2dd',
							),
						),
					),
					'Owner'       => 'text',
					'Contact'     => 'email',
					'Kickoff'     => 'date',
					'Due'         => 'date',
					'Tags'        => array(
						'type'    => 'multiselect',
						'options' => array(
							array(
								'value' => 'editor',
								'label' => 'editor',
								'color' => '#ddebf1',
							),
							array(
								'value' => 'data',
								'label' => 'data',
								'color' => '#ddedea',
							),
							array(
								'value' => 'dev-env',
								'label' => 'dev-env',
								'color' => '#fbdbc7',
							),
							array(
								'value' => 'research',
								'label' => 'research',
								'color' => '#eae4f2',
							),
						),
					),
					'Progress'    => 'number',
					'Blocked?'    => 'checkbox',
					'Project URL' => 'url',
					'Notes'       => 'text',
				),
				'entries' => array(
					array(
						'title'       => 'Seed realistic demo workspace',
						'Status'      => 'In progress',
						'Priority'    => 'High',
						'Owner'       => 'Miguel',
						'Contact'     => 'miguel@example.com',
						'Kickoff'     => '2026-05-04',
						'Due'         => '2026-05-17',
						'Tags'        => array( 'dev-env', 'data' ),
						'Progress'    => 65,
						'Blocked?'    => false,
						'Project URL' => 'https://example.com/projects/demo-workspace',
						'Notes'       => 'Make wp-env starts immediately useful for local testing.',
					),
					array(
						'title'       => 'Inline table editing polish',
						'Status'      => 'Planned',
						'Priority'    => 'Medium',
						'Owner'       => 'Hector',
						'Contact'     => 'hector@example.com',
						'Kickoff'     => '2026-05-11',
						'Due'         => '2026-05-29',
						'Tags'        => array( 'editor' ),
						'Progress'    => 20,
						'Blocked?'    => false,
						'Project URL' => '',
						'Notes'       => 'Tighten keyboard flow and empty-cell behavior.',
					),
					array(
						'title'       => 'Collection public templates',
						'Status'      => 'Backlog',
						'Priority'    => 'Low',
						'Owner'       => 'Design',
						'Contact'     => 'design@example.com',
						'Kickoff'     => '',
						'Due'         => '',
						'Tags'        => array( 'research' ),
						'Progress'    => 0,
						'Blocked?'    => false,
						'Project URL' => 'https://example.com/projects/public-templates',
						'Notes'       => 'Keep empty dates in the demo for filter and display checks.',
					),
					array(
						'title'       => 'DataViews view persistence',
						'Status'      => 'Shipped',
						'Priority'    => 'High',
						'Owner'       => 'Platform',
						'Contact'     => '',
						'Kickoff'     => '2026-04-15',
						'Due'         => '2026-05-01',
						'Tags'        => array( 'data', 'editor' ),
						'Progress'    => 100,
						'Blocked?'    => false,
						'Project URL' => 'https://example.com/projects/view-persistence',
						'Notes'       => 'Column order, widths, and visibility survive reloads.',
					),
					array(
						'title'       => 'Research relation fields',
						'Status'      => 'Planned',
						'Priority'    => 'Medium',
						'Owner'       => 'Research',
						'Contact'     => 'research@example.com',
						'Kickoff'     => '2026-05-18',
						'Due'         => '2026-06-12',
						'Tags'        => array( 'research', 'data' ),
						'Progress'    => 10,
						'Blocked?'    => true,
						'Project URL' => 'https://example.com/projects/relation-fields',
						'Notes'       => 'Blocked until the resolved schema contract settles.',
					),
				),
			),
		);

		$collection_ids = array();
		foreach ( $collections as $spec ) {
			$collection_ids[ $spec['slug'] ] = $this->seed_collection( $spec );
		}

		$this->seed_relationship_examples( $collection_ids );

		$workspace_page_id = $this->seed_pages( $collection_ids );
		$this->seed_workspace_home( $seed_user_id, $workspace_page_id );

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
	 * Seeds a small realistic workspace hierarchy with starter content.
	 *
	 * @param array $collection_ids Collection IDs keyed by seeded collection slug.
	 * @return int Seeded Workspace page ID.
	 */
	private function seed_pages( array $collection_ids ): int {
		$banner = CORTEXT_PATH . 'cortext-banner.png';
		$tree   = array(
			array(
				'title'    => 'Workspace',
				'icon'     => '🏠',
				'cover'    => $banner,
				'content'  => $this->page_content(
					array(
						$this->paragraph( 'This local workspace is seeded automatically for wp-env. It gives the shell, sidebar, editor canvas, and DataViews something realistic to render immediately.' ),
						$this->data_view_block( $collection_ids['projects'] ?? 0 ),
					)
				),
				'children' => array(
					array(
						'title'    => 'Engineering',
						'icon'     => '🛠️',
						'content'  => $this->page_content(
							array(
								$this->paragraph( 'Use this area to test nested pages, drag and drop, duplication, trash restore, and inline document editing.' ),
								$this->data_view_block( $collection_ids['projects'] ?? 0 ),
							)
						),
						'children' => array(
							array(
								'title'   => 'Onboarding',
								'icon'    => array(
									'type'  => 'wp',
									'name'  => 'tip',
									'color' => 'yellow',
								),
								'content' => $this->page_content(
									array(
										$this->paragraph( 'A compact starter page for checking title edits, autosave, nested sidebar rows, and readable editor content.' ),
									)
								),
							),
							array(
								'title'    => 'Standards',
								'icon'     => '📐',
								'content'  => $this->page_content(
									array(
										$this->paragraph( 'Seeded standards pages keep the tree deep enough to exercise cascade trash and restore behavior.' ),
									)
								),
								'children' => array(
									array(
										'title'   => 'PHP',
										'icon'    => '🐘',
										'content' => $this->page_content(
											array(
												$this->paragraph( 'Run PHPCS and PHPUnit before sending changes that touch server behavior.' ),
											)
										),
									),
									array(
										'title'   => 'JavaScript',
										'icon'    => array(
											'type'  => 'wp',
											'name'  => 'code',
											'color' => 'blue',
										),
										'content' => $this->page_content(
											array(
												$this->paragraph( 'DataViews and the shell should stay close to WordPress package conventions.' ),
											)
										),
									),
								),
							),
						),
					),
					array(
						'title'    => 'Design',
						'icon'     => '🎨',
						'cover'    => $banner,
						'content'  => $this->page_content(
							array(
								$this->paragraph( 'A branch of seeded pages for checking sibling ordering, rename flows, and editor canvas spacing.' ),
							)
						),
						'children' => array(
							array(
								'title'   => 'System',
								'icon'    => '🧩',
								'content' => $this->page_content(
									array(
										$this->paragraph( 'Theme tokens and shell chrome can be tested here without creating fresh content.' ),
									)
								),
							),
							array(
								'title'   => 'Mockups',
								'icon'    => array(
									'type'  => 'wp',
									'name'  => 'brush',
									'color' => 'pink',
								),
								'content' => $this->page_content(
									array(
										$this->paragraph( 'Use this seeded page as a scratch area for block layout and inspector checks.' ),
									)
								),
							),
						),
					),
				),
			),
			array(
				'title'   => 'Research',
				'icon'    => '🔬',
				'cover'   => $banner,
				'content' => $this->page_content(
					array(
						$this->paragraph( 'Seeded books and paintings provide smaller collections for switching views and verifying mixed data sets.' ),
						$this->data_view_block( $collection_ids['books'] ?? 0 ),
						$this->data_view_block( $collection_ids['paintings'] ?? 0 ),
					)
				),
			),
			array(
				'title'   => 'Demo database',
				'icon'    => array(
					'type'  => 'wp',
					'name'  => 'table',
					'color' => 'green',
				),
				'content' => $this->page_content(
					array(
						$this->paragraph( 'This page embeds the field-type demo collection so local starts cover text, number, email, URL, select, multiselect, date, datetime, and checkbox cells.' ),
						$this->data_view_block( $collection_ids['demo'] ?? 0 ),
					)
				),
			),
			array(
				'title'   => 'About Cortext',
				'icon'    => array(
					'type'   => 'image',
					'source' => $banner,
				),
				'content' => $this->page_content(
					array(
						$this->paragraph( 'A landing page for the project so reseeds always include the image-icon variant alongside the emoji and WP-icon ones.' ),
					)
				),
			),
			array(
				'title'   => 'Notes',
				'content' => $this->page_content(
					array(
						$this->paragraph( 'A root-level sibling page keeps sidebar actions and root ordering easy to test.' ),
					)
				),
			),
		);

		$workspace_page_id = 0;
		foreach ( $tree as $node ) {
			$page_id = $this->seed_page_tree( $node, 0 );
			if ( 'Workspace' === $node['title'] ) {
				$workspace_page_id = $page_id;
			}
		}

		return $workspace_page_id;
	}

	private function seed_page_tree( array $node, int $parent_id ): int {
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

			$page = get_post( $page_id );
			if ( isset( $node['content'] ) && $page && '' === trim( (string) $page->post_content ) ) {
				wp_update_post(
					array(
						'ID'           => $page_id,
						'post_content' => $node['content'],
					)
				);
				WP_CLI::log( "Updated empty page '{$node['title']}' with demo content." );
			}
		} else {
			$page_id = wp_insert_post(
				array(
					'post_type'    => Page::POST_TYPE,
					'post_status'  => 'private',
					'post_title'   => $node['title'],
					'post_parent'  => $parent_id,
					'post_content' => $node['content'] ?? '',
				),
				true
			);

			if ( is_wp_error( $page_id ) ) {
				WP_CLI::error( "Failed to create page '{$node['title']}': " . $page_id->get_error_message() );
			}

			WP_CLI::log( "Created page '{$node['title']}' (ID {$page_id})." );
		}

		if ( ! empty( $node['icon'] ) ) {
			$icon_meta = $this->serialize_icon_meta( $node['icon'] );
			if ( '' !== $icon_meta ) {
				update_post_meta( $page_id, DocumentIdentity::META_KEY, $icon_meta );
			}
		}

		if ( ! empty( $node['cover'] ) ) {
			$cover_id = $this->ensure_attachment_from_path( $node['cover'] );
			if ( $cover_id > 0 ) {
				update_post_meta( $page_id, '_thumbnail_id', $cover_id );
			}
		}

		foreach ( $node['children'] ?? array() as $child ) {
			$this->seed_page_tree( $child, (int) $page_id );
		}

		return (int) $page_id;
	}

	private function seed_workspace_home( int $user_id, int $page_id ): void {
		if ( $page_id <= 0 ) {
			return;
		}

		$current = get_user_meta( $user_id, self::WORKSPACE_HOME_META_KEY, true );
		if ( is_string( $current ) && '' !== $current && $this->workspace_home_exists( $current ) ) {
			WP_CLI::log( 'Workspace home already exists. Skipping.' );
			return;
		}

		update_user_meta( $user_id, self::WORKSPACE_HOME_META_KEY, "page:{$page_id}" );
		WP_CLI::log( "Set workspace home to page 'Workspace' (ID {$page_id})." );
	}

	private function workspace_home_exists( string $raw ): bool {
		$parts = explode( ':', $raw, 2 );
		if ( 2 !== count( $parts ) ) {
			return false;
		}

		$id = (int) $parts[1];
		if ( $id <= 0 ) {
			return false;
		}

		$post = get_post( $id );
		if ( ! $post || 'trash' === $post->post_status ) {
			return false;
		}

		$post_type = 'page' === $parts[0]
			? Page::POST_TYPE
			: ( 'collection' === $parts[0] ? Collection::POST_TYPE : null );

		return null !== $post_type && $post_type === $post->post_type;
	}

	private function page_content( array $blocks ): string {
		return implode( "\n\n", array_filter( $blocks ) );
	}

	/**
	 * Returns the JSON meta string for a seeded page icon. Accepts either a
	 * raw emoji (string) or a structured array describing a WP icon
	 * (`['type' => 'wp', 'name' => ..., 'color' => ...]`) or an image icon
	 * sourced from a bundled file (`['type' => 'image', 'source' => path]`).
	 * Returns an empty string when the descriptor can't be resolved (e.g.
	 * the image source is missing) so the caller can skip the meta update.
	 *
	 * @param mixed $icon Icon descriptor.
	 */
	private function serialize_icon_meta( $icon ): string {
		if ( is_string( $icon ) && '' !== $icon ) {
			return (string) wp_json_encode(
				array(
					'type'  => 'emoji',
					'value' => $icon,
				),
				JSON_UNESCAPED_UNICODE
			);
		}

		if ( ! is_array( $icon ) ) {
			return '';
		}

		$type = $icon['type'] ?? '';

		if ( 'wp' === $type && ! empty( $icon['name'] ) ) {
			$payload = array(
				'type' => 'wp',
				'name' => $icon['name'],
			);
			if ( ! empty( $icon['color'] ) ) {
				$payload['color'] = $icon['color'];
			}
			return (string) wp_json_encode( $payload );
		}

		if ( 'image' === $type && ! empty( $icon['source'] ) ) {
			$attachment_id = $this->ensure_attachment_from_path( $icon['source'] );
			if ( $attachment_id > 0 ) {
				return (string) wp_json_encode(
					array(
						'type' => 'image',
						'id'   => $attachment_id,
					)
				);
			}
		}

		return '';
	}

	/**
	 * Copies a plugin-bundled image into uploads and creates an attachment
	 * for it (or returns the existing one keyed by filename). Returns the
	 * attachment ID, or 0 on failure. Idempotent across reseeds.
	 *
	 * @param string $source_path Absolute path to the source image file.
	 */
	private function ensure_attachment_from_path( string $source_path ): int {
		if ( ! file_exists( $source_path ) ) {
			return 0;
		}

		$filename = basename( $source_path );
		$existing = get_posts(
			array(
				'post_type'      => 'attachment',
				'name'           => sanitize_title( pathinfo( $filename, PATHINFO_FILENAME ) ),
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'post_status'    => 'inherit',
			)
		);
		if ( $existing ) {
			return (int) $existing[0];
		}

		$upload_dir = wp_upload_dir();
		if ( ! empty( $upload_dir['error'] ) ) {
			return 0;
		}

		$dest = trailingslashit( $upload_dir['path'] ) . wp_unique_filename( $upload_dir['path'], $filename );
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		if ( ! @copy( $source_path, $dest ) ) {
			return 0;
		}

		$filetype  = wp_check_filetype( $dest );
		$attach_id = wp_insert_attachment(
			array(
				'guid'           => trailingslashit( $upload_dir['url'] ) . basename( $dest ),
				'post_mime_type' => $filetype['type'] ?? 'image/png',
				'post_title'     => pathinfo( $filename, PATHINFO_FILENAME ),
				'post_content'   => '',
				'post_status'    => 'inherit',
			),
			$dest
		);
		if ( is_wp_error( $attach_id ) || ! $attach_id ) {
			return 0;
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		$metadata = wp_generate_attachment_metadata( $attach_id, $dest );
		wp_update_attachment_metadata( $attach_id, $metadata );

		return (int) $attach_id;
	}

	private function heading( string $text, int $level = 2 ): string {
		$level = max( 1, min( 6, $level ) );

		return sprintf(
			'<!-- wp:heading {"level":%1$d} --><h%1$d class="wp-block-heading">%2$s</h%1$d><!-- /wp:heading -->',
			$level,
			esc_html( $text )
		);
	}

	private function paragraph( string $text ): string {
		return sprintf(
			'<!-- wp:paragraph --><p>%s</p><!-- /wp:paragraph -->',
			esc_html( $text )
		);
	}

	private function data_view_block( int $collection_id ): string {
		if ( $collection_id <= 0 ) {
			return '';
		}

		$attributes = array(
			'collectionId' => $collection_id,
			'view'         => array(
				'type'    => 'table',
				'fields'  => array(),
				'sort'    => null,
				'filters' => array(),
				'perPage' => 25,
				'page'    => 1,
				'search'  => '',
				'layout'  => array(
					'density' => 'compact',
				),
			),
		);

		return sprintf(
			'<!-- wp:cortext/data-view %s /-->',
			wp_json_encode( $attributes )
		);
	}

	private function seed_collection( array $spec ): int {
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
			$existing_entry = get_post( (int) $entry_id );
			if ( $existing_entry ) {
				$existing_titles[] = $existing_entry->post_title;
			}
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

		return (int) $collection_id;
	}

	/**
	 * Seeds relation and rollup examples after all base collections exist.
	 *
	 * @param array<string,int> $collection_ids Collection IDs keyed by slug.
	 */
	private function seed_relationship_examples( array $collection_ids ): void {
		$projects_id = $collection_ids['projects'] ?? 0;
		$demo_id     = $collection_ids['demo'] ?? 0;
		$books_id    = $collection_ids['books'] ?? 0;

		if ( $projects_id > 0 && $demo_id > 0 ) {
			$tasks_relation = $this->ensure_relation_pair(
				$projects_id,
				'Tasks',
				$demo_id,
				'Project',
				true,
				false
			);

			$demo_fields = $this->attached_fields_by_title( $demo_id );
			$this->ensure_rollup_field(
				$projects_id,
				'Task count',
				$tasks_relation['source_id'],
				0,
				'count'
			);
			$this->ensure_rollup_field(
				$projects_id,
				'Task effort',
				$tasks_relation['source_id'],
				$demo_fields['Quantity'] ?? 0,
				'sum'
			);
			$this->ensure_rollup_field(
				$projects_id,
				'Task statuses',
				$tasks_relation['source_id'],
				$demo_fields['Status'] ?? 0,
				'show_unique'
			);
			$this->ensure_rollup_field(
				$projects_id,
				'Latest task due',
				$tasks_relation['source_id'],
				$demo_fields['Due'] ?? 0,
				'latest'
			);
			$this->ensure_rollup_field(
				$projects_id,
				'Task due range',
				$tasks_relation['source_id'],
				$demo_fields['Due'] ?? 0,
				'date_range'
			);

			$this->register_collection_entries( $projects_id );
			$this->register_collection_entries( $demo_id );

			$this->set_relation_by_titles(
				'projects',
				'Seed realistic demo workspace',
				$tasks_relation['source_id'],
				array(
					'Wire up the inline editor',
					'Document wp-env demo seed',
				)
			);
			$this->set_relation_by_titles(
				'projects',
				'Inline table editing polish',
				$tasks_relation['source_id'],
				array(
					'Polish the footer button',
					'Add keyboard traversal coverage',
				)
			);
		}

		if ( $books_id > 0 && $projects_id > 0 ) {
			$projects_relation = $this->ensure_relation_pair(
				$books_id,
				'Referenced projects',
				$projects_id,
				'Reference books',
				true,
				true
			);

			$project_fields = $this->attached_fields_by_title( $projects_id );
			$this->ensure_rollup_field(
				$books_id,
				'Project statuses',
				$projects_relation['source_id'],
				$project_fields['Status'] ?? 0,
				'show_unique'
			);
			$this->ensure_rollup_field(
				$books_id,
				'Project due range',
				$projects_relation['source_id'],
				$project_fields['Due'] ?? 0,
				'date_range'
			);

			$this->register_collection_entries( $books_id );
			$this->register_collection_entries( $projects_id );

			foreach ( $this->book_project_relations() as $book_title => $project_titles ) {
				$this->set_relation_by_titles(
					'books',
					$book_title,
					$projects_relation['source_id'],
					$project_titles
				);
			}
		}
	}

	/**
	 * Returns seeded Books -> Projects relation examples.
	 *
	 * @return array<string,string[]>
	 */
	private function book_project_relations(): array {
		return array(
			'Terre des Hommes'                   => array(
				'Seed realistic demo workspace',
				'Inline table editing polish',
			),
			'Die Welt als Wille und Vorstellung' => array(
				'Research relation fields',
			),
			'Cien Años de Soledad'               => array(
				'Collection public templates',
			),
			'The Left Hand of Darkness'          => array(
				'Research relation fields',
			),
			'Invisible Cities'                   => array(
				'Collection public templates',
			),
			'The Dispossessed'                   => array(
				'Seed realistic demo workspace',
				'DataViews view persistence',
			),
			'Ficciones'                          => array(
				'DataViews view persistence',
			),
			'The Master and Margarita'           => array(
				'Inline table editing polish',
			),
			'Things Fall Apart'                  => array(
				'Collection public templates',
				'Research relation fields',
			),
			'The Name of the Rose'               => array(
				'Seed realistic demo workspace',
			),
			'Kindred'                            => array(
				'Inline table editing polish',
				'DataViews view persistence',
			),
			'The Rings of Saturn'                => array(
				'Research relation fields',
			),
			'Beloved'                            => array(
				'Collection public templates',
			),
			'The Trial'                          => array(
				'Inline table editing polish',
			),
			'Mrs Dalloway'                       => array(
				'Seed realistic demo workspace',
			),
			'Pedro Páramo'                       => array(
				'DataViews view persistence',
			),
			'Season of Migration to the North'   => array(
				'Research relation fields',
			),
			'The Tale of Genji'                  => array(
				'Collection public templates',
			),
			'The Vegetarian'                     => array(
				'Inline table editing polish',
				'Research relation fields',
			),
			'Pale Fire'                          => array(
				'DataViews view persistence',
			),
			'The Savage Detectives'              => array(
				'Seed realistic demo workspace',
				'Research relation fields',
			),
			'Austerlitz'                         => array(
				'DataViews view persistence',
			),
			'The Passion According to G.H.'      => array(
				'Collection public templates',
			),
			'Midnight’s Children'                => array(
				'Inline table editing polish',
			),
			'The God of Small Things'            => array(
				'Seed realistic demo workspace',
			),
			'Snow Country'                       => array(
				'Research relation fields',
			),
			'The Invention of Morel'             => array(
				'DataViews view persistence',
			),
			'The Sound and the Fury'             => array(
				'Inline table editing polish',
				'Collection public templates',
			),
			'The Leopard'                        => array(
				'Seed realistic demo workspace',
			),
			'Parable of the Sower'               => array(
				'Research relation fields',
			),
		);
	}

	/**
	 * Ensures a bidirectional relation field pair exists.
	 *
	 * @param int    $source_collection_id Source collection ID.
	 * @param string $source_title         Source relation field title.
	 * @param int    $target_collection_id Target collection ID.
	 * @param string $reverse_title        Reverse relation field title.
	 * @param bool   $source_multiple      Whether source accepts multiple rows.
	 * @param bool   $reverse_multiple     Whether reverse accepts multiple rows.
	 * @return array{source_id:int,reverse_id:int}
	 */
	private function ensure_relation_pair(
		int $source_collection_id,
		string $source_title,
		int $target_collection_id,
		string $reverse_title,
		bool $source_multiple,
		bool $reverse_multiple
	): array {
		$source_id  = $this->ensure_field_post( $source_collection_id, $source_title );
		$reverse_id = (int) get_post_meta( $source_id, 'relation_reverse_field_id', true );

		if ( $reverse_id < 1 || Field::POST_TYPE !== get_post_type( $reverse_id ) ) {
			$reverse_id = $this->ensure_field_post( $target_collection_id, $reverse_title );
		}

		$this->update_relation_field_meta(
			$source_id,
			$target_collection_id,
			$reverse_id,
			$source_multiple
		);
		$this->update_relation_field_meta(
			$reverse_id,
			$source_collection_id,
			$source_id,
			$reverse_multiple
		);

		WP_CLI::log(
			sprintf(
				"Seeded relation '%s' (ID %d) <-> '%s' (ID %d).",
				$source_title,
				$source_id,
				$reverse_title,
				$reverse_id
			)
		);

		return array(
			'source_id'  => $source_id,
			'reverse_id' => $reverse_id,
		);
	}

	private function update_relation_field_meta(
		int $field_id,
		int $related_collection_id,
		int $reverse_id,
		bool $multiple
	): void {
		update_post_meta( $field_id, 'type', 'relation' );
		update_post_meta( $field_id, 'related_collection_id', (string) $related_collection_id );
		update_post_meta( $field_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $field_id, 'relation_multiple', $multiple ? '1' : '0' );
	}

	private function ensure_rollup_field(
		int $collection_id,
		string $title,
		int $relation_field_id,
		int $target_field_id,
		string $aggregator
	): int {
		$field_id = $this->ensure_field_post( $collection_id, $title );

		update_post_meta( $field_id, 'type', 'rollup' );
		update_post_meta( $field_id, 'rollup_relation_field_id', (string) $relation_field_id );
		update_post_meta( $field_id, 'rollup_aggregator', $aggregator );
		$this->delete_rollup_target_meta( $field_id );

		if ( $target_field_id > 0 ) {
			update_post_meta( $field_id, 'rollup_target_field_id', (string) $target_field_id );
			foreach ( $this->rollup_target_meta( $target_field_id ) as $key => $value ) {
				update_post_meta( $field_id, $key, $value );
			}
		} else {
			delete_post_meta( $field_id, 'rollup_target_field_id' );
		}

		WP_CLI::log(
			sprintf(
				"Seeded rollup '%s' (ID %d, aggregator: %s).",
				$title,
				$field_id,
				$aggregator
			)
		);

		return $field_id;
	}

	/**
	 * Copies target display metadata onto a seeded rollup field.
	 *
	 * @param int $target_field_id Target field post ID.
	 * @return array<string,string>
	 */
	private function rollup_target_meta( int $target_field_id ): array {
		$target_type = (string) get_post_meta( $target_field_id, 'type', true );
		$meta        = array();

		if ( '' !== $target_type ) {
			$meta['rollup_target_type'] = $target_type;
		}

		foreach (
			array(
				'options'               => 'rollup_target_options',
				'number_format'         => 'rollup_target_number_format',
				'date_format'           => 'rollup_target_date_format',
				'related_collection_id' => 'rollup_target_related_collection_id',
				'relation_multiple'     => 'rollup_target_relation_multiple',
			) as $source_key => $rollup_key
		) {
			$value = get_post_meta( $target_field_id, $source_key, true );
			if ( '' !== $value && null !== $value ) {
				$meta[ $rollup_key ] = (string) $value;
			}
		}

		return $meta;
	}

	private function delete_rollup_target_meta( int $field_id ): void {
		foreach (
			array(
				'rollup_target_type',
				'rollup_target_options',
				'rollup_target_number_format',
				'rollup_target_date_format',
				'rollup_target_related_collection_id',
				'rollup_target_relation_multiple',
			) as $meta_key
		) {
			delete_post_meta( $field_id, $meta_key );
		}
	}

	private function ensure_field_post( int $collection_id, string $title ): int {
		$field_id = $this->find_attached_field(
			$title,
			get_post_meta( $collection_id, 'fields', false )
		);

		if ( $field_id ) {
			return $field_id;
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

		add_post_meta( $collection_id, 'fields', (string) $field_id );
		WP_CLI::log( "Created field '{$title}' (ID {$field_id})." );

		return (int) $field_id;
	}

	/**
	 * Returns attached field IDs keyed by post title.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return array<string,int>
	 */
	private function attached_fields_by_title( int $collection_id ): array {
		$fields = array();
		foreach ( get_post_meta( $collection_id, 'fields', false ) as $field_id ) {
			$field = get_post( (int) $field_id );
			if ( $field && Field::POST_TYPE === $field->post_type ) {
				$fields[ $field->post_title ] = (int) $field->ID;
			}
		}
		return $fields;
	}

	/**
	 * Replaces a seeded relation value by matching row titles.
	 *
	 * @param string   $source_slug   Source collection slug.
	 * @param string   $source_title  Source row title.
	 * @param int      $field_id      Source relation field ID.
	 * @param string[] $target_titles Target row titles.
	 */
	private function set_relation_by_titles(
		string $source_slug,
		string $source_title,
		int $field_id,
		array $target_titles
	): void {
		$source_id = $this->entry_id_by_title( $source_slug, $source_title );
		if ( $source_id < 1 ) {
			WP_CLI::warning( "Could not seed relation for missing row '{$source_title}'." );
			return;
		}

		$target_collection_id = (int) get_post_meta( $field_id, 'related_collection_id', true );
		$target_slug          = (string) get_post_meta( $target_collection_id, 'slug', true );
		$target_ids           = array();

		foreach ( $target_titles as $target_title ) {
			$target_id = $this->entry_id_by_title( $target_slug, $target_title );
			if ( $target_id < 1 ) {
				WP_CLI::warning( "Could not seed relation target '{$target_title}'." );
				continue;
			}
			$target_ids[] = $target_id;
		}

		$result = Relations::sync_relation_value( $source_id, $field_id, $target_ids );
		if ( is_wp_error( $result ) ) {
			WP_CLI::warning(
				sprintf(
					"Could not seed relation for '%s': %s",
					$source_title,
					$result->get_error_message()
				)
			);
		}
	}

	private function entry_id_by_title( string $collection_slug, string $title ): int {
		if ( '' === $collection_slug ) {
			return 0;
		}

		$entry_cpt = CollectionEntries::CPT_PREFIX . $collection_slug;
		$entries   = get_posts(
			array(
				'post_type'   => $entry_cpt,
				'post_status' => array( 'draft', 'private', 'publish' ),
				'title'       => $title,
				'numberposts' => 1,
				'fields'      => 'ids',
			)
		);

		return $entries ? (int) $entries[0] : 0;
	}

	private function register_collection_entries( int $collection_id ): void {
		$collection = get_post( $collection_id );
		if ( $collection ) {
			( new CollectionEntries() )->register_for_collection( $collection );
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

		if ( delete_metadata( 'user', 0, self::WORKSPACE_HOME_META_KEY, '', true ) ) {
			WP_CLI::log( 'Deleted workspace home preferences.' );
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
