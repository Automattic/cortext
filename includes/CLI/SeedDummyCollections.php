<?php
/**
 * WP-CLI command to seed sample collections with dummy data.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\CLI;

use Cortext\Media\CortextMedia;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_CLI;
use WP_CLI_Command;

final class SeedDummyCollections extends WP_CLI_Command {

	private const WORKSPACE_HOME_META_KEY = 'cortext_workspace_home';
	private const FAVORITES_META_KEY      = 'cortext_favorites';
	private const PAGE_CONTENT_VERSION    = 'rich-connected-seed-2026-05-28-universal-document-model';
	private const ENTRY_CONTENT_VERSION   = 'rich-connected-row-seed-2026-05-07';

	private bool $seed_full_dataset = false;
	private bool $fetch_real_images = false;

	/**
	 * Seeds connected sample collections (books/authors/publishers,
	 * music/albums/labels, projects/tasks/people) plus a realistic page
	 * hierarchy with embedded collection views.
	 *
	 * Idempotent: skips anything that already exists, unless --reset is passed.
	 *
	 * ## OPTIONS
	 *
	 * [--reset]
	 * : Delete all Cortext data, workspace home preferences, and sidebar favorites before seeding.
	 * Prompts for confirmation unless --force is also passed.
	 *
	 * [--force]
	 * : Skip the confirmation prompt when using --reset.
	 *
	 * [--full]
	 * : Seed the full demo catalog. By default, only a compact set of
	 * representative rows is seeded.
	 *
	 * [--prefetch-icons]
	 * : Resolve every row icon URL and download the image into
	 * `seed-assets/icons/` so the file is bundled in the repo. Future seed
	 * runs short-circuit to the bundled file via `ensure_attachment_from_path`,
	 * so worktrees come up in seconds without hitting Wikidata or Picsum.
	 * Combine with `--full` to bundle the entire catalog.
	 *
	 * [--with-real-images]
	 * : Fetch the actual book/album cover from Open Library and Cover Art
	 * Archive at seed time. Used as the row's cover image, and as the row's
	 * icon when no Wikimedia Commons portrait/cover is available (so a
	 * Discworld book row gets its real cover instead of a picsum fallback).
	 * Cached via WP transients so a `--reset` reseed reuses prior lookups.
	 * Images stay in the WP media library, never in the repo, so the
	 * plugin doesn't redistribute publishers' artwork.
	 *
	 * [--prefetch-covers]
	 * : Like `--prefetch-icons` but for real covers. Downloads each book/album
	 * cover into `seed-assets/covers/` so worktrees can ship offline. Existing
	 * bundle files are preserved, so manually-curated covers (e.g., a public-
	 * domain stand-in) survive prefetching.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext seed
	 *     wp cortext seed --full
	 *     wp cortext seed --reset
	 *     wp cortext seed --reset --force
	 *     wp cortext seed --reset --force --full
	 *     wp cortext seed --prefetch-icons --full
	 *     wp cortext seed --reset --force --with-real-images
	 *     wp cortext seed --prefetch-covers --full
	 *
	 * @when after_wp_load
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function __invoke( array $args, array $assoc_args ): void {
		if ( WP_CLI\Utils\get_flag_value( $assoc_args, 'prefetch-icons', false ) ) {
			$this->seed_full_dataset = WP_CLI\Utils\get_flag_value( $assoc_args, 'full', false );
			$this->prefetch_icons();
			return;
		}

		if ( WP_CLI\Utils\get_flag_value( $assoc_args, 'prefetch-covers', false ) ) {
			$this->seed_full_dataset = WP_CLI\Utils\get_flag_value( $assoc_args, 'full', false );
			$this->prefetch_covers();
			return;
		}

		$this->fetch_real_images = WP_CLI\Utils\get_flag_value( $assoc_args, 'with-real-images', false );

		// Run as an administrator so seeded entries get a real `post_author`
		// (otherwise CLI's user-0 context produces empty Created by /
		// Last edited by columns) and the save_post hook records
		// `_modified_by` against the same user.
		$seed_user_id = $this->default_seed_user_id();
		wp_set_current_user( $seed_user_id );

		$this->seed_full_dataset = WP_CLI\Utils\get_flag_value( $assoc_args, 'full', false );

		if ( WP_CLI\Utils\get_flag_value( $assoc_args, 'reset', false ) ) {
			WP_CLI::confirm(
				'This will delete all Cortext collections, fields, entries, pages, workspace home preferences, and sidebar favorites. Continue?',
				array( 'yes' => WP_CLI\Utils\get_flag_value( $assoc_args, 'force', false ) )
			);
			$this->reset();
		}

		$collections = array_merge(
			$this->literature_collections(),
			$this->music_collections(),
			$this->work_collections()
		);
		if ( $this->seed_full_dataset ) {
			WP_CLI::log( 'Seeding full demo dataset.' );
		} else {
			WP_CLI::log( 'Seeding compact demo dataset. Pass --full to include every sample row.' );
			$collections = $this->compact_collection_entries( $collections );
		}
		if ( $this->fetch_real_images ) {
			WP_CLI::log( 'Row images: bundle first, then live Wikimedia Commons / Open Library / Cover Art Archive for misses (per-file license, see each source).' );
		} else {
			WP_CLI::log( 'Row images: bundle only (offline). Pass --with-real-images for live Wikimedia / Open Library / Cover Art Archive lookups, or --prefetch-icons to extend the bundle.' );
		}

		$collection_ids = array();
		foreach ( $collections as $spec ) {
			$collection_ids[ $spec['slug'] ] = $this->seed_collection( $spec );
		}

		$this->seed_relationship_examples( $collection_ids );

		$column_orders = $this->canonical_column_orders();
		foreach ( $collection_ids as $slug => $collection_id ) {
			if ( $collection_id < 1 || empty( $column_orders[ $slug ] ) ) {
				continue;
			}
			$this->reorder_collection_fields_by_titles( $collection_id, $column_orders[ $slug ] );
		}

		$workspace_page_id = $this->seed_pages( $collection_ids );
		$this->nest_collections_under_pages( $collection_ids );
		$this->seed_workspace_home( $seed_user_id, $workspace_page_id );
		$this->seed_favorites( $seed_user_id, $workspace_page_id );

		WP_CLI::success( 'Seeding complete.' );
	}

	/**
	 * Anchors seeded collections under a thematic page so the sidebar tree
	 * shows them as children instead of as top-level siblings. Matches what
	 * the data-view block's `CollectionCreator` does when a user creates a
	 * collection from inside a page (sets `post_parent` to that page).
	 *
	 * @param array<string,int> $collection_ids Collection IDs keyed by slug.
	 */
	private function nest_collections_under_pages( array $collection_ids ): void {
		$map = array(
			'projects'   => 'Scratch Notes',
			'tasks'      => 'Scratch Notes',
			'people'     => 'Scratch Notes',
			'books'      => 'Library',
			'authors'    => 'Library',
			'publishers' => 'Library',
			'albums'     => 'Music Catalog',
			'tracks'     => 'Music Catalog',
			'musicians'  => 'Music Catalog',
			'labels'     => 'Music Catalog',
		);

		$page_ids = array();
		foreach ( array_unique( array_values( $map ) ) as $page_title ) {
			$page_ids[ $page_title ] = $this->find_top_level_page_id( $page_title );
		}

		foreach ( $map as $slug => $page_title ) {
			$collection_id = (int) ( $collection_ids[ $slug ] ?? 0 );
			$parent_id     = (int) ( $page_ids[ $page_title ] ?? 0 );
			if ( $collection_id < 1 || $parent_id < 1 ) {
				continue;
			}
			$collection = get_post( $collection_id );
			if ( ! $collection instanceof \WP_Post || (int) $collection->post_parent === $parent_id ) {
				continue;
			}
			wp_update_post(
				array(
					'ID'          => $collection_id,
					'post_parent' => $parent_id,
				)
			);
		}
	}

	/**
	 * Looks up a seeded top-level page by title. Returns 0 when no match,
	 * which `nest_collections_under_pages` treats as "skip".
	 *
	 * @param string $title Page title.
	 */
	private function find_top_level_page_id( string $title ): int {
		$ids = get_posts(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				'post_parent' => 0,
				'title'       => $title,
				'numberposts' => 1,
				'fields'      => 'ids',
			)
		);
		return $ids ? (int) $ids[0] : 0;
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
	 * Keeps the default seed light while preserving representative relations.
	 *
	 * @param array<int,array<string,mixed>> $collections Collection specs.
	 * @return array<int,array<string,mixed>>
	 */
	private function compact_collection_entries( array $collections ): array {
		$titles_by_slug = $this->compact_seed_entry_titles();

		foreach ( $collections as $index => $collection ) {
			$slug = (string) ( $collection['slug'] ?? '' );
			if ( '' === $slug || empty( $titles_by_slug[ $slug ] ) || empty( $collection['entries'] ) || ! is_array( $collection['entries'] ) ) {
				continue;
			}

			$allowed_titles                   = array_fill_keys( $titles_by_slug[ $slug ], true );
			$collections[ $index ]['entries'] = array_values(
				array_filter(
					$collection['entries'],
					static fn( array $entry ): bool => isset( $entry['title'] ) && isset( $allowed_titles[ (string) $entry['title'] ] )
				)
			);
		}

		return $collections;
	}

	/**
	 * Returns the row titles included by default.
	 *
	 * @return array<string,string[]>
	 */
	private function compact_seed_entry_titles(): array {
		return array(
			'authors'    => array(
				'Virginia Woolf',
				'Franz Kafka',
				'Mary Shelley',
				'Gabriel Garcia Marquez',
				'Toni Morrison',
				'Terry Pratchett',
			),
			'publishers' => array(
				'Penguin Classics',
				'Vintage',
				'Everyman Library',
				'Gollancz',
			),
			// Compact mode favors classics whose covers exist on Wikimedia
			// Commons (most modern covers are fair-use only and don't), so
			// reseeded rows get real images instead of falling back to picsum.
			// Discworld titles are included by request even though their
			// covers aren't on Commons; they fall back to picsum.
			'books'      => array(
				'Mrs Dalloway',
				'The Trial',
				'Frankenstein',
				'One Hundred Years of Solitude',
				'Beloved',
				'The Colour of Magic',
				'Mort',
				'Guards! Guards!',
				'Small Gods',
				'Hogfather',
				'Going Postal',
			),
			// Compact mode favors musicians and albums whose covers/portraits
			// exist on Wikimedia Commons (most modern album art is fair-use
			// only and doesn't), so reseeded rows get real images instead of
			// falling back to picsum. Fall Out Boy and Los Ángeles Azules are
			// included by request: their portraits work, but their album
			// covers fall back to picsum.
			'musicians'  => array(
				'The Beatles',
				'Pink Floyd',
				'Prince',
				'Miles Davis',
				'Fall Out Boy',
				'Los Ángeles Azules',
			),
			'labels'     => array(
				'Apple Records',
				'Harvest',
				'Warner Bros. Records',
				'Columbia',
				'Fueled by Ramen',
				'Island',
				'Disa',
			),
			'albums'     => array(
				'Abbey Road',
				'Sgt. Peppers Lonely Hearts Club Band',
				'The Dark Side of the Moon',
				'The Wall',
				'Purple Rain',
				'Take This to Your Grave',
				'From Under the Cork Tree',
				'Infinity on High',
				'Save Rock and Roll',
				'El Listón de tu Pelo',
				'Cómo te voy a olvidar',
				'De Buenas Raíces',
			),
			// Compact mode skips tracks: the new compact musicians/albums
			// (Beatles, Pink Floyd, Prince, Miles Davis) don't have track-level
			// rows in this seed, so leaving the list empty keeps relations
			// consistent. Use --full to seed tracks.
			'tracks'     => array(),
			'people'     => array(
				'Miguel Fonseca',
				'Hector Prieto',
				'Iris Okafor',
				'Nora Singh',
			),
			'projects'   => array(
				'Seed knowledge workspace',
				'Relation field polish',
				'Row detail editing',
			),
			'tasks'      => array(
				'Replace flat seed tables with connected data',
				'Seed author rollups from related books',
				'Create album track rollups',
				'Rewrite workspace landing page content',
				'Add richer research page blocks',
				'Add people ownership relation',
				'Audit row detail read-only relation fields',
			),
		);
	}

	private function select_field( array $options ): array {
		return array(
			'type'    => 'select',
			'options' => $this->field_options( $options ),
		);
	}

	private function multiselect_field( array $options ): array {
		return array(
			'type'    => 'multiselect',
			'options' => $this->field_options( $options ),
		);
	}

	/**
	 * Builds a number field spec with a stored `number_format` so the cell
	 * renders with the chosen visualization (bar/ring/percent/etc.) at seed
	 * time. The `$format` array goes through `wp_json_encode` and lands on
	 * the field post's `number_format` meta.
	 *
	 * @param array<string,mixed> $format Format config (e.g. `['display' => 'bar']`).
	 */
	private function number_field( array $format ): array {
		return array(
			'type'          => 'number',
			'number_format' => $format,
		);
	}

	/**
	 * Builds option records from `label => color` maps.
	 *
	 * @param array<string,string> $options Options keyed by display label.
	 * @return array<int,array{value:string,label:string,color:string}>
	 */
	private function field_options( array $options ): array {
		$records = array();
		foreach ( $options as $label => $color ) {
			$records[] = array(
				'value' => (string) $label,
				'label' => (string) $label,
				'color' => (string) $color,
			);
		}
		return $records;
	}

	/**
	 * Returns the literature collection specs.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	private function literature_collections(): array {
		return array(
			array(
				'title'   => 'Authors',
				'slug'    => 'authors',
				'icon'    => '✍️',
				'fields'  => array(
					'Country' => 'text',
					'Born'    => 'number',
					'Era'     => $this->select_field(
						array(
							'Classical'     => 'purple',
							'Modernist'     => 'blue',
							'Postwar'       => 'green',
							'Contemporary'  => 'pink',
							'Golden Age SF' => 'yellow',
						)
					),
					'Genres'  => $this->multiselect_field(
						array(
							'Fiction'         => 'blue',
							'Essays'          => 'gray',
							'Science fiction' => 'purple',
							'Magical realism' => 'pink',
							'Philosophy'      => 'brown',
							'Mystery'         => 'orange',
							'Poetry'          => 'yellow',
						)
					),
					'Website' => 'url',
					'Notes'   => 'text',
				),
				'entries' => array(
					array(
						'title'   => 'Ursula K. Le Guin',
						'Country' => 'United States',
						'Born'    => 1929,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Science fiction', 'Essays' ),
						'Website' => 'https://www.ursulakleguin.com/',
						'Notes'   => 'Speculative fiction with anthropology, politics, and language at the center.',
					),
					array(
						'title'   => 'Octavia E. Butler',
						'Country' => 'United States',
						'Born'    => 1947,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Science fiction', 'Fiction' ),
						'Website' => '',
						'Notes'   => 'Sharp social speculation across power, kinship, survival, and change.',
					),
					array(
						'title'   => 'Gabriel Garcia Marquez',
						'Country' => 'Colombia',
						'Born'    => 1927,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Magical realism', 'Fiction' ),
						'Website' => '',
						'Notes'   => 'A central voice of the Latin American Boom.',
					),
					array(
						'title'   => 'Toni Morrison',
						'Country' => 'United States',
						'Born'    => 1931,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Fiction', 'Essays' ),
						'Website' => '',
						'Notes'   => 'Novels about memory, inheritance, language, and American history.',
					),
					array(
						'title'   => 'Virginia Woolf',
						'Country' => 'United Kingdom',
						'Born'    => 1882,
						'Era'     => 'Modernist',
						'Genres'  => array( 'Fiction', 'Essays' ),
						'Website' => '',
						'Notes'   => 'Modernist experiments in consciousness, form, and time.',
					),
					array(
						'title'   => 'Franz Kafka',
						'Country' => 'Czech Republic',
						'Born'    => 1883,
						'Era'     => 'Modernist',
						'Genres'  => array( 'Fiction' ),
						'Website' => '',
						'Notes'   => 'Compressed parables of bureaucracy, guilt, and estrangement.',
					),
					array(
						'title'   => 'Italo Calvino',
						'Country' => 'Italy',
						'Born'    => 1923,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Fiction', 'Essays' ),
						'Website' => '',
						'Notes'   => 'Formal play, fables, cities, readers, and combinatorial structures.',
					),
					array(
						'title'   => 'Jorge Luis Borges',
						'Country' => 'Argentina',
						'Born'    => 1899,
						'Era'     => 'Modernist',
						'Genres'  => array( 'Fiction', 'Essays', 'Poetry' ),
						'Website' => '',
						'Notes'   => 'Libraries, labyrinths, mirrors, false scholarship, and infinities.',
					),
					array(
						'title'   => 'Chinua Achebe',
						'Country' => 'Nigeria',
						'Born'    => 1930,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Fiction', 'Essays' ),
						'Website' => '',
						'Notes'   => 'A foundational novelist of modern African literature.',
					),
					array(
						'title'   => 'Clarice Lispector',
						'Country' => 'Brazil',
						'Born'    => 1920,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Fiction' ),
						'Website' => '',
						'Notes'   => 'Interior pressure, philosophical intensity, and unusual syntax.',
					),
					array(
						'title'   => 'Murasaki Shikibu',
						'Country' => 'Japan',
						'Born'    => 973,
						'Era'     => 'Classical',
						'Genres'  => array( 'Fiction', 'Poetry' ),
						'Website' => '',
						'Notes'   => 'Courtly observation and one of the earliest long-form novels.',
					),
					array(
						'title'   => 'Arthur C. Clarke',
						'Country' => 'United Kingdom',
						'Born'    => 1917,
						'Era'     => 'Golden Age SF',
						'Genres'  => array( 'Science fiction', 'Essays' ),
						'Website' => '',
						'Notes'   => 'Big engineering, cosmic timescales, and first-contact wonder.',
					),
					array(
						'title'   => 'Mary Shelley',
						'Country' => 'United Kingdom',
						'Born'    => 1797,
						'Era'     => 'Classical',
						'Genres'  => array( 'Fiction', 'Science fiction' ),
						'Website' => '',
						'Notes'   => 'Gothic invention and one of science fiction’s origin points.',
					),
					array(
						'title'   => 'N. K. Jemisin',
						'Country' => 'United States',
						'Born'    => 1972,
						'Era'     => 'Contemporary',
						'Genres'  => array( 'Science fiction', 'Fiction' ),
						'Website' => 'https://nkjemisin.com/',
						'Notes'   => 'Epic speculative fiction about systems, trauma, and survival.',
					),
					array(
						'title'   => 'Kazuo Ishiguro',
						'Country' => 'United Kingdom',
						'Born'    => 1954,
						'Era'     => 'Contemporary',
						'Genres'  => array( 'Fiction', 'Science fiction' ),
						'Website' => '',
						'Notes'   => 'Memory, restraint, duty, and unreliable self-knowledge.',
					),
					array(
						'title'   => 'Umberto Eco',
						'Country' => 'Italy',
						'Born'    => 1932,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Fiction', 'Essays', 'Mystery' ),
						'Website' => '',
						'Notes'   => 'Semiotics, medieval history, conspiracy, and literary games.',
					),
					array(
						'title'   => 'Roberto Bolano',
						'Country' => 'Chile',
						'Born'    => 1953,
						'Era'     => 'Contemporary',
						'Genres'  => array( 'Fiction', 'Poetry' ),
						'Website' => '',
						'Notes'   => 'Writers, detectives, exile, violence, and literary obsession.',
					),
					array(
						'title'   => 'Han Kang',
						'Country' => 'South Korea',
						'Born'    => 1970,
						'Era'     => 'Contemporary',
						'Genres'  => array( 'Fiction' ),
						'Website' => '',
						'Notes'   => 'Spare, unsettling fiction about bodies, refusal, and violence.',
					),
					array(
						'title'   => 'Mikhail Bulgakov',
						'Country' => 'Russia',
						'Born'    => 1891,
						'Era'     => 'Modernist',
						'Genres'  => array( 'Fiction' ),
						'Website' => '',
						'Notes'   => 'Satire, fantasy, theatre, and Soviet absurdity.',
					),
					array(
						'title'   => 'Salman Rushdie',
						'Country' => 'United Kingdom',
						'Born'    => 1947,
						'Era'     => 'Postwar',
						'Genres'  => array( 'Fiction', 'Magical realism', 'Essays' ),
						'Website' => '',
						'Notes'   => 'Polyphonic historical fiction and exuberant language.',
					),
					array(
						'title'   => 'Terry Pratchett',
						'Country' => 'United Kingdom',
						'Born'    => 1948,
						'Era'     => 'Contemporary',
						'Genres'  => array( 'Fiction' ),
						'Website' => 'https://www.terrypratchettbooks.com/',
						'Notes'   => 'Discworld satire, comic fantasy, and 41 novels of moral comedy.',
					),
				),
			),
			array(
				'title'   => 'Publishers',
				'slug'    => 'publishers',
				'icon'    => '🏛️',
				'fields'  => array(
					'Country' => 'text',
					'Founded' => 'number',
					'Focus'   => $this->multiselect_field(
						array(
							'Literary fiction' => 'blue',
							'Classics'         => 'purple',
							'Speculative'      => 'pink',
							'Translations'     => 'green',
							'Academic'         => 'brown',
							'Paperbacks'       => 'orange',
							'Poetry'           => 'yellow',
						)
					),
					'Website' => 'url',
					'Notes'   => 'text',
				),
				'entries' => array(
					array(
						'title'   => 'Penguin Classics',
						'Country' => 'United Kingdom',
						'Founded' => 1946,
						'Focus'   => array( 'Classics', 'Paperbacks' ),
						'Website' => 'https://www.penguin.co.uk/',
						'Notes'   => 'Canonical paperback editions and broad classroom reach.',
					),
					array(
						'title'   => 'Vintage',
						'Country' => 'United States',
						'Founded' => 1954,
						'Focus'   => array( 'Literary fiction', 'Paperbacks' ),
						'Website' => 'https://www.penguinrandomhouse.com/',
						'Notes'   => 'Backlist-friendly literary paperback imprint.',
					),
					array(
						'title'   => 'Faber and Faber',
						'Country' => 'United Kingdom',
						'Founded' => 1929,
						'Focus'   => array( 'Literary fiction', 'Poetry' ),
						'Website' => 'https://www.faber.co.uk/',
						'Notes'   => 'Poetry, drama, and literary fiction with a strong design lineage.',
					),
					array(
						'title'   => 'Farrar Straus and Giroux',
						'Country' => 'United States',
						'Founded' => 1946,
						'Focus'   => array( 'Literary fiction', 'Translations' ),
						'Website' => 'https://us.macmillan.com/fsg/',
						'Notes'   => 'Literary fiction, criticism, and international authors.',
					),
					array(
						'title'   => 'Gollancz',
						'Country' => 'United Kingdom',
						'Founded' => 1927,
						'Focus'   => array( 'Speculative', 'Paperbacks' ),
						'Website' => 'https://www.gollancz.co.uk/',
						'Notes'   => 'Science fiction and fantasy with a deep genre backlist.',
					),
					array(
						'title'   => 'New Directions',
						'Country' => 'United States',
						'Founded' => 1936,
						'Focus'   => array( 'Translations', 'Literary fiction', 'Poetry' ),
						'Website' => 'https://www.ndbooks.com/',
						'Notes'   => 'International modernism, poetry, and experimental literature.',
					),
					array(
						'title'   => 'Minotauro',
						'Country' => 'Spain',
						'Founded' => 1955,
						'Focus'   => array( 'Speculative', 'Translations' ),
						'Website' => '',
						'Notes'   => 'Spanish-language speculative catalog and genre classics.',
					),
					array(
						'title'   => 'Everyman Library',
						'Country' => 'United Kingdom',
						'Founded' => 1906,
						'Focus'   => array( 'Classics' ),
						'Website' => 'https://www.everymanslibrary.co.uk/',
						'Notes'   => 'Durable editions for classics and modern classics.',
					),
					array(
						'title'   => 'Orbit',
						'Country' => 'United Kingdom',
						'Founded' => 1974,
						'Focus'   => array( 'Speculative' ),
						'Website' => 'https://www.orbitbooks.net/',
						'Notes'   => 'Science fiction and fantasy frontlist and backlist.',
					),
					array(
						'title'   => 'Seagull Books',
						'Country' => 'India',
						'Founded' => 1982,
						'Focus'   => array( 'Translations', 'Academic' ),
						'Website' => 'https://www.seagullbooks.org/',
						'Notes'   => 'Translations, theory, theatre, and humanities-oriented publishing.',
					),
				),
			),
			array(
				'title'   => 'Books',
				'slug'    => 'books',
				'icon'    => '📚',
				'fields'  => array(
					'Year'   => 'number',
					'Genre'  => $this->select_field(
						array(
							'Novel'           => 'blue',
							'Short stories'   => 'purple',
							'Science fiction' => 'pink',
							'Fantasy'         => 'orange',
							'Essays'          => 'gray',
							'Classic'         => 'brown',
							'Mystery'         => 'green',
						)
					),
					'Pages'  => 'number',
					'Status' => $this->select_field(
						array(
							'Unread'    => 'gray',
							'Reading'   => 'yellow',
							'Finished'  => 'green',
							'Reference' => 'blue',
							'Wishlist'  => 'pink',
						)
					),
					'Rating' => 'number',
					'Read?'  => 'checkbox',
					'Notes'  => 'text',
				),
				'entries' => array(
					array(
						'title'  => 'The Left Hand of Darkness',
						'Year'   => 1969,
						'Genre'  => 'Science fiction',
						'Pages'  => 304,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Winter, kinship, diplomacy, and gender as worldbuilding.',
					),
					array(
						'title'  => 'The Dispossessed',
						'Year'   => 1974,
						'Genre'  => 'Science fiction',
						'Pages'  => 387,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'A political thought experiment that still reads as character work.',
					),
					array(
						'title'  => 'A Wizard of Earthsea',
						'Year'   => 1968,
						'Genre'  => 'Fantasy',
						'Pages'  => 205,
						'Status' => 'Reference',
						'Rating' => 4,
						'Read?'  => true,
						'Notes'  => 'Compact mythic structure and naming as power.',
					),
					array(
						'title'  => 'Kindred',
						'Year'   => 1979,
						'Genre'  => 'Science fiction',
						'Pages'  => 288,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Time travel stripped down to historical consequence.',
					),
					array(
						'title'  => 'Parable of the Sower',
						'Year'   => 1993,
						'Genre'  => 'Science fiction',
						'Pages'  => 345,
						'Status' => 'Reading',
						'Rating' => 5,
						'Read?'  => false,
						'Notes'  => 'Near-future collapse, community, and a portable belief system.',
					),
					array(
						'title'  => 'Dawn',
						'Year'   => 1987,
						'Genre'  => 'Science fiction',
						'Pages'  => 248,
						'Status' => 'Wishlist',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'First Xenogenesis volume for the next Butler pass.',
					),
					array(
						'title'  => 'One Hundred Years of Solitude',
						'Year'   => 1967,
						'Genre'  => 'Novel',
						'Pages'  => 417,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Family history as weather system and myth.',
					),
					array(
						'title'  => 'Love in the Time of Cholera',
						'Year'   => 1985,
						'Genre'  => 'Novel',
						'Pages'  => 348,
						'Status' => 'Unread',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Queued for the Latin American shelf.',
					),
					array(
						'title'  => 'Beloved',
						'Year'   => 1987,
						'Genre'  => 'Novel',
						'Pages'  => 324,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'A ghost story about historical memory and motherhood.',
					),
					array(
						'title'  => 'Song of Solomon',
						'Year'   => 1977,
						'Genre'  => 'Novel',
						'Pages'  => 337,
						'Status' => 'Reading',
						'Rating' => 4,
						'Read?'  => false,
						'Notes'  => 'Family myth, flight, and inheritance.',
					),
					array(
						'title'  => 'Mrs Dalloway',
						'Year'   => 1925,
						'Genre'  => 'Novel',
						'Pages'  => 194,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'One-day structure, social surfaces, interior pressure.',
					),
					array(
						'title'  => 'To the Lighthouse',
						'Year'   => 1927,
						'Genre'  => 'Novel',
						'Pages'  => 209,
						'Status' => 'Unread',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Paired with the modernist reading notes page.',
					),
					array(
						'title'  => 'The Trial',
						'Year'   => 1925,
						'Genre'  => 'Classic',
						'Pages'  => 255,
						'Status' => 'Finished',
						'Rating' => 4,
						'Read?'  => true,
						'Notes'  => 'Bureaucratic nightmare as dream logic.',
					),
					array(
						'title'  => 'The Castle',
						'Year'   => 1926,
						'Genre'  => 'Classic',
						'Pages'  => 352,
						'Status' => 'Wishlist',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Useful comparison for institutional mazes.',
					),
					array(
						'title'  => 'Invisible Cities',
						'Year'   => 1972,
						'Genre'  => 'Novel',
						'Pages'  => 165,
						'Status' => 'Reference',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Modular city descriptions that double as a writing prompt engine.',
					),
					array(
						'title'  => 'If on a winter night a traveler',
						'Year'   => 1979,
						'Genre'  => 'Novel',
						'Pages'  => 260,
						'Status' => 'Finished',
						'Rating' => 4,
						'Read?'  => true,
						'Notes'  => 'Reader as protagonist, structure as plot.',
					),
					array(
						'title'  => 'Ficciones',
						'Year'   => 1944,
						'Genre'  => 'Short stories',
						'Pages'  => 174,
						'Status' => 'Reference',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Tiny machines for infinity, scholarship, and doubt.',
					),
					array(
						'title'  => 'Labyrinths',
						'Year'   => 1962,
						'Genre'  => 'Short stories',
						'Pages'  => 256,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'A portable Borges shelf in one book.',
					),
					array(
						'title'  => 'Things Fall Apart',
						'Year'   => 1958,
						'Genre'  => 'Novel',
						'Pages'  => 209,
						'Status' => 'Finished',
						'Rating' => 4,
						'Read?'  => true,
						'Notes'  => 'Concise historical fracture and social texture.',
					),
					array(
						'title'  => 'No Longer at Ease',
						'Year'   => 1960,
						'Genre'  => 'Novel',
						'Pages'  => 208,
						'Status' => 'Unread',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Follow-up for the Achebe sequence.',
					),
					array(
						'title'  => 'The Passion According to G.H.',
						'Year'   => 1964,
						'Genre'  => 'Novel',
						'Pages'  => 191,
						'Status' => 'Reading',
						'Rating' => 4,
						'Read?'  => false,
						'Notes'  => 'Interior monologue under extreme philosophical pressure.',
					),
					array(
						'title'  => 'The Hour of the Star',
						'Year'   => 1977,
						'Genre'  => 'Novel',
						'Pages'  => 96,
						'Status' => 'Finished',
						'Rating' => 4,
						'Read?'  => true,
						'Notes'  => 'Short, strange, and formally direct.',
					),
					array(
						'title'  => 'The Tale of Genji',
						'Year'   => 1021,
						'Genre'  => 'Classic',
						'Pages'  => 1216,
						'Status' => 'Reference',
						'Rating' => 5,
						'Read?'  => false,
						'Notes'  => 'Long-haul classic with courtly relationships and seasonal detail.',
					),
					array(
						'title'  => 'Childhoods End',
						'Year'   => 1953,
						'Genre'  => 'Science fiction',
						'Pages'  => 224,
						'Status' => 'Finished',
						'Rating' => 4,
						'Read?'  => true,
						'Notes'  => 'Cosmic perspective and ambiguous utopia.',
					),
					array(
						'title'  => 'Rendezvous with Rama',
						'Year'   => 1973,
						'Genre'  => 'Science fiction',
						'Pages'  => 256,
						'Status' => 'Unread',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Big-object exploration for the hard SF shelf.',
					),
					array(
						'title'  => 'Frankenstein',
						'Year'   => 1818,
						'Genre'  => 'Classic',
						'Pages'  => 280,
						'Status' => 'Reference',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Creation, responsibility, and early speculative form.',
					),
					array(
						'title'  => 'The Last Man',
						'Year'   => 1826,
						'Genre'  => 'Science fiction',
						'Pages'  => 470,
						'Status' => 'Wishlist',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Apocalypse before the modern genre vocabulary.',
					),
					array(
						'title'  => 'The Fifth Season',
						'Year'   => 2015,
						'Genre'  => 'Fantasy',
						'Pages'  => 512,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Geology, empire, grief, and structural experimentation.',
					),
					array(
						'title'  => 'The Obelisk Gate',
						'Year'   => 2016,
						'Genre'  => 'Fantasy',
						'Pages'  => 410,
						'Status' => 'Reading',
						'Rating' => 4,
						'Read?'  => false,
						'Notes'  => 'Second Broken Earth volume.',
					),
					array(
						'title'  => 'Never Let Me Go',
						'Year'   => 2005,
						'Genre'  => 'Science fiction',
						'Pages'  => 288,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Quiet speculative premise, devastating restraint.',
					),
					array(
						'title'  => 'Klara and the Sun',
						'Year'   => 2021,
						'Genre'  => 'Science fiction',
						'Pages'  => 303,
						'Status' => 'Unread',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'AI-adjacent reading for voice and innocence.',
					),
					array(
						'title'  => 'The Name of the Rose',
						'Year'   => 1980,
						'Genre'  => 'Mystery',
						'Pages'  => 512,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Medieval mystery with semiotics hiding in plain sight.',
					),
					array(
						'title'  => 'Foucaults Pendulum',
						'Year'   => 1988,
						'Genre'  => 'Novel',
						'Pages'  => 641,
						'Status' => 'Unread',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Conspiracy and interpretation overload.',
					),
					array(
						'title'  => 'The Savage Detectives',
						'Year'   => 1998,
						'Genre'  => 'Novel',
						'Pages'  => 648,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'A chorus of literary drift and obsession.',
					),
					array(
						'title'  => '2666',
						'Year'   => 2004,
						'Genre'  => 'Novel',
						'Pages'  => 898,
						'Status' => 'Wishlist',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Large-form project for later.',
					),
					array(
						'title'  => 'The Vegetarian',
						'Year'   => 2007,
						'Genre'  => 'Novel',
						'Pages'  => 188,
						'Status' => 'Finished',
						'Rating' => 4,
						'Read?'  => true,
						'Notes'  => 'Refusal as rupture through three perspectives.',
					),
					array(
						'title'  => 'Human Acts',
						'Year'   => 2014,
						'Genre'  => 'Novel',
						'Pages'  => 218,
						'Status' => 'Unread',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Historical violence and witness.',
					),
					array(
						'title'  => 'The Master and Margarita',
						'Year'   => 1967,
						'Genre'  => 'Novel',
						'Pages'  => 384,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Satan, satire, theatre, and Moscow absurdity.',
					),
					array(
						'title'  => 'Heart of a Dog',
						'Year'   => 1925,
						'Genre'  => 'Novel',
						'Pages'  => 128,
						'Status' => 'Unread',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Satirical companion to the larger Bulgakov shelf.',
					),
					array(
						'title'  => 'Midnights Children',
						'Year'   => 1981,
						'Genre'  => 'Novel',
						'Pages'  => 647,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'National history, family history, and exuberant narration.',
					),
					array(
						'title'  => 'The Satanic Verses',
						'Year'   => 1988,
						'Genre'  => 'Novel',
						'Pages'  => 561,
						'Status' => 'Wishlist',
						'Rating' => 0,
						'Read?'  => false,
						'Notes'  => 'Queued as a later Rushdie comparison point.',
					),
					array(
						'title'  => 'The Colour of Magic',
						'Year'   => 1983,
						'Genre'  => 'Fantasy',
						'Pages'  => 285,
						'Status' => 'Finished',
						'Rating' => 4,
						'Read?'  => true,
						'Notes'  => 'Discworld book one. Rincewind, the Luggage, and a tourist named Twoflower.',
					),
					array(
						'title'  => 'Mort',
						'Year'   => 1987,
						'Genre'  => 'Fantasy',
						'Pages'  => 272,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Death takes an apprentice; the series finds its emotional gear.',
					),
					array(
						'title'  => 'Guards! Guards!',
						'Year'   => 1989,
						'Genre'  => 'Fantasy',
						'Pages'  => 318,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Ankh-Morpork city watch debut. Vimes, Carrot, and a dragon problem.',
					),
					array(
						'title'  => 'Small Gods',
						'Year'   => 1992,
						'Genre'  => 'Fantasy',
						'Pages'  => 380,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Theology, belief, and one tortoise who used to be a god.',
					),
					array(
						'title'  => 'Hogfather',
						'Year'   => 1996,
						'Genre'  => 'Fantasy',
						'Pages'  => 354,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Discworld Hogswatch night. Death, belief, and the auditors.',
					),
					array(
						'title'  => 'Going Postal',
						'Year'   => 2004,
						'Genre'  => 'Fantasy',
						'Pages'  => 384,
						'Status' => 'Finished',
						'Rating' => 5,
						'Read?'  => true,
						'Notes'  => 'Moist von Lipwig, post offices, golems, and city infrastructure.',
					),
				),
			),
		);
	}

	/**
	 * Returns the music collection specs.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	private function music_collections(): array {
		return array(
			array(
				'title'   => 'Musicians',
				'slug'    => 'musicians',
				'icon'    => '🎤',
				'fields'  => array(
					'Country'      => 'text',
					'Active since' => 'number',
					'Genres'       => $this->multiselect_field(
						array(
							'Art pop'      => 'pink',
							'Electronic'   => 'purple',
							'Jazz'         => 'yellow',
							'Soul'         => 'orange',
							'Rock'         => 'blue',
							'Hip hop'      => 'green',
							'Ambient'      => 'gray',
							'Experimental' => 'red',
						)
					),
					'Website'      => 'url',
					'Notes'        => 'text',
				),
				'entries' => array(
					array(
						'title'        => 'Björk',
						'Country'      => 'Iceland',
						'Active since' => 1977,
						'Genres'       => array( 'Art pop', 'Electronic', 'Experimental' ),
						'Website'      => 'https://bjork.com/',
						'Notes'        => 'Voice, technology, strings, beats, and ecological scale.',
					),
					array(
						'title'        => 'David Bowie',
						'Country'      => 'United Kingdom',
						'Active since' => 1962,
						'Genres'       => array( 'Rock', 'Art pop', 'Electronic' ),
						'Website'      => 'https://www.davidbowie.com/',
						'Notes'        => 'Personas, reinvention, pop form, and studio curiosity.',
					),
					array(
						'title'        => 'Joni Mitchell',
						'Country'      => 'Canada',
						'Active since' => 1964,
						'Genres'       => array( 'Jazz', 'Rock' ),
						'Website'      => 'https://jonimitchell.com/',
						'Notes'        => 'Open tunings, painterly lyrics, and jazz harmony.',
					),
					array(
						'title'        => 'Miles Davis',
						'Country'      => 'United States',
						'Active since' => 1944,
						'Genres'       => array( 'Jazz', 'Experimental' ),
						'Website'      => '',
						'Notes'        => 'A long chain of jazz pivots, scenes, and collaborators.',
					),
					array(
						'title'        => 'Nina Simone',
						'Country'      => 'United States',
						'Active since' => 1954,
						'Genres'       => array( 'Soul', 'Jazz' ),
						'Website'      => '',
						'Notes'        => 'Classical touch, protest music, and direct emotional force.',
					),
					array(
						'title'        => 'Radiohead',
						'Country'      => 'United Kingdom',
						'Active since' => 1985,
						'Genres'       => array( 'Rock', 'Electronic', 'Experimental' ),
						'Website'      => 'https://www.radiohead.com/',
						'Notes'        => 'Band-as-lab for guitar music, electronics, and unease.',
					),
					array(
						'title'        => 'Kendrick Lamar',
						'Country'      => 'United States',
						'Active since' => 2003,
						'Genres'       => array( 'Hip hop', 'Jazz' ),
						'Website'      => 'https://oklama.com/',
						'Notes'        => 'Narrative records with dense writing and formal ambition.',
					),
					array(
						'title'        => 'Kate Bush',
						'Country'      => 'United Kingdom',
						'Active since' => 1975,
						'Genres'       => array( 'Art pop', 'Experimental' ),
						'Website'      => 'https://www.katebush.com/',
						'Notes'        => 'Story-song theatricality, production control, and movement.',
					),
					array(
						'title'        => 'Brian Eno',
						'Country'      => 'United Kingdom',
						'Active since' => 1970,
						'Genres'       => array( 'Ambient', 'Electronic', 'Experimental' ),
						'Website'      => 'https://brian-eno.net/',
						'Notes'        => 'Systems, chance, studio method, and ambient music.',
					),
					array(
						'title'        => 'Fela Kuti',
						'Country'      => 'Nigeria',
						'Active since' => 1958,
						'Genres'       => array( 'Jazz', 'Soul' ),
						'Website'      => '',
						'Notes'        => 'Long-form grooves, politics, horns, and Afrobeat architecture.',
					),
					array(
						'title'        => 'Sade',
						'Country'      => 'United Kingdom',
						'Active since' => 1982,
						'Genres'       => array( 'Soul', 'Jazz' ),
						'Website'      => 'https://www.sade.com/',
						'Notes'        => 'Quiet confidence, space, groove, and restraint.',
					),
					array(
						'title'        => 'Aphex Twin',
						'Country'      => 'Ireland',
						'Active since' => 1985,
						'Genres'       => array( 'Electronic', 'Ambient', 'Experimental' ),
						'Website'      => '',
						'Notes'        => 'Melody, abrasion, aliases, and machine rhythm.',
					),
					array(
						'title'        => 'Lauryn Hill',
						'Country'      => 'United States',
						'Active since' => 1988,
						'Genres'       => array( 'Hip hop', 'Soul' ),
						'Website'      => '',
						'Notes'        => 'Rapping, singing, arrangements, and a canonical solo album.',
					),
					array(
						'title'        => 'Talking Heads',
						'Country'      => 'United States',
						'Active since' => 1975,
						'Genres'       => array( 'Rock', 'Art pop', 'Experimental' ),
						'Website'      => '',
						'Notes'        => 'Nervous grooves, art-school minimalism, and funk borrowings.',
					),
					array(
						'title'        => 'A Tribe Called Quest',
						'Country'      => 'United States',
						'Active since' => 1985,
						'Genres'       => array( 'Hip hop', 'Jazz' ),
						'Website'      => '',
						'Notes'        => 'Jazz samples, conversational flow, and group chemistry.',
					),
					array(
						'title'        => 'Portishead',
						'Country'      => 'United Kingdom',
						'Active since' => 1991,
						'Genres'       => array( 'Electronic', 'Experimental' ),
						'Website'      => '',
						'Notes'        => 'Sparse drums, haunted vocals, and noir production.',
					),
					array(
						'title'        => 'Ryuichi Sakamoto',
						'Country'      => 'Japan',
						'Active since' => 1975,
						'Genres'       => array( 'Electronic', 'Ambient', 'Experimental' ),
						'Website'      => 'https://www.sitesakamoto.com/',
						'Notes'        => 'Piano, synthesis, film music, and delicate texture.',
					),
					array(
						'title'        => 'Solange',
						'Country'      => 'United States',
						'Active since' => 2001,
						'Genres'       => array( 'Soul', 'Art pop' ),
						'Website'      => 'https://www.solangemusic.com/',
						'Notes'        => 'R&B minimalism, choreography, and visual-album thinking.',
					),
					array(
						'title'        => 'The Beatles',
						'Country'      => 'United Kingdom',
						'Active since' => 1960,
						'Genres'       => array( 'Rock', 'Art pop' ),
						'Website'      => 'https://www.thebeatles.com/',
						'Notes'        => 'Studio invention, songwriting density, and pop-form leverage.',
					),
					array(
						'title'        => 'Pink Floyd',
						'Country'      => 'United Kingdom',
						'Active since' => 1965,
						'Genres'       => array( 'Rock', 'Experimental', 'Ambient' ),
						'Website'      => 'https://www.pinkfloyd.com/',
						'Notes'        => 'Concept records, long forms, and studio architecture.',
					),
					array(
						'title'        => 'Prince',
						'Country'      => 'United States',
						'Active since' => 1976,
						'Genres'       => array( 'Soul', 'Rock', 'Art pop' ),
						'Website'      => 'https://prince.com/',
						'Notes'        => 'One-person band, Minneapolis funk, and prolific catalog.',
					),
					array(
						'title'        => 'Fall Out Boy',
						'Country'      => 'United States',
						'Active since' => 2001,
						'Genres'       => array( 'Rock' ),
						'Website'      => 'https://falloutboy.com/',
						'Notes'        => 'Pop punk leaning into arena rock; verbose titles and big choruses.',
					),
					array(
						'title'        => 'Los Ángeles Azules',
						'Country'      => 'Mexico',
						'Active since' => 1976,
						'Genres'       => array( 'Soul' ),
						'Website'      => 'https://www.losangelesazules.com.mx/',
						'Notes'        => 'Iztapalapa-born cumbia sonidera with a long catalog and crossover collaborations.',
					),
				),
			),
			array(
				'title'   => 'Labels',
				'slug'    => 'labels',
				'icon'    => '🏷️',
				'fields'  => array(
					'Country' => 'text',
					'Founded' => 'number',
					'Focus'   => $this->multiselect_field(
						array(
							'Major'        => 'gray',
							'Independent'  => 'green',
							'Electronic'   => 'purple',
							'Jazz'         => 'yellow',
							'Hip hop'      => 'orange',
							'Experimental' => 'red',
							'Catalog'      => 'blue',
						)
					),
					'Website' => 'url',
					'Notes'   => 'text',
				),
				'entries' => array(
					array(
						'title'   => 'One Little Independent',
						'Country' => 'United Kingdom',
						'Founded' => 1985,
						'Focus'   => array( 'Independent', 'Experimental' ),
						'Website' => 'https://www.olirecords.com/',
						'Notes'   => 'Long-running independent home for adventurous pop.',
					),
					array(
						'title'   => 'RCA',
						'Country' => 'United States',
						'Founded' => 1901,
						'Focus'   => array( 'Major', 'Catalog' ),
						'Website' => 'https://www.rcarecords.com/',
						'Notes'   => 'Large catalog and major-label infrastructure.',
					),
					array(
						'title'   => 'Asylum',
						'Country' => 'United States',
						'Founded' => 1971,
						'Focus'   => array( 'Major', 'Catalog' ),
						'Website' => '',
						'Notes'   => 'Singer-songwriter era catalog.',
					),
					array(
						'title'   => 'Columbia',
						'Country' => 'United States',
						'Founded' => 1889,
						'Focus'   => array( 'Major', 'Jazz', 'Catalog' ),
						'Website' => 'https://www.columbiarecords.com/',
						'Notes'   => 'Deep major-label catalog across jazz, rock, pop, and hip hop.',
					),
					array(
						'title'   => 'Island',
						'Country' => 'Jamaica',
						'Founded' => 1959,
						'Focus'   => array( 'Major', 'Catalog' ),
						'Website' => 'https://www.islandrecords.com/',
						'Notes'   => 'Reggae roots, rock, pop, and global catalog.',
					),
					array(
						'title'   => 'XL Recordings',
						'Country' => 'United Kingdom',
						'Founded' => 1989,
						'Focus'   => array( 'Independent', 'Electronic', 'Hip hop' ),
						'Website' => 'https://xlrecordings.com/',
						'Notes'   => 'Independent label with electronic, pop, and experimental reach.',
					),
					array(
						'title'   => 'Warp',
						'Country' => 'United Kingdom',
						'Founded' => 1989,
						'Focus'   => array( 'Independent', 'Electronic', 'Experimental' ),
						'Website' => 'https://warp.net/',
						'Notes'   => 'Electronic, IDM, and experimental catalog.',
					),
					array(
						'title'   => 'Paisley Park',
						'Country' => 'United States',
						'Founded' => 1985,
						'Focus'   => array( 'Independent', 'Catalog' ),
						'Website' => '',
						'Notes'   => 'Artist-led imprint and production world.',
					),
					array(
						'title'   => 'Motown',
						'Country' => 'United States',
						'Founded' => 1959,
						'Focus'   => array( 'Major', 'Catalog' ),
						'Website' => 'https://www.motownrecords.com/',
						'Notes'   => 'Soul, pop craft, and one of the great catalog identities.',
					),
					array(
						'title'   => 'Top Dawg Entertainment',
						'Country' => 'United States',
						'Founded' => 2004,
						'Focus'   => array( 'Independent', 'Hip hop' ),
						'Website' => 'https://www.txdxe.com/',
						'Notes'   => 'West Coast hip hop label and artist development hub.',
					),
					array(
						'title'   => 'EMI',
						'Country' => 'United Kingdom',
						'Founded' => 1931,
						'Focus'   => array( 'Major', 'Catalog' ),
						'Website' => '',
						'Notes'   => 'Long-running major-label catalog across pop, rock, and experimental records.',
					),
					array(
						'title'   => 'Epic',
						'Country' => 'United States',
						'Founded' => 1953,
						'Focus'   => array( 'Major', 'Catalog' ),
						'Website' => '',
						'Notes'   => 'Major-label imprint with pop, soul, and rock catalogs.',
					),
					array(
						'title'   => 'Sire',
						'Country' => 'United States',
						'Founded' => 1966,
						'Focus'   => array( 'Independent', 'Catalog' ),
						'Website' => '',
						'Notes'   => 'New wave, punk, and alternative catalog identity.',
					),
					array(
						'title'   => 'Jive',
						'Country' => 'United Kingdom',
						'Founded' => 1977,
						'Focus'   => array( 'Hip hop', 'Catalog' ),
						'Website' => '',
						'Notes'   => 'Hip hop, R&B, and pop catalog imprint.',
					),
					array(
						'title'   => 'Milan',
						'Country' => 'France',
						'Founded' => 1978,
						'Focus'   => array( 'Independent', 'Catalog', 'Experimental' ),
						'Website' => 'https://milanrecords.com/',
						'Notes'   => 'Film music, soundtracks, and international catalog.',
					),
					array(
						'title'   => 'Apple Records',
						'Country' => 'United Kingdom',
						'Founded' => 1968,
						'Focus'   => array( 'Major', 'Catalog' ),
						'Website' => 'https://www.applerecords.com/',
						'Notes'   => 'Beatles-founded label and one of the great pop catalogs.',
					),
					array(
						'title'   => 'Harvest',
						'Country' => 'United Kingdom',
						'Founded' => 1969,
						'Focus'   => array( 'Catalog', 'Experimental' ),
						'Website' => '',
						'Notes'   => 'EMI imprint home to Pink Floyd and progressive rock.',
					),
					array(
						'title'   => 'Warner Bros. Records',
						'Country' => 'United States',
						'Founded' => 1958,
						'Focus'   => array( 'Major', 'Catalog' ),
						'Website' => '',
						'Notes'   => 'Major-label home for Prince, R&B, and rock catalogs.',
					),
					array(
						'title'   => 'Fueled by Ramen',
						'Country' => 'United States',
						'Founded' => 1996,
						'Focus'   => array( 'Independent', 'Catalog' ),
						'Website' => 'https://fueledbyramen.com/',
						'Notes'   => 'Pop punk and emo home; Fall Out Boy, Paramore, twenty one pilots.',
					),
					array(
						'title'   => 'Disa',
						'Country' => 'Mexico',
						'Founded' => 1969,
						'Focus'   => array( 'Independent', 'Catalog' ),
						'Website' => '',
						'Notes'   => 'Monterrey-based label central to grupera, norteño, and cumbia catalogs.',
					),
				),
			),
			array(
				'title'   => 'Albums',
				'slug'    => 'albums',
				'icon'    => '💿',
				'fields'  => array(
					'Year'      => 'number',
					'Genre'     => $this->select_field(
						array(
							'Art pop'      => 'pink',
							'Electronic'   => 'purple',
							'Jazz'         => 'yellow',
							'Soul'         => 'orange',
							'Rock'         => 'blue',
							'Hip hop'      => 'green',
							'Ambient'      => 'gray',
							'Experimental' => 'red',
						)
					),
					'Format'    => $this->select_field(
						array(
							'LP'       => 'blue',
							'CD'       => 'gray',
							'Digital'  => 'green',
							'Cassette' => 'orange',
						)
					),
					'Length'    => 'number',
					'Favorite?' => 'checkbox',
					'Notes'     => 'text',
				),
				'entries' => array(
					array(
						'title'     => 'Homogenic',
						'Year'      => 1997,
						'Genre'     => 'Electronic',
						'Format'    => 'LP',
						'Length'    => 43,
						'Favorite?' => true,
						'Notes'     => 'String architecture and volcanic beats.',
					),
					array(
						'title'     => 'Vespertine',
						'Year'      => 2001,
						'Genre'     => 'Art pop',
						'Format'    => 'LP',
						'Length'    => 56,
						'Favorite?' => true,
						'Notes'     => 'Microbeats, choir, harp, and winter intimacy.',
					),
					array(
						'title'     => 'Blackstar',
						'Year'      => 2016,
						'Genre'     => 'Art pop',
						'Format'    => 'Digital',
						'Length'    => 41,
						'Favorite?' => true,
						'Notes'     => 'Late style, jazz players, and theatrical finality.',
					),
					array(
						'title'     => 'Low',
						'Year'      => 1977,
						'Genre'     => 'Electronic',
						'Format'    => 'LP',
						'Length'    => 39,
						'Favorite?' => true,
						'Notes'     => 'Songs on one side, instrumentals on the other.',
					),
					array(
						'title'     => 'Blue',
						'Year'      => 1971,
						'Genre'     => 'Rock',
						'Format'    => 'LP',
						'Length'    => 36,
						'Favorite?' => true,
						'Notes'     => 'Direct writing with open-tuned guitar and piano.',
					),
					array(
						'title'     => 'Hejira',
						'Year'      => 1976,
						'Genre'     => 'Jazz',
						'Format'    => 'LP',
						'Length'    => 52,
						'Favorite?' => true,
						'Notes'     => 'Travel, fretless bass, and long melodic lines.',
					),
					array(
						'title'     => 'Kind of Blue',
						'Year'      => 1959,
						'Genre'     => 'Jazz',
						'Format'    => 'LP',
						'Length'    => 45,
						'Favorite?' => true,
						'Notes'     => 'Modal touchstone and ensemble space.',
					),
					array(
						'title'     => 'Bitches Brew',
						'Year'      => 1970,
						'Genre'     => 'Jazz',
						'Format'    => 'LP',
						'Length'    => 94,
						'Favorite?' => false,
						'Notes'     => 'Electric sprawl and studio assemblage.',
					),
					array(
						'title'     => 'Pastel Blues',
						'Year'      => 1965,
						'Genre'     => 'Soul',
						'Format'    => 'LP',
						'Length'    => 36,
						'Favorite?' => true,
						'Notes'     => 'Blues, standards, and a monumental closer.',
					),
					array(
						'title'     => 'Wild Is the Wind',
						'Year'      => 1966,
						'Genre'     => 'Soul',
						'Format'    => 'LP',
						'Length'    => 39,
						'Favorite?' => false,
						'Notes'     => 'Controlled intensity and reinterpretation.',
					),
					array(
						'title'     => 'Kid A',
						'Year'      => 2000,
						'Genre'     => 'Electronic',
						'Format'    => 'CD',
						'Length'    => 50,
						'Favorite?' => true,
						'Notes'     => 'Rock band disappears into texture and dread.',
					),
					array(
						'title'     => 'In Rainbows',
						'Year'      => 2007,
						'Genre'     => 'Rock',
						'Format'    => 'Digital',
						'Length'    => 42,
						'Favorite?' => true,
						'Notes'     => 'Warmest Radiohead record, rhythmically loose.',
					),
					array(
						'title'     => 'To Pimp a Butterfly',
						'Year'      => 2015,
						'Genre'     => 'Hip hop',
						'Format'    => 'Digital',
						'Length'    => 79,
						'Favorite?' => true,
						'Notes'     => 'Jazz, funk, political theater, and layered narration.',
					),
					array(
						'title'     => 'DAMN.',
						'Year'      => 2017,
						'Genre'     => 'Hip hop',
						'Format'    => 'Digital',
						'Length'    => 55,
						'Favorite?' => false,
						'Notes'     => 'Tighter record with mirrored sequencing games.',
					),
					array(
						'title'     => 'Hounds of Love',
						'Year'      => 1985,
						'Genre'     => 'Art pop',
						'Format'    => 'LP',
						'Length'    => 48,
						'Favorite?' => true,
						'Notes'     => 'Pop side plus conceptual suite.',
					),
					array(
						'title'     => 'The Dreaming',
						'Year'      => 1982,
						'Genre'     => 'Experimental',
						'Format'    => 'LP',
						'Length'    => 43,
						'Favorite?' => false,
						'Notes'     => 'Dense, theatrical, and production-heavy.',
					),
					array(
						'title'     => 'Ambient 1: Music for Airports',
						'Year'      => 1978,
						'Genre'     => 'Ambient',
						'Format'    => 'LP',
						'Length'    => 48,
						'Favorite?' => true,
						'Notes'     => 'A system for calm, repetition, and attention.',
					),
					array(
						'title'     => 'Another Green World',
						'Year'      => 1975,
						'Genre'     => 'Experimental',
						'Format'    => 'LP',
						'Length'    => 41,
						'Favorite?' => true,
						'Notes'     => 'Short songs, instrumentals, and studio worlds.',
					),
					array(
						'title'     => 'Zombie',
						'Year'      => 1976,
						'Genre'     => 'Jazz',
						'Format'    => 'LP',
						'Length'    => 25,
						'Favorite?' => true,
						'Notes'     => 'Two long pieces, political charge, relentless band.',
					),
					array(
						'title'     => 'Expensive Shit',
						'Year'      => 1975,
						'Genre'     => 'Jazz',
						'Format'    => 'LP',
						'Length'    => 24,
						'Favorite?' => false,
						'Notes'     => 'Afrobeat groove and satirical bite.',
					),
					array(
						'title'     => 'Diamond Life',
						'Year'      => 1984,
						'Genre'     => 'Soul',
						'Format'    => 'LP',
						'Length'    => 44,
						'Favorite?' => true,
						'Notes'     => 'Cool production, direct songs, and unforced elegance.',
					),
					array(
						'title'     => 'Love Deluxe',
						'Year'      => 1992,
						'Genre'     => 'Soul',
						'Format'    => 'CD',
						'Length'    => 45,
						'Favorite?' => true,
						'Notes'     => 'Spacious, patient, and immaculately paced.',
					),
					array(
						'title'     => 'Selected Ambient Works 85-92',
						'Year'      => 1992,
						'Genre'     => 'Electronic',
						'Format'    => 'LP',
						'Length'    => 74,
						'Favorite?' => true,
						'Notes'     => 'Melodic electronic sketches with a home-tape glow.',
					),
					array(
						'title'     => 'Richard D. James Album',
						'Year'      => 1996,
						'Genre'     => 'Electronic',
						'Format'    => 'CD',
						'Length'    => 33,
						'Favorite?' => false,
						'Notes'     => 'Tiny melodic pieces and hyperactive percussion.',
					),
					array(
						'title'     => 'The Miseducation of Lauryn Hill',
						'Year'      => 1998,
						'Genre'     => 'Hip hop',
						'Format'    => 'CD',
						'Length'    => 77,
						'Favorite?' => true,
						'Notes'     => 'Rap, soul, classroom interludes, and personal reckoning.',
					),
					array(
						'title'     => 'Remain in Light',
						'Year'      => 1980,
						'Genre'     => 'Rock',
						'Format'    => 'LP',
						'Length'    => 40,
						'Favorite?' => true,
						'Notes'     => 'Loops, guitars, ensemble funk, and anxious sermons.',
					),
					array(
						'title'     => 'Speaking in Tongues',
						'Year'      => 1983,
						'Genre'     => 'Rock',
						'Format'    => 'LP',
						'Length'    => 40,
						'Favorite?' => false,
						'Notes'     => 'Lean pop-funk after the maximal experiment.',
					),
					array(
						'title'     => 'The Low End Theory',
						'Year'      => 1991,
						'Genre'     => 'Hip hop',
						'Format'    => 'LP',
						'Length'    => 48,
						'Favorite?' => true,
						'Notes'     => 'Jazz bass, drums, group voices, and negative space.',
					),
					array(
						'title'     => 'Midnight Marauders',
						'Year'      => 1993,
						'Genre'     => 'Hip hop',
						'Format'    => 'LP',
						'Length'    => 51,
						'Favorite?' => true,
						'Notes'     => 'Warm, conversational, and sample-rich.',
					),
					array(
						'title'     => 'Dummy',
						'Year'      => 1994,
						'Genre'     => 'Electronic',
						'Format'    => 'CD',
						'Length'    => 49,
						'Favorite?' => true,
						'Notes'     => 'Trip-hop noir and heavy negative space.',
					),
					array(
						'title'     => 'Third',
						'Year'      => 2008,
						'Genre'     => 'Experimental',
						'Format'    => 'Digital',
						'Length'    => 49,
						'Favorite?' => false,
						'Notes'     => 'Abrasive comeback with less comfort.',
					),
					array(
						'title'     => 'Async',
						'Year'      => 2017,
						'Genre'     => 'Ambient',
						'Format'    => 'Digital',
						'Length'    => 60,
						'Favorite?' => true,
						'Notes'     => 'Piano, fragments, field-like textures, and silence.',
					),
					array(
						'title'     => 'Thousand Knives',
						'Year'      => 1978,
						'Genre'     => 'Electronic',
						'Format'    => 'LP',
						'Length'    => 44,
						'Favorite?' => false,
						'Notes'     => 'Early solo electronic experiments.',
					),
					array(
						'title'     => 'A Seat at the Table',
						'Year'      => 2016,
						'Genre'     => 'Soul',
						'Format'    => 'Digital',
						'Length'    => 52,
						'Favorite?' => true,
						'Notes'     => 'Minimal arrangements and intergenerational conversation.',
					),
					array(
						'title'     => 'When I Get Home',
						'Year'      => 2019,
						'Genre'     => 'Soul',
						'Format'    => 'Digital',
						'Length'    => 39,
						'Favorite?' => false,
						'Notes'     => 'Houston, repetition, circular forms, and visual rhythm.',
					),
					array(
						'title'     => 'Abbey Road',
						'Year'      => 1969,
						'Genre'     => 'Rock',
						'Format'    => 'LP',
						'Length'    => 47,
						'Favorite?' => true,
						'Notes'     => 'Side-two medley and a final statement from a working band.',
					),
					array(
						'title'     => 'Sgt. Peppers Lonely Hearts Club Band',
						'Year'      => 1967,
						'Genre'     => 'Rock',
						'Format'    => 'LP',
						'Length'    => 39,
						'Favorite?' => true,
						'Notes'     => 'Concept-album touchstone and studio-as-instrument record.',
					),
					array(
						'title'     => 'The Dark Side of the Moon',
						'Year'      => 1973,
						'Genre'     => 'Rock',
						'Format'    => 'LP',
						'Length'    => 43,
						'Favorite?' => true,
						'Notes'     => 'Studio fidelity, suite-form pacing, and unbroken segues.',
					),
					array(
						'title'     => 'The Wall',
						'Year'      => 1979,
						'Genre'     => 'Rock',
						'Format'    => 'LP',
						'Length'    => 81,
						'Favorite?' => true,
						'Notes'     => 'Double-album rock opera with theatrical staging.',
					),
					array(
						'title'     => 'Purple Rain',
						'Year'      => 1984,
						'Genre'     => 'Rock',
						'Format'    => 'LP',
						'Length'    => 44,
						'Favorite?' => true,
						'Notes'     => 'Funk-rock, ballads, and a soundtrack-meets-album peak.',
					),
					array(
						'title'     => 'Take This to Your Grave',
						'Year'      => 2003,
						'Genre'     => 'Rock',
						'Format'    => 'CD',
						'Length'    => 39,
						'Favorite?' => false,
						'Notes'     => 'Pop punk debut for Fall Out Boy and Fueled by Ramen.',
					),
					array(
						'title'     => 'From Under the Cork Tree',
						'Year'      => 2005,
						'Genre'     => 'Rock',
						'Format'    => 'CD',
						'Length'    => 48,
						'Favorite?' => true,
						'Notes'     => 'Breakthrough Fall Out Boy record; verbose titles, big choruses.',
					),
					array(
						'title'     => 'Infinity on High',
						'Year'      => 2007,
						'Genre'     => 'Rock',
						'Format'    => 'CD',
						'Length'    => 49,
						'Favorite?' => false,
						'Notes'     => 'Fall Out Boy goes wider; horns, strings, and Babyface production.',
					),
					array(
						'title'     => 'Save Rock and Roll',
						'Year'      => 2013,
						'Genre'     => 'Rock',
						'Format'    => 'Digital',
						'Length'    => 43,
						'Favorite?' => false,
						'Notes'     => 'Fall Out Boy comeback record; pop sheen and arena reach.',
					),
					array(
						'title'     => 'El Listón de tu Pelo',
						'Year'      => 1996,
						'Genre'     => 'Soul',
						'Format'    => 'CD',
						'Length'    => 43,
						'Favorite?' => true,
						'Notes'     => 'Los Ángeles Azules cumbia sonidera classic and crossover entry.',
					),
					array(
						'title'     => 'Cómo te voy a olvidar',
						'Year'      => 1996,
						'Genre'     => 'Soul',
						'Format'    => 'CD',
						'Length'    => 50,
						'Favorite?' => true,
						'Notes'     => 'Title track became one of the most-streamed cumbia records ever.',
					),
					array(
						'title'     => 'De Buenas Raíces',
						'Year'      => 2017,
						'Genre'     => 'Soul',
						'Format'    => 'Digital',
						'Length'    => 56,
						'Favorite?' => false,
						'Notes'     => 'Los Ángeles Azules collaborations album with norteño and pop guests.',
					),
				),
			),
			array(
				'title'   => 'Tracks',
				'slug'    => 'tracks',
				'icon'    => '🎧',
				'fields'  => array(
					'Track #'   => 'number',
					'Duration'  => 'number',
					'Mood'      => $this->select_field(
						array(
							'Bright'     => 'yellow',
							'Nocturnal'  => 'purple',
							'Reflective' => 'blue',
							'Restless'   => 'red',
							'Expansive'  => 'green',
							'Minimal'    => 'gray',
						)
					),
					'Favorite?' => 'checkbox',
					'Notes'     => 'text',
				),
				'entries' => array(
					array(
						'title'     => 'Jóga',
						'Track #'   => 2,
						'Duration'  => 5,
						'Mood'      => 'Expansive',
						'Favorite?' => true,
						'Notes'     => 'String drama and seismic drums.',
					),
					array(
						'title'     => 'Bachelorette',
						'Track #'   => 4,
						'Duration'  => 5,
						'Mood'      => 'Nocturnal',
						'Favorite?' => true,
						'Notes'     => 'Storybook intensity and orchestral weight.',
					),
					array(
						'title'     => 'Hidden Place',
						'Track #'   => 1,
						'Duration'  => 5,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Soft choral machinery.',
					),
					array(
						'title'     => 'Pagan Poetry',
						'Track #'   => 5,
						'Duration'  => 5,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Harp, choir, and exposed melody.',
					),
					array(
						'title'     => 'Blackstar',
						'Track #'   => 1,
						'Duration'  => 10,
						'Mood'      => 'Nocturnal',
						'Favorite?' => true,
						'Notes'     => 'Long-form suite and late-style signal.',
					),
					array(
						'title'     => 'Lazarus',
						'Track #'   => 3,
						'Duration'  => 6,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Theatrical farewell.',
					),
					array(
						'title'     => 'Speed of Life',
						'Track #'   => 1,
						'Duration'  => 3,
						'Mood'      => 'Bright',
						'Favorite?' => false,
						'Notes'     => 'Instrumental opening statement.',
					),
					array(
						'title'     => 'Warszawa',
						'Track #'   => 6,
						'Duration'  => 6,
						'Mood'      => 'Minimal',
						'Favorite?' => true,
						'Notes'     => 'Wordless gravity.',
					),
					array(
						'title'     => 'Carey',
						'Track #'   => 4,
						'Duration'  => 3,
						'Mood'      => 'Bright',
						'Favorite?' => false,
						'Notes'     => 'Travel song with bounce.',
					),
					array(
						'title'     => 'A Case of You',
						'Track #'   => 9,
						'Duration'  => 4,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Plainspoken precision.',
					),
					array(
						'title'     => 'Coyote',
						'Track #'   => 1,
						'Duration'  => 5,
						'Mood'      => 'Restless',
						'Favorite?' => true,
						'Notes'     => 'Road rhythm and elastic bass.',
					),
					array(
						'title'     => 'Amelia',
						'Track #'   => 2,
						'Duration'  => 6,
						'Mood'      => 'Expansive',
						'Favorite?' => true,
						'Notes'     => 'Desert, flight, and abstraction.',
					),
					array(
						'title'     => 'So What',
						'Track #'   => 1,
						'Duration'  => 9,
						'Mood'      => 'Minimal',
						'Favorite?' => true,
						'Notes'     => 'Modal patience.',
					),
					array(
						'title'     => 'Blue in Green',
						'Track #'   => 3,
						'Duration'  => 5,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Small-space lyricism.',
					),
					array(
						'title'     => 'Pharaohs Dance',
						'Track #'   => 1,
						'Duration'  => 20,
						'Mood'      => 'Restless',
						'Favorite?' => false,
						'Notes'     => 'Edited electric maze.',
					),
					array(
						'title'     => 'Spanish Key',
						'Track #'   => 2,
						'Duration'  => 17,
						'Mood'      => 'Expansive',
						'Favorite?' => false,
						'Notes'     => 'Long electric groove.',
					),
					array(
						'title'     => 'Sinnerman',
						'Track #'   => 9,
						'Duration'  => 10,
						'Mood'      => 'Expansive',
						'Favorite?' => true,
						'Notes'     => 'Relentless build.',
					),
					array(
						'title'     => 'Strange Fruit',
						'Track #'   => 4,
						'Duration'  => 4,
						'Mood'      => 'Nocturnal',
						'Favorite?' => true,
						'Notes'     => 'Unflinching interpretation.',
					),
					array(
						'title'     => 'Everything in Its Right Place',
						'Track #'   => 1,
						'Duration'  => 4,
						'Mood'      => 'Minimal',
						'Favorite?' => true,
						'Notes'     => 'Looped voice and keyboard drift.',
					),
					array(
						'title'     => 'Idioteque',
						'Track #'   => 8,
						'Duration'  => 5,
						'Mood'      => 'Restless',
						'Favorite?' => true,
						'Notes'     => 'Dance track under alarm.',
					),
					array(
						'title'     => '15 Step',
						'Track #'   => 1,
						'Duration'  => 4,
						'Mood'      => 'Bright',
						'Favorite?' => false,
						'Notes'     => 'Odd meter with a warm surface.',
					),
					array(
						'title'     => 'Reckoner',
						'Track #'   => 7,
						'Duration'  => 5,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Percussion shimmer and falsetto.',
					),
					array(
						'title'     => 'Wesleys Theory',
						'Track #'   => 1,
						'Duration'  => 5,
						'Mood'      => 'Restless',
						'Favorite?' => true,
						'Notes'     => 'Opens the record as theater.',
					),
					array(
						'title'     => 'Alright',
						'Track #'   => 7,
						'Duration'  => 4,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Anthem inside a dense album.',
					),
					array(
						'title'     => 'DNA.',
						'Track #'   => 2,
						'Duration'  => 3,
						'Mood'      => 'Restless',
						'Favorite?' => true,
						'Notes'     => 'Compressed force.',
					),
					array(
						'title'     => 'DUCKWORTH.',
						'Track #'   => 14,
						'Duration'  => 4,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Narrative loop closes.',
					),
					array(
						'title'     => 'Running Up That Hill',
						'Track #'   => 1,
						'Duration'  => 5,
						'Mood'      => 'Expansive',
						'Favorite?' => true,
						'Notes'     => 'Pop as myth.',
					),
					array(
						'title'     => 'Cloudbusting',
						'Track #'   => 5,
						'Duration'  => 5,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Strings and memory machine.',
					),
					array(
						'title'     => 'Suspended in Gaffa',
						'Track #'   => 6,
						'Duration'  => 4,
						'Mood'      => 'Restless',
						'Favorite?' => false,
						'Notes'     => 'Theatrical rhythm and hooks.',
					),
					array(
						'title'     => 'Sat in Your Lap',
						'Track #'   => 1,
						'Duration'  => 4,
						'Mood'      => 'Restless',
						'Favorite?' => false,
						'Notes'     => 'Percussive and angular.',
					),
					array(
						'title'     => '1/1',
						'Track #'   => 1,
						'Duration'  => 17,
						'Mood'      => 'Minimal',
						'Favorite?' => true,
						'Notes'     => 'Slow generative drift.',
					),
					array(
						'title'     => '2/1',
						'Track #'   => 2,
						'Duration'  => 9,
						'Mood'      => 'Minimal',
						'Favorite?' => false,
						'Notes'     => 'Small cells in rotation.',
					),
					array(
						'title'     => 'St. Elmos Fire',
						'Track #'   => 3,
						'Duration'  => 3,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Compact song with glowing guitar.',
					),
					array(
						'title'     => 'The Big Ship',
						'Track #'   => 6,
						'Duration'  => 3,
						'Mood'      => 'Expansive',
						'Favorite?' => true,
						'Notes'     => 'Simple progression, huge emotional lift.',
					),
					array(
						'title'     => 'Zombie',
						'Track #'   => 1,
						'Duration'  => 12,
						'Mood'      => 'Restless',
						'Favorite?' => true,
						'Notes'     => 'Political groove with force.',
					),
					array(
						'title'     => 'Mister Follow Follow',
						'Track #'   => 2,
						'Duration'  => 12,
						'Mood'      => 'Restless',
						'Favorite?' => false,
						'Notes'     => 'Call and response momentum.',
					),
					array(
						'title'     => 'Smooth Operator',
						'Track #'   => 1,
						'Duration'  => 5,
						'Mood'      => 'Nocturnal',
						'Favorite?' => true,
						'Notes'     => 'Sleek and controlled.',
					),
					array(
						'title'     => 'Your Love Is King',
						'Track #'   => 2,
						'Duration'  => 4,
						'Mood'      => 'Bright',
						'Favorite?' => false,
						'Notes'     => 'Soft saxophone frame.',
					),
					array(
						'title'     => 'No Ordinary Love',
						'Track #'   => 1,
						'Duration'  => 7,
						'Mood'      => 'Nocturnal',
						'Favorite?' => true,
						'Notes'     => 'Slow burn and open space.',
					),
					array(
						'title'     => 'Cherish the Day',
						'Track #'   => 7,
						'Duration'  => 6,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Minimal movement, maximum patience.',
					),
					array(
						'title'     => 'Xtal',
						'Track #'   => 1,
						'Duration'  => 5,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Dreamlike opener.',
					),
					array(
						'title'     => 'Ageispolis',
						'Track #'   => 2,
						'Duration'  => 5,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Melodic and weightless.',
					),
					array(
						'title'     => '4',
						'Track #'   => 1,
						'Duration'  => 4,
						'Mood'      => 'Restless',
						'Favorite?' => false,
						'Notes'     => 'Hyperactive miniature.',
					),
					array(
						'title'     => 'Girl/Boy Song',
						'Track #'   => 4,
						'Duration'  => 5,
						'Mood'      => 'Restless',
						'Favorite?' => true,
						'Notes'     => 'Strings and drum edits.',
					),
					array(
						'title'     => 'Doo Wop',
						'Track #'   => 5,
						'Duration'  => 5,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Pop clarity and classroom frame.',
					),
					array(
						'title'     => 'Ex-Factor',
						'Track #'   => 2,
						'Duration'  => 5,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Vocal control and ache.',
					),
					array(
						'title'     => 'Born Under Punches',
						'Track #'   => 1,
						'Duration'  => 5,
						'Mood'      => 'Restless',
						'Favorite?' => true,
						'Notes'     => 'Looped funk mechanism.',
					),
					array(
						'title'     => 'Once in a Lifetime',
						'Track #'   => 4,
						'Duration'  => 4,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Sermon, groove, and existential joke.',
					),
					array(
						'title'     => 'Burning Down the House',
						'Track #'   => 1,
						'Duration'  => 4,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Pop-funk direct hit.',
					),
					array(
						'title'     => 'This Must Be the Place',
						'Track #'   => 9,
						'Duration'  => 5,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Plain tenderness from a nervous band.',
					),
					array(
						'title'     => 'Buggin Out',
						'Track #'   => 2,
						'Duration'  => 4,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Bassline and handoff chemistry.',
					),
					array(
						'title'     => 'Scenario',
						'Track #'   => 14,
						'Duration'  => 4,
						'Mood'      => 'Restless',
						'Favorite?' => true,
						'Notes'     => 'Crew-track energy.',
					),
					array(
						'title'     => 'Electric Relaxation',
						'Track #'   => 8,
						'Duration'  => 4,
						'Mood'      => 'Nocturnal',
						'Favorite?' => true,
						'Notes'     => 'Late-night loop and conversational ease.',
					),
					array(
						'title'     => 'Award Tour',
						'Track #'   => 3,
						'Duration'  => 4,
						'Mood'      => 'Bright',
						'Favorite?' => false,
						'Notes'     => 'Travelogue bounce.',
					),
					array(
						'title'     => 'Mysterons',
						'Track #'   => 1,
						'Duration'  => 5,
						'Mood'      => 'Nocturnal',
						'Favorite?' => true,
						'Notes'     => 'Instant atmosphere.',
					),
					array(
						'title'     => 'Glory Box',
						'Track #'   => 11,
						'Duration'  => 5,
						'Mood'      => 'Nocturnal',
						'Favorite?' => true,
						'Notes'     => 'Slow, theatrical closer.',
					),
					array(
						'title'     => 'The Rip',
						'Track #'   => 3,
						'Duration'  => 4,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Slow build into motorik pulse.',
					),
					array(
						'title'     => 'Machine Gun',
						'Track #'   => 5,
						'Duration'  => 5,
						'Mood'      => 'Restless',
						'Favorite?' => false,
						'Notes'     => 'Harsh grid.',
					),
					array(
						'title'     => 'andata',
						'Track #'   => 1,
						'Duration'  => 4,
						'Mood'      => 'Minimal',
						'Favorite?' => true,
						'Notes'     => 'Piano, breath, and quiet electronics.',
					),
					array(
						'title'     => 'fullmoon',
						'Track #'   => 5,
						'Duration'  => 5,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Gentle pulse and fractured voice.',
					),
					array(
						'title'     => 'Cranes in the Sky',
						'Track #'   => 8,
						'Duration'  => 4,
						'Mood'      => 'Reflective',
						'Favorite?' => true,
						'Notes'     => 'Sparse arrangement and suspended feeling.',
					),
					array(
						'title'     => 'Dont Touch My Hair',
						'Track #'   => 9,
						'Duration'  => 4,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Soft surface, firm boundary.',
					),
					array(
						'title'     => 'Things I Imagined',
						'Track #'   => 1,
						'Duration'  => 2,
						'Mood'      => 'Minimal',
						'Favorite?' => false,
						'Notes'     => 'Looped incantation.',
					),
					array(
						'title'     => 'Binz',
						'Track #'   => 8,
						'Duration'  => 2,
						'Mood'      => 'Bright',
						'Favorite?' => true,
						'Notes'     => 'Tiny, breezy, and sticky.',
					),
				),
			),
		);
	}

	/**
	 * Returns the work/demo collection specs.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	private function work_collections(): array {
		return array(
			array(
				'title'   => 'People',
				'slug'    => 'people',
				'icon'    => '👤',
				'fields'  => array(
					'Role'     => $this->select_field(
						array(
							'Engineer'   => 'blue',
							'Designer'   => 'pink',
							'Researcher' => 'purple',
							'Writer'     => 'green',
							'Lead'       => 'orange',
						)
					),
					'Team'     => $this->select_field(
						array(
							'Product'  => 'blue',
							'Platform' => 'purple',
							'Design'   => 'pink',
							'Research' => 'green',
							'Docs'     => 'yellow',
						)
					),
					'Email'    => 'email',
					'Location' => 'text',
					'Capacity' => 'number',
					'Notes'    => 'text',
				),
				'entries' => array(
					array(
						'title'    => 'Miguel Fonseca',
						'Role'     => 'Lead',
						'Team'     => 'Product',
						'Email'    => 'miguel@example.com',
						'Location' => 'Lisbon',
						'Capacity' => 80,
						'Notes'    => 'Product direction and seed workspace review.',
					),
					array(
						'title'    => 'Hector Prieto',
						'Role'     => 'Engineer',
						'Team'     => 'Platform',
						'Email'    => 'hector@example.com',
						'Location' => 'Madrid',
						'Capacity' => 70,
						'Notes'    => 'Core shell, editor, and data-model plumbing.',
					),
					array(
						'title'    => 'Ava Chen',
						'Role'     => 'Designer',
						'Team'     => 'Design',
						'Email'    => 'ava@example.com',
						'Location' => 'Toronto',
						'Capacity' => 60,
						'Notes'    => 'Interaction design and polish passes.',
					),
					array(
						'title'    => 'Sam Rivera',
						'Role'     => 'Researcher',
						'Team'     => 'Research',
						'Email'    => 'sam@example.com',
						'Location' => 'Chicago',
						'Capacity' => 50,
						'Notes'    => 'Competitive research and user notes.',
					),
					array(
						'title'    => 'Nora Singh',
						'Role'     => 'Writer',
						'Team'     => 'Docs',
						'Email'    => 'nora@example.com',
						'Location' => 'London',
						'Capacity' => 65,
						'Notes'    => 'Docs, release notes, and demo narratives.',
					),
					array(
						'title'    => 'Iris Okafor',
						'Role'     => 'Engineer',
						'Team'     => 'Platform',
						'Email'    => 'iris@example.com',
						'Location' => 'Berlin',
						'Capacity' => 75,
						'Notes'    => 'Relations, rollups, and REST behavior.',
					),
					array(
						'title'    => 'Leo Martin',
						'Role'     => 'Engineer',
						'Team'     => 'Product',
						'Email'    => 'leo@example.com',
						'Location' => 'Paris',
						'Capacity' => 55,
						'Notes'    => 'DataViews workflows and inline editing.',
					),
					array(
						'title'    => 'Mina Park',
						'Role'     => 'Designer',
						'Team'     => 'Design',
						'Email'    => 'mina@example.com',
						'Location' => 'Seoul',
						'Capacity' => 45,
						'Notes'    => 'Visual systems and accessibility checks.',
					),
					array(
						'title'    => 'Owen Brooks',
						'Role'     => 'Researcher',
						'Team'     => 'Research',
						'Email'    => 'owen@example.com',
						'Location' => 'Dublin',
						'Capacity' => 40,
						'Notes'    => 'Content modeling examples and import notes.',
					),
					array(
						'title'    => 'Priya Shah',
						'Role'     => 'Lead',
						'Team'     => 'Platform',
						'Email'    => 'priya@example.com',
						'Location' => 'Mumbai',
						'Capacity' => 70,
						'Notes'    => 'Technical planning and QA triage.',
					),
					array(
						'title'    => 'Eli Novak',
						'Role'     => 'Writer',
						'Team'     => 'Docs',
						'Email'    => 'eli@example.com',
						'Location' => 'Prague',
						'Capacity' => 50,
						'Notes'    => 'Field guide material and test scripts.',
					),
					array(
						'title'    => 'Rae Kim',
						'Role'     => 'Engineer',
						'Team'     => 'Platform',
						'Email'    => 'rae@example.com',
						'Location' => 'Vancouver',
						'Capacity' => 60,
						'Notes'    => 'Performance, pagination, and state cleanup.',
					),
				),
			),
			array(
				'title'   => 'Projects',
				'slug'    => 'projects',
				'icon'    => '🧭',
				'fields'  => array(
					'Status'      => $this->select_field(
						array(
							'Backlog'     => 'gray',
							'Planned'     => 'blue',
							'In progress' => 'yellow',
							'Review'      => 'purple',
							'Shipped'     => 'green',
						)
					),
					'Priority'    => $this->select_field(
						array(
							'Low'    => 'gray',
							'Medium' => 'blue',
							'High'   => 'orange',
							'Urgent' => 'red',
						)
					),
					'Kickoff'     => 'date',
					'Due'         => 'date',
					'Tags'        => $this->multiselect_field(
						array(
							'editor'        => 'blue',
							'data'          => 'green',
							'dev-env'       => 'orange',
							'research'      => 'purple',
							'documentation' => 'yellow',
							'design'        => 'pink',
						)
					),
					'Progress'    => $this->number_field( array( 'display' => 'bar' ) ),
					'Blocked?'    => 'checkbox',
					'Project URL' => 'url',
					'Notes'       => 'text',
				),
				'entries' => array(
					array(
						'title'       => 'Seed knowledge workspace',
						'Status'      => 'In progress',
						'Priority'    => 'Urgent',
						'Kickoff'     => '2026-05-04',
						'Due'         => '2026-05-18',
						'Tags'        => array( 'dev-env', 'data', 'documentation' ),
						'Progress'    => 75,
						'Blocked?'    => false,
						'Project URL' => 'https://example.com/projects/seed-workspace',
						'Notes'       => 'Canonical seed content for local starts and demos.',
					),
					array(
						'title'       => 'Relation field polish',
						'Status'      => 'Review',
						'Priority'    => 'High',
						'Kickoff'     => '2026-05-06',
						'Due'         => '2026-05-24',
						'Tags'        => array( 'data', 'editor' ),
						'Progress'    => 60,
						'Blocked?'    => false,
						'Project URL' => 'https://example.com/projects/relation-polish',
						'Notes'       => 'Improve relation chips, pickers, and row navigation.',
					),
					array(
						'title'       => 'Row detail editing',
						'Status'      => 'Planned',
						'Priority'    => 'High',
						'Kickoff'     => '2026-05-20',
						'Due'         => '2026-06-14',
						'Tags'        => array( 'editor', 'data' ),
						'Progress'    => 25,
						'Blocked?'    => false,
						'Project URL' => '',
						'Notes'       => 'Make row pages feel like first-class editable records.',
					),
					array(
						'title'       => 'Collection icon pass',
						'Status'      => 'In progress',
						'Priority'    => 'Medium',
						'Kickoff'     => '2026-05-07',
						'Due'         => '2026-05-17',
						'Tags'        => array( 'design', 'editor' ),
						'Progress'    => 55,
						'Blocked?'    => false,
						'Project URL' => 'https://example.com/projects/icons',
						'Notes'       => 'Bring collection identity closer to page identity.',
					),
					array(
						'title'       => 'Import modeling guide',
						'Status'      => 'Backlog',
						'Priority'    => 'Medium',
						'Kickoff'     => '',
						'Due'         => '2026-06-20',
						'Tags'        => array( 'research', 'documentation' ),
						'Progress'    => 10,
						'Blocked?'    => false,
						'Project URL' => '',
						'Notes'       => 'Turn real-world workspace examples into importer fixtures.',
					),
					array(
						'title'       => 'DataViews saved views',
						'Status'      => 'Planned',
						'Priority'    => 'Medium',
						'Kickoff'     => '2026-06-01',
						'Due'         => '2026-06-28',
						'Tags'        => array( 'data', 'editor' ),
						'Progress'    => 15,
						'Blocked?'    => true,
						'Project URL' => 'https://example.com/projects/saved-views',
						'Notes'       => 'Blocked on view persistence shape and upstream APIs.',
					),
					array(
						'title'       => 'Public collection templates',
						'Status'      => 'Backlog',
						'Priority'    => 'Low',
						'Kickoff'     => '',
						'Due'         => '',
						'Tags'        => array( 'design', 'research' ),
						'Progress'    => 0,
						'Blocked?'    => false,
						'Project URL' => 'https://example.com/projects/public-templates',
						'Notes'       => 'Explore rendering collection views outside the admin shell.',
					),
					array(
						'title'       => 'Performance baseline',
						'Status'      => 'Planned',
						'Priority'    => 'High',
						'Kickoff'     => '2026-05-27',
						'Due'         => '2026-06-10',
						'Tags'        => array( 'data', 'dev-env' ),
						'Progress'    => 20,
						'Blocked?'    => false,
						'Project URL' => '',
						'Notes'       => 'Use larger seeds to test loading, pagination, rollups, and relation previews.',
					),
				),
			),
			array(
				'title'   => 'Tasks',
				'slug'    => 'tasks',
				'icon'    => '✅',
				'fields'  => array(
					'Status'   => $this->select_field(
						array(
							'Todo'    => 'gray',
							'Doing'   => 'yellow',
							'Review'  => 'purple',
							'Done'    => 'green',
							'Blocked' => 'red',
						)
					),
					'Type'     => $this->select_field(
						array(
							'Feature'  => 'blue',
							'Bug'      => 'red',
							'Chore'    => 'gray',
							'Docs'     => 'yellow',
							'Research' => 'purple',
						)
					),
					'Effort'   => 'number',
					'Due'      => 'date',
					'Reminder' => 'datetime',
					'Tags'     => $this->multiselect_field(
						array(
							'api'     => 'purple',
							'ui'      => 'blue',
							'content' => 'green',
							'testing' => 'yellow',
							'cleanup' => 'gray',
							'blocked' => 'red',
						)
					),
					'Done?'    => 'checkbox',
					'URL'      => 'url',
					'Notes'    => 'text',
				),
				'entries' => array(
					array(
						'title'    => 'Replace flat seed tables with connected data',
						'Status'   => 'Doing',
						'Type'     => 'Feature',
						'Effort'   => 8,
						'Due'      => '2026-05-10',
						'Reminder' => '2026-05-09T10:00:00',
						'Tags'     => array( 'content', 'api' ),
						'Done?'    => false,
						'URL'      => 'https://example.com/tasks/connected-seed',
						'Notes'    => 'Literature, music, and work clusters should cross-link.',
					),
					array(
						'title'    => 'Add collection icons to sidebar rows',
						'Status'   => 'Review',
						'Type'     => 'Feature',
						'Effort'   => 3,
						'Due'      => '2026-05-11',
						'Reminder' => '2026-05-10T15:00:00',
						'Tags'     => array( 'ui' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Use the same icon JSON shape as pages.',
					),
					array(
						'title'    => 'Seed author rollups from related books',
						'Status'   => 'Doing',
						'Type'     => 'Feature',
						'Effort'   => 5,
						'Due'      => '2026-05-12',
						'Reminder' => '',
						'Tags'     => array( 'api', 'testing' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Book count, latest book, genres, and average rating.',
					),
					array(
						'title'    => 'Create album track rollups',
						'Status'   => 'Todo',
						'Type'     => 'Feature',
						'Effort'   => 5,
						'Due'      => '2026-05-13',
						'Reminder' => '',
						'Tags'     => array( 'api', 'content' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Track count, runtime, and mood rollups should exercise nested relations.',
					),
					array(
						'title'    => 'Rewrite workspace landing page content',
						'Status'   => 'Doing',
						'Type'     => 'Docs',
						'Effort'   => 4,
						'Due'      => '2026-05-13',
						'Reminder' => '2026-05-12T09:30:00',
						'Tags'     => array( 'content', 'ui' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Pages should open with paragraphs, not duplicate-looking headings.',
					),
					array(
						'title'    => 'Add richer research page blocks',
						'Status'   => 'Todo',
						'Type'     => 'Docs',
						'Effort'   => 3,
						'Due'      => '2026-05-14',
						'Reminder' => '',
						'Tags'     => array( 'content' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Mix paragraphs, lists, quotes, separators, and collection views.',
					),
					array(
						'title'    => 'Check relation picker with dozens of rows',
						'Status'   => 'Todo',
						'Type'     => 'Research',
						'Effort'   => 3,
						'Due'      => '2026-05-14',
						'Reminder' => '',
						'Tags'     => array( 'testing', 'ui' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Use books, albums, and tasks to test search behavior.',
					),
					array(
						'title'    => 'Normalize seed option colors to palette names',
						'Status'   => 'Review',
						'Type'     => 'Chore',
						'Effort'   => 2,
						'Due'      => '2026-05-12',
						'Reminder' => '',
						'Tags'     => array( 'cleanup' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Avoid legacy hex colors in freshly seeded options.',
					),
					array(
						'title'    => 'Add people ownership relation',
						'Status'   => 'Todo',
						'Type'     => 'Feature',
						'Effort'   => 3,
						'Due'      => '2026-05-15',
						'Reminder' => '',
						'Tags'     => array( 'api' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Projects should point to owners and tasks to assignees.',
					),
					array(
						'title'    => 'Backfill task relation examples',
						'Status'   => 'Todo',
						'Type'     => 'Chore',
						'Effort'   => 4,
						'Due'      => '2026-05-15',
						'Reminder' => '',
						'Tags'     => array( 'content' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Spread tasks across projects and people.',
					),
					array(
						'title'    => 'Verify seeded pages update on rerun',
						'Status'   => 'Todo',
						'Type'     => 'Bug',
						'Effort'   => 2,
						'Due'      => '2026-05-16',
						'Reminder' => '',
						'Tags'     => array( 'testing' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Existing sparse pages should receive richer content.',
					),
					array(
						'title'    => 'Document reset command behavior',
						'Status'   => 'Done',
						'Type'     => 'Docs',
						'Effort'   => 1,
						'Due'      => '2026-05-07',
						'Reminder' => '',
						'Tags'     => array( 'content' ),
						'Done?'    => true,
						'URL'      => '',
						'Notes'    => 'Seed reset remains the cleanest way to remove legacy demo rows.',
					),
					array(
						'title'    => 'Audit row detail read-only relation fields',
						'Status'   => 'Blocked',
						'Type'     => 'Research',
						'Effort'   => 5,
						'Due'      => '2026-05-20',
						'Reminder' => '',
						'Tags'     => array( 'blocked', 'api' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Needs row-detail relation save path.',
					),
					array(
						'title'    => 'Tune sidebar icon spacing',
						'Status'   => 'Review',
						'Type'     => 'Bug',
						'Effort'   => 2,
						'Due'      => '2026-05-12',
						'Reminder' => '',
						'Tags'     => array( 'ui' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Collection title buttons need stable text truncation.',
					),
					array(
						'title'    => 'Create publisher catalog examples',
						'Status'   => 'Todo',
						'Type'     => 'Feature',
						'Effort'   => 4,
						'Due'      => '2026-05-16',
						'Reminder' => '',
						'Tags'     => array( 'content', 'api' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Books should point to publishers and publishers should roll up counts.',
					),
					array(
						'title'    => 'Create label catalog examples',
						'Status'   => 'Todo',
						'Type'     => 'Feature',
						'Effort'   => 4,
						'Due'      => '2026-05-17',
						'Reminder' => '',
						'Tags'     => array( 'content', 'api' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Albums should point to labels and labels should roll up releases.',
					),
					array(
						'title'    => 'Stress test table horizontal scroll',
						'Status'   => 'Todo',
						'Type'     => 'Research',
						'Effort'   => 3,
						'Due'      => '2026-05-18',
						'Reminder' => '',
						'Tags'     => array( 'testing', 'ui' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Larger field sets should make scroll behavior visible.',
					),
					array(
						'title'    => 'Add task footer calculation examples',
						'Status'   => 'Todo',
						'Type'     => 'Feature',
						'Effort'   => 2,
						'Due'      => '2026-05-18',
						'Reminder' => '',
						'Tags'     => array( 'ui', 'testing' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Effort and status fields are good calculation candidates.',
					),
					array(
						'title'    => 'Review collection creation defaults',
						'Status'   => 'Todo',
						'Type'     => 'Research',
						'Effort'   => 3,
						'Due'      => '2026-05-22',
						'Reminder' => '',
						'Tags'     => array( 'api' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'New user-created collections still start empty.',
					),
					array(
						'title'    => 'Design row page opening states',
						'Status'   => 'Todo',
						'Type'     => 'Feature',
						'Effort'   => 5,
						'Due'      => '2026-05-23',
						'Reminder' => '',
						'Tags'     => array( 'ui', 'design' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Side, modal, and full-page modes need predictable transitions.',
					),
					array(
						'title'    => 'Add import fixture notes',
						'Status'   => 'Todo',
						'Type'     => 'Docs',
						'Effort'   => 3,
						'Due'      => '2026-05-24',
						'Reminder' => '',
						'Tags'     => array( 'content' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Describe how relation seeding mirrors importer order.',
					),
					array(
						'title'    => 'Profile rollup formatting',
						'Status'   => 'Todo',
						'Type'     => 'Research',
						'Effort'   => 4,
						'Due'      => '2026-05-25',
						'Reminder' => '',
						'Tags'     => array( 'api', 'testing' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Rollups are computed on read, so larger seeds expose cost.',
					),
					array(
						'title'    => 'Polish empty date displays',
						'Status'   => 'Todo',
						'Type'     => 'Bug',
						'Effort'   => 2,
						'Due'      => '2026-05-19',
						'Reminder' => '',
						'Tags'     => array( 'ui' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Backlog projects intentionally keep blank dates.',
					),
					array(
						'title'    => 'Write manual QA checklist page',
						'Status'   => 'Todo',
						'Type'     => 'Docs',
						'Effort'   => 3,
						'Due'      => '2026-05-20',
						'Reminder' => '',
						'Tags'     => array( 'content', 'testing' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Use seeded pages as test scripts.',
					),
					array(
						'title'    => 'Check collection home preference with icons',
						'Status'   => 'Todo',
						'Type'     => 'Bug',
						'Effort'   => 2,
						'Due'      => '2026-05-21',
						'Reminder' => '',
						'Tags'     => array( 'testing', 'ui' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Collections can be homes too.',
					),
					array(
						'title'    => 'Clean up old paintings seed references',
						'Status'   => 'Todo',
						'Type'     => 'Chore',
						'Effort'   => 2,
						'Due'      => '2026-05-21',
						'Reminder' => '',
						'Tags'     => array( 'cleanup' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Fresh reset no longer needs the paintings collection.',
					),
					array(
						'title'    => 'Add saved view fixture once model exists',
						'Status'   => 'Blocked',
						'Type'     => 'Feature',
						'Effort'   => 5,
						'Due'      => '2026-06-05',
						'Reminder' => '',
						'Tags'     => array( 'blocked', 'api' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Waiting for named saved-view storage.',
					),
					array(
						'title'    => 'Review mobile table density',
						'Status'   => 'Todo',
						'Type'     => 'Research',
						'Effort'   => 3,
						'Due'      => '2026-05-26',
						'Reminder' => '',
						'Tags'     => array( 'ui', 'testing' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Richer seeds make cramped states easier to see.',
					),
					array(
						'title'    => 'Add cover image fallback tests',
						'Status'   => 'Todo',
						'Type'     => 'Bug',
						'Effort'   => 2,
						'Due'      => '2026-05-27',
						'Reminder' => '',
						'Tags'     => array( 'testing' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Seeded pages use bundled cover assets.',
					),
					array(
						'title'    => 'Prepare demo script for relation chips',
						'Status'   => 'Todo',
						'Type'     => 'Docs',
						'Effort'   => 2,
						'Due'      => '2026-05-28',
						'Reminder' => '',
						'Tags'     => array( 'content' ),
						'Done?'    => false,
						'URL'      => '',
						'Notes'    => 'Books, albums, and tasks each show a different relation pattern.',
					),
				),
			),
		);
	}

	/**
	 * Seeds a small realistic workspace hierarchy with starter content.
	 *
	 * @param array $collection_ids Collection IDs keyed by seeded collection slug.
	 * @return int Seeded Workspace page ID.
	 */
	private function seed_pages( array $collection_ids ): int {
		$banner = CORTEXT_PATH . 'assets/brand/banner.png';
		$tree   = array(
			array(
				'title'          => 'Welcome to Cortext',
				'legacy_titles'  => array( 'Workspace' ),
				'workspace_home' => true,
				'icon'           => '🏠',
				'cover'          => $banner,
				'content'        => $this->page_content(
					array(
						$this->paragraph( 'Welcome to Cortext. This seeded workspace is built to show the product as a real knowledge base: pages explain the work, collections hold structured records, and relations connect everything into a usable graph.' ),
						$this->quote_block( 'Use this page as the front door: scan the linked projects, open a row, follow a relation, then move into the library or music catalog for richer examples.' ),
						$this->heading( 'Start here', 2 ),
						$this->list_block(
							array(
								'Projects roll up task counts, effort, status, and due dates.',
								'Books connect to authors and publishers, with rollups on both sides.',
								'Albums connect to artists, labels, and tracks so nested relations are visible immediately.',
								'People own projects and receive tasks, which makes row detail and relation previews more realistic.',
							)
						),
						$this->data_view_block( $collection_ids['projects'] ?? 0 ),
						$this->data_view_block( $collection_ids['tasks'] ?? 0 ),
						$this->data_view_block( $collection_ids['people'] ?? 0 ),
					)
				),
				'children'       => array(
					array(
						'title'    => 'How to use this seed',
						'icon'     => '🛠️',
						'content'  => $this->page_content(
							array(
								$this->paragraph( 'Use this page as a short script for manual checks after starting wp-env or changing collection behavior.' ),
								$this->heading( 'Walkthrough', 2 ),
								$this->list_block(
									array(
										'Open Books and inspect Author, Publisher, and rollup columns.',
										'Open Albums and verify the Tracks relation plus Runtime and Track moods rollups.',
										'Open Projects, create a task from a filtered view, and confirm prefilled values still save.',
										'Set a collection as the workspace home, then reload and confirm the sidebar selection survives.',
									),
									true
								),
								$this->separator_block(),
								$this->paragraph( 'The seed intentionally includes empty dates, unread books, blocked tasks, and mixed option values so edge states appear without hand-editing rows.' ),
							)
						),
						'children' => array(
							array(
								'title'   => 'QA checklist',
								'icon'    => array(
									'type'  => 'wp',
									'name'  => 'check',
									'color' => 'green',
								),
								'content' => $this->page_content(
									array(
										$this->paragraph( 'A compact checklist for changes that touch the shell, data views, row detail, or page identity.' ),
										$this->heading( 'Checks', 2 ),
										$this->list_block(
											array(
												'Sidebar: collection icons render, selected rows stay legible, and long titles truncate.',
												'Tables: relation chips open the expected collection and row routes.',
												'Rollups: counts, sums, unique values, latest dates, and date ranges render without edit affordances.',
												'Pages: cover, icon, title, and first paragraph keep comfortable spacing.',
											)
										),
									)
								),
							),
							array(
								'title'    => 'Modeling notes',
								'icon'     => '📐',
								'content'  => $this->page_content(
									array(
										$this->paragraph( 'The seed follows the same modeling rule as the guide: collections are nouns, relations are explicit links, and rollups are derived views of those links.' ),
										$this->heading( 'Why these examples work', 2 ),
										$this->list_block(
											array(
												'Books and albums are concrete records that deserve their own collections.',
												'Authors, publishers, artists, and labels are related records, not repeated text fields.',
												'Tasks are operational records that can belong to projects and people simultaneously.',
											)
										),
									)
								),
								'children' => array(
									array(
										'title'   => 'Relation shapes',
										'icon'    => '🔗',
										'content' => $this->page_content(
											array(
												$this->paragraph( 'Most seeded relations are single on the row being edited and multiple on the reverse side. That gives tables simple cells while still making reverse lookups useful.' ),
												$this->data_view_block( $collection_ids['books'] ?? 0 ),
											)
										),
									),
									array(
										'title'   => 'Rollup shapes',
										'icon'    => array(
											'type'  => 'wp',
											'name'  => 'chartBar',
											'color' => 'purple',
										),
										'content' => $this->page_content(
											array(
												$this->paragraph( 'The seed covers each rollup family the UI currently knows how to display: counts, sums, unique option values, scalar dates, and date ranges.' ),
												$this->data_view_block( $collection_ids['authors'] ?? 0 ),
											)
										),
									),
								),
							),
						),
					),
					array(
						'title'    => 'Operations',
						'icon'     => '🎨',
						'content'  => $this->page_content(
							array(
								$this->paragraph( 'The operations area keeps the practical demo close to the home page: projects, tasks, and people are the fastest way to check inline editing and relation behavior.' ),
								$this->heading( 'Operational views', 2 ),
								$this->data_view_block( $collection_ids['projects'] ?? 0 ),
								$this->data_view_block( $collection_ids['tasks'] ?? 0 ),
							)
						),
						'children' => array(
							array(
								'title'   => 'Sprint review',
								'icon'    => '🧩',
								'content' => $this->page_content(
									array(
										$this->paragraph( 'A review page with enough structure to test editor content around embedded data views.' ),
										$this->heading( 'Agenda', 2 ),
										$this->list_block(
											array(
												'Review blocked tasks and owners.',
												'Open project rows in side mode and full mode.',
												'Check whether task rollups match the linked task rows.',
											),
											true
										),
										$this->data_view_block( $collection_ids['projects'] ?? 0 ),
									)
								),
							),
							array(
								'title'   => 'Demo script',
								'icon'    => array(
									'type'  => 'wp',
									'name'  => 'megaphone',
									'color' => 'orange',
								),
								'content' => $this->page_content(
									array(
										$this->paragraph( 'A lightweight talk track for showing Cortext from a fresh local environment.' ),
										$this->heading( 'Flow', 2 ),
										$this->list_block(
											array(
												'Start on Workspace to show pages plus embedded databases.',
												'Open Library to show relational data and rollups.',
												'Open Music Catalog to show a denser nested relation graph.',
												'Return to Operations and create a new task from the footer.',
											),
											true
										),
									)
								),
							),
						),
					),
				),
			),
			array(
				'title'   => 'Library',
				'icon'    => '📚',
				'cover'   => CORTEXT_PATH . 'seed-assets/covers/page-library.jpg',
				'content' => $this->page_content(
					array(
						$this->paragraph( 'The library cluster models books as records connected to authors and publishers. It is deliberately large enough to make relations, rollups, filters, and search feel real.' ),
						$this->heading( 'Catalog', 2 ),
						$this->data_view_block( $collection_ids['books'] ?? 0 ),
						$this->heading( 'People and imprints', 2 ),
						$this->data_view_block( $collection_ids['authors'] ?? 0 ),
						$this->data_view_block( $collection_ids['publishers'] ?? 0 ),
					)
				),
			),
			array(
				'title'   => 'Music Catalog',
				'icon'    => array(
					'type'  => 'wp',
					'name'  => 'audio',
					'color' => 'pink',
				),
				'content' => $this->page_content(
					array(
						$this->paragraph( 'The music cluster adds a denser relationship graph: albums belong to artists and labels, while tracks belong to albums and feed album-level rollups.' ),
						$this->heading( 'Albums and tracks', 2 ),
						$this->data_view_block(
							$collection_ids['albums'] ?? 0,
							array(
								'type'         => 'grid',
								'perPage'      => 25,
								'mediaField'   => 'cover',
								'fieldsByType' => array(
									'grid' => $this->data_view_field_ids_by_titles(
										$collection_ids['albums'] ?? 0,
										array( 'Artist', 'Year', 'Genre', 'Format' )
									),
								),
							)
						),
						$this->data_view_block( $collection_ids['tracks'] ?? 0 ),
						$this->heading( 'Artists and labels', 2 ),
						$this->data_view_block(
							$collection_ids['musicians'] ?? 0,
							array(
								'type'         => 'list',
								'fieldsByType' => array(
									'list' => $this->data_view_field_ids_by_titles(
										$collection_ids['musicians'] ?? 0,
										array( 'Country', 'Genres', 'Album count' )
									),
								),
							)
						),
						$this->data_view_block(
							$collection_ids['labels'] ?? 0,
							array(
								'type'         => 'list',
								'fieldsByType' => array(
									'list' => $this->data_view_field_ids_by_titles(
										$collection_ids['labels'] ?? 0,
										array( 'Country', 'Focus', 'Release count' )
									),
								),
							)
						),
					)
				),
			),
			array(
				'title'   => 'About Cortext',
				'icon'    => '🧠',
				'content' => $this->page_content(
					array(
						$this->paragraph( 'Cortext is a WordPress-native workspace for documents and structured knowledge. This seeded page gives the editor a realistic reference page without reusing the welcome cover asset.' ),
						$this->heading( 'What this seed demonstrates', 2 ),
						$this->list_block(
							array(
								'Pages can carry icons, body copy, and embedded collection views.',
								'Collections stay in WordPress storage but behave like typed workspace databases.',
								'Relations and rollups make the data model visible without custom tables.',
							)
						),
						$this->separator_block(),
						$this->paragraph( 'The data is intentionally synthetic where exact catalog history would be a distraction. The important part is the shape: rows, fields, relations, and pages that look plausible while exercising the product.' ),
					)
				),
			),
			array(
				'title'   => 'Scratch Notes',
				'icon'    => '📝',
				'content' => $this->page_content(
					array(
						$this->paragraph( 'This root-level page is intentionally open-ended. It gives the sidebar another sibling for ordering tests and gives the editor a low-stakes place for scratch blocks.' ),
						$this->heading( 'Loose notes', 2 ),
						$this->list_block(
							array(
								'Try dragging this page above and below Library.',
								'Add a block below this list and confirm autosave is quiet.',
								'Trash and restore it to check root-level restore behavior.',
							)
						),
					)
				),
			),
		);

		$workspace_page_id = 0;
		foreach ( $tree as $node ) {
			$page_id = $this->seed_page_tree( $node, 0 );
			if ( ! empty( $node['workspace_home'] ) ) {
				$workspace_page_id = $page_id;
			}
		}

		return $workspace_page_id;
	}

	private function seed_page_tree( array $node, int $parent_id ): int {
		$existing         = array();
		$candidate_titles = array_merge(
			array( $node['title'] ),
			$node['legacy_titles'] ?? array()
		);
		foreach ( $candidate_titles as $candidate_title ) {
			$existing = get_posts(
				array(
					'post_type'   => Document::POST_TYPE,
					'post_status' => array( 'draft', 'private', 'publish' ),
					'post_parent' => $parent_id,
					'title'       => $candidate_title,
					'numberposts' => 1,
					'fields'      => 'ids',
				)
			);
			if ( $existing ) {
				break;
			}
		}

		if ( $existing ) {
			$page_id = (int) $existing[0];
			WP_CLI::log( "Page '{$node['title']}' already exists (ID {$page_id})." );

			$page            = get_post( $page_id );
			$content_version = (string) get_post_meta( $page_id, '_cortext_seed_content_version', true );
			$needs_update    = $page && (
				(string) $page->post_title !== (string) $node['title'] ||
				( isset( $node['content'] ) && self::PAGE_CONTENT_VERSION !== $content_version )
			);
			if ( $needs_update ) {
				$update = array(
					'ID'         => $page_id,
					'post_title' => $node['title'],
				);
				if ( isset( $node['content'] ) ) {
					$update['post_content'] = $node['content'];
				}
				wp_update_post( $update );
				WP_CLI::log( "Updated page '{$node['title']}' with current demo content." );
			}
		} else {
			$page_id = wp_insert_post(
				array(
					'post_type'    => Document::POST_TYPE,
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
		} else {
			delete_post_meta( $page_id, '_thumbnail_id' );
			$this->remove_page_cover_block( (int) $page_id );
		}

		if ( isset( $node['content'] ) ) {
			update_post_meta( $page_id, '_cortext_seed_content_version', self::PAGE_CONTENT_VERSION );
		}

		foreach ( $node['children'] ?? array() as $child ) {
			$this->seed_page_tree( $child, (int) $page_id );
		}

		return (int) $page_id;
	}

	private function remove_page_cover_block( int $page_id ): void {
		$page = get_post( $page_id );
		if ( ! $page || ! str_contains( $page->post_content, '<!-- wp:cortext/page-cover' ) ) {
			return;
		}

		$blocks = parse_blocks( $page->post_content );
		$blocks = $this->filter_blocks_by_name( $blocks, 'cortext/page-cover' );
		wp_update_post(
			array(
				'ID'           => $page_id,
				'post_content' => serialize_blocks( $blocks ),
			)
		);
	}

	private function filter_blocks_by_name( array $blocks, string $block_name ): array {
		$filtered = array();

		foreach ( $blocks as $block ) {
			if ( ( $block['blockName'] ?? null ) === $block_name ) {
				continue;
			}
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->filter_blocks_by_name( $block['innerBlocks'], $block_name );
			}
			$filtered[] = $block;
		}

		return $filtered;
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
		$page_title = get_the_title( $page_id );
		WP_CLI::log( "Set workspace home to page '{$page_title}' (ID {$page_id})." );
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

		if ( 'page' === $parts[0] ) {
			return Document::POST_TYPE === $post->post_type && ! Document::is_collection( $id );
		}
		if ( 'collection' === $parts[0] ) {
			return Document::is_collection_post( $post );
		}
		return false;
	}

	/**
	 * Seeds a small default favorites list for fresh local workspaces.
	 *
	 * @param int $user_id           Seed user ID.
	 * @param int $workspace_page_id Welcome page ID.
	 */
	private function seed_favorites( int $user_id, int $workspace_page_id ): void {
		$current = get_user_meta( $user_id, self::FAVORITES_META_KEY, true );
		if ( $this->favorites_exist( $current ) ) {
			WP_CLI::log( 'Favorites already exist. Skipping.' );
			return;
		}

		$favorites  = array();
		$seen       = array();
		$candidates = array(
			array( 'page', $workspace_page_id ),
			array( 'page', $this->find_seeded_page_id( 'Library' ) ),
			array( 'page', $this->find_seeded_page_id( 'Music Catalog' ) ),
			array( 'page', $this->find_seeded_page_id( 'Operations' ) ),
		);

		foreach ( $candidates as $candidate ) {
			$kind = $candidate[0];
			$id   = (int) $candidate[1];
			$key  = "{$kind}:{$id}";
			if ( $id < 1 || isset( $seen[ $key ] ) || ! $this->workspace_home_exists( $key ) ) {
				continue;
			}

			$favorites[]  = $key;
			$seen[ $key ] = true;
			if ( 3 === count( $favorites ) ) {
				break;
			}
		}

		if ( ! $favorites ) {
			WP_CLI::warning( 'No valid favorites were found to seed.' );
			return;
		}

		update_user_meta( $user_id, self::FAVORITES_META_KEY, $favorites );
		WP_CLI::log( sprintf( 'Seeded %d sidebar favorites.', count( $favorites ) ) );
	}

	/**
	 * Returns true when stored favorites still point at valid targets.
	 *
	 * @param mixed $raw Stored user meta value.
	 */
	private function favorites_exist( $raw ): bool {
		if ( ! is_array( $raw ) ) {
			return false;
		}

		foreach ( $raw as $favorite ) {
			if ( is_string( $favorite ) && $this->workspace_home_exists( $favorite ) ) {
				return true;
			}
		}

		return false;
	}

	private function find_seeded_page_id( string $title ): int {
		$pages = get_posts(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				'title'       => $title,
				'numberposts' => 1,
				'fields'      => 'ids',
			)
		);

		return $pages ? (int) $pages[0] : 0;
	}

	private function page_content( array $blocks ): string {
		return implode( "\n\n", array_filter( $blocks ) );
	}

	/**
	 * Returns the JSON meta string for a seeded icon. Accepts either a
	 * raw emoji (string) or a structured array describing a WP icon
	 * (`['type' => 'wp', 'name' => ..., 'color' => ...]`), an image icon
	 * sourced from a bundled file (`['type' => 'image', 'source' => path]`),
	 * or an image icon downloaded from a URL (`['type' => 'image', 'url' => url]`).
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

		if ( 'image' === $type && ! empty( $icon['url'] ) ) {
			$attachment_id = $this->ensure_attachment_from_url( $icon['url'] );
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
			return $this->tag_seed_attachment( (int) $existing[0] );
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

		return $this->tag_seed_attachment( (int) $attach_id );
	}

	/**
	 * Downloads an image from a URL into the media library and returns the
	 * attachment ID. Idempotent across reseeds: subsequent calls with the
	 * same URL hit the existing attachment instead of re-downloading.
	 * Returns 0 on failure (no network, bad response, file write error).
	 * Bundle short-circuiting happens earlier in `maybe_apply_row_icon`, so
	 * this path only runs when a row's icon isn't bundled yet.
	 *
	 * @param string $url Absolute http(s) URL to an image.
	 */
	private function ensure_attachment_from_url( string $url ): int {
		$hash     = substr( md5( $url ), 0, 12 );
		$filename = 'seed-icon-' . $hash . '.jpg';

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
			return $this->tag_seed_attachment( (int) $existing[0] );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$tmp = download_url( $url, 30 );
		if ( is_wp_error( $tmp ) ) {
			WP_CLI::warning( "Failed to download icon from {$url}: " . $tmp->get_error_message() );
			return 0;
		}

		$upload_dir = wp_upload_dir();
		if ( ! empty( $upload_dir['error'] ) ) {
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
			@unlink( $tmp );
			return 0;
		}

		$dest = trailingslashit( $upload_dir['path'] ) . wp_unique_filename( $upload_dir['path'], $filename );
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.rename_rename
		if ( ! @rename( $tmp, $dest ) && ! @copy( $tmp, $dest ) ) {
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
			@unlink( $tmp );
			return 0;
		}
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
		@unlink( $tmp );

		$filetype  = wp_check_filetype( $dest );
		$attach_id = wp_insert_attachment(
			array(
				'guid'           => trailingslashit( $upload_dir['url'] ) . basename( $dest ),
				'post_mime_type' => $filetype['type'] ?? 'image/jpeg',
				'post_title'     => pathinfo( $filename, PATHINFO_FILENAME ),
				'post_content'   => '',
				'post_status'    => 'inherit',
			),
			$dest
		);
		if ( is_wp_error( $attach_id ) || ! $attach_id ) {
			return 0;
		}

		$metadata = wp_generate_attachment_metadata( $attach_id, $dest );
		wp_update_attachment_metadata( $attach_id, $metadata );

		return $this->tag_seed_attachment( (int) $attach_id );
	}

	private function tag_seed_attachment( int $attachment_id ): int {
		if ( $attachment_id > 0 ) {
			( new CortextMedia() )->tag( $attachment_id );
		}

		return $attachment_id;
	}

	/**
	 * Returns a deterministic image URL for a row in one of the visually
	 * meaningful seeded collections, or null if the collection isn't eligible.
	 * First tries to resolve the row to a real Wikimedia Commons file via
	 * Wikidata (so an author row gets that author's actual portrait); falls
	 * back to Lorem Picsum when no Commons image is available. Commons files
	 * carry their own per-image license (commonly CC-BY-SA): see each file's
	 * Commons page for credit; Picsum serves Unsplash photos under the
	 * Unsplash License (attribution appreciated, not required).
	 *
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	private function row_icon_url( string $collection_slug, string $title ): ?string {
		$icon_collections = array( 'authors', 'musicians', 'books', 'albums' );
		if ( ! in_array( $collection_slug, $icon_collections, true ) ) {
			return null;
		}
		$commons = $this->commons_image_url( $collection_slug, $title );
		if ( null !== $commons ) {
			return $commons;
		}
		// Books and albums rarely have P18 on Wikidata (covers are fair-use
		// only), so when the user opts in to real images, reach for Open
		// Library / Cover Art Archive instead of the picsum fallback. The
		// real cover doubles as the icon: a Discworld book row gets the
		// actual Discworld cover top-left and again as featured image.
		if ( $this->fetch_real_images && in_array( $collection_slug, array( 'books', 'albums' ), true ) ) {
			$cover = $this->real_cover_url( $collection_slug, $title );
			if ( null !== $cover ) {
				return $cover;
			}
		}
		$seed = sanitize_title( $collection_slug . '-' . $title );
		return 'https://picsum.photos/seed/' . rawurlencode( $seed ) . '/256/256';
	}

	/**
	 * Walks the icon-bearing collections, resolves each row's icon URL, and
	 * downloads the file into `seed-assets/icons/` so it can be committed and
	 * reused by future seeds. Idempotent: existing bundle files are kept.
	 * Honors `--full` so callers can bundle either the compact or full set.
	 */
	private function prefetch_icons(): void {
		$bundle_dir = CORTEXT_PATH . 'seed-assets/icons';
		if ( ! is_dir( $bundle_dir ) && ! wp_mkdir_p( $bundle_dir ) ) {
			WP_CLI::error( "Failed to create {$bundle_dir}" );
		}

		$collections = array_merge(
			$this->literature_collections(),
			$this->music_collections()
		);
		if ( ! $this->seed_full_dataset ) {
			$collections = $this->compact_collection_entries( $collections );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$downloaded = 0;
		$cached     = 0;
		$missed     = 0;
		$total      = 0;

		foreach ( $collections as $spec ) {
			$slug = (string) ( $spec['slug'] ?? '' );
			foreach ( ( $spec['entries'] ?? array() ) as $entry ) {
				$title = (string) ( $entry['title'] ?? '' );
				if ( '' === $title ) {
					continue;
				}
				$url = $this->row_icon_url( $slug, $title );
				if ( null === $url ) {
					continue;
				}
				++$total;
				$dest = $this->bundle_icon_path( $slug, $title );
				if ( file_exists( $dest ) ) {
					++$cached;
					continue;
				}
				$tmp = download_url( $url, 30 );
				if ( is_wp_error( $tmp ) ) {
					WP_CLI::warning( "Failed to download icon for {$slug}/{$title}: " . $tmp->get_error_message() );
					++$missed;
					continue;
				}
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
				if ( ! @copy( $tmp, $dest ) ) {
					// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
					@unlink( $tmp );
					WP_CLI::warning( "Failed to write {$dest}" );
					++$missed;
					continue;
				}
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
				@unlink( $tmp );
				++$downloaded;
				WP_CLI::log( "Bundled {$slug}/{$title} -> " . basename( $dest ) );
			}
		}

		WP_CLI::success(
			sprintf(
				'Prefetched %d / %d icons (%d already bundled, %d failed). Bundle directory: %s',
				$downloaded,
				$total,
				$cached,
				$missed,
				$bundle_dir
			)
		);
	}

	/**
	 * Walks book and album rows, resolves each to a real cover URL via
	 * Open Library / Cover Art Archive, and downloads into
	 * `seed-assets/covers/`. Existing bundle files are kept (so a curated
	 * stand-in survives), so re-running this is a way to fill in any gaps
	 * left by manual curation. Honors `--full`.
	 */
	private function prefetch_covers(): void {
		$bundle_dir = CORTEXT_PATH . 'seed-assets/covers';
		if ( ! is_dir( $bundle_dir ) && ! wp_mkdir_p( $bundle_dir ) ) {
			WP_CLI::error( "Failed to create {$bundle_dir}" );
		}

		$collections = array_merge(
			$this->literature_collections(),
			$this->music_collections()
		);
		if ( ! $this->seed_full_dataset ) {
			$collections = $this->compact_collection_entries( $collections );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$downloaded = 0;
		$cached     = 0;
		$missed     = 0;
		$total      = 0;

		foreach ( $collections as $spec ) {
			$slug = (string) ( $spec['slug'] ?? '' );
			if ( ! in_array( $slug, array( 'books', 'albums' ), true ) ) {
				continue;
			}
			foreach ( ( $spec['entries'] ?? array() ) as $entry ) {
				$title = (string) ( $entry['title'] ?? '' );
				if ( '' === $title ) {
					continue;
				}
				$url = $this->real_cover_url( $slug, $title );
				if ( null === $url ) {
					continue;
				}
				++$total;
				$dest = CORTEXT_PATH . 'seed-assets/covers/' . sanitize_title( $slug ) . '-' . sanitize_title( $title ) . '.jpg';
				if ( file_exists( $dest ) ) {
					++$cached;
					continue;
				}
				$tmp = download_url( $url, 30 );
				if ( is_wp_error( $tmp ) ) {
					WP_CLI::warning( "Failed to download cover for {$slug}/{$title}: " . $tmp->get_error_message() );
					++$missed;
					continue;
				}
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
				if ( ! @copy( $tmp, $dest ) ) {
					// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
					@unlink( $tmp );
					WP_CLI::warning( "Failed to write {$dest}" );
					++$missed;
					continue;
				}
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.unlink_unlink
				@unlink( $tmp );
				++$downloaded;
				WP_CLI::log( "Bundled cover {$slug}/{$title} -> " . basename( $dest ) );
			}
		}

		WP_CLI::success(
			sprintf(
				'Prefetched %d / %d covers (%d already bundled, %d failed).',
				$downloaded,
				$total,
				$cached,
				$missed
			)
		);
	}

	/**
	 * Looks up a real book or album cover URL with transient caching, the
	 * same way `commons_image_url()` caches Wikidata lookups. Books resolve
	 * via Open Library; albums via MusicBrainz + Cover Art Archive. Returns
	 * null when no cover is available; cached as `''` so misses don't re-hit.
	 *
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	private function real_cover_url( string $collection_slug, string $title ): ?string {
		$cache_key = 'cortext_seed_cover_' . md5( $collection_slug . '|' . $title );
		$cached    = get_transient( $cache_key );
		if ( false !== $cached ) {
			return '' === $cached ? null : (string) $cached;
		}

		$resolved = $this->resolve_real_cover_url( $collection_slug, $title );
		set_transient( $cache_key, $resolved ?? '', MONTH_IN_SECONDS );
		return $resolved;
	}

	private function resolve_real_cover_url( string $collection_slug, string $title ): ?string {
		if ( 'books' === $collection_slug ) {
			$author = $this->book_author_relations()[ $title ] ?? '';
			return $this->open_library_cover_url( $title, $author );
		}
		if ( 'albums' === $collection_slug ) {
			$artist = $this->album_artist_relations()[ $title ] ?? '';
			return $this->cover_art_archive_url( $title, $artist );
		}
		return null;
	}

	private function open_library_cover_url( string $title, string $author ): ?string {
		$params = array(
			'title' => $title,
			'limit' => 5,
		);
		if ( '' !== $author ) {
			$params['author'] = $author;
		}
		$data = $this->fetch_json( 'https://openlibrary.org/search.json?' . http_build_query( $params ) );
		if ( null === $data || empty( $data['docs'] ) ) {
			return null;
		}
		foreach ( $data['docs'] as $doc ) {
			$cover_id = (int) ( $doc['cover_i'] ?? 0 );
			if ( $cover_id > 0 ) {
				return 'https://covers.openlibrary.org/b/id/' . $cover_id . '-L.jpg';
			}
		}
		return null;
	}

	private function cover_art_archive_url( string $title, string $artist ): ?string {
		// MusicBrainz requires an explicit User-Agent and applies a 1 req/s
		// rate limit. The transient cache layer keeps this from biting once
		// covers are resolved; on first prefetch, allow ~1s per row.
		$query    = sprintf( 'release:"%s" AND artist:"%s"', addslashes( $title ), addslashes( $artist ) );
		$response = wp_remote_get(
			'https://musicbrainz.org/ws/2/release/?' . http_build_query(
				array(
					'query' => $query,
					'fmt'   => 'json',
					'limit' => 10,
				)
			),
			array(
				'timeout' => 15,
				'headers' => array(
					'User-Agent' => 'CortextSeeder/1.0 (https://github.com/Automattic/cortext)',
				),
			)
		);
		if ( is_wp_error( $response ) ) {
			return null;
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) || empty( $data['releases'] ) ) {
			return null;
		}

		foreach ( $data['releases'] as $release ) {
			$mbid = (string) ( $release['id'] ?? '' );
			if ( '' === $mbid ) {
				continue;
			}
			$cover_url = "https://coverartarchive.org/release/{$mbid}/front-500";
			$check     = wp_remote_head(
				$cover_url,
				array(
					'timeout'     => 10,
					'redirection' => 3,
				)
			);
			if ( is_wp_error( $check ) ) {
				continue;
			}
			$code = (int) wp_remote_retrieve_response_code( $check );
			if ( 200 === $code ) {
				return $cover_url;
			}
		}
		return null;
	}

	/**
	 * Resolves a row to a Wikimedia Commons file URL by searching Wikidata
	 * for the title (with a collection-specific hint to disambiguate) and
	 * grabbing the entity's `P18` (image) claim. Returns the Commons
	 * `Special:FilePath` URL with `?width=256`, which 302s to a thumbnail.
	 * Returns null on any failure (no entity, no P18, network error) so the
	 * caller can fall back.
	 *
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	private function commons_image_url( string $collection_slug, string $title ): ?string {
		// Resolving a Commons URL takes two HTTP round-trips to Wikidata,
		// which dominates seed time. Cache the resolved URL (or a sentinel
		// for misses) per (slug, title) so a `--reset` reseed reuses prior
		// lookups instead of re-querying. Cache TTL is generous because
		// Wikidata P18 is stable; clear `cortext_seed_commons_*` transients
		// to force a refresh.
		$cache_key = 'cortext_seed_commons_' . md5( $collection_slug . '|' . $title );
		$cached    = get_transient( $cache_key );
		if ( false !== $cached ) {
			return '' === $cached ? null : (string) $cached;
		}

		$resolved = $this->resolve_commons_image_url( $collection_slug, $title );
		set_transient( $cache_key, $resolved ?? '', MONTH_IN_SECONDS );
		return $resolved;
	}

	private function resolve_commons_image_url( string $collection_slug, string $title ): ?string {
		// Wikidata's `wbsearchentities` matches labels/aliases, so appending an
		// English hint to the query kills matches. Disambiguate by scanning
		// the top results' descriptions for collection-appropriate keywords
		// instead, and fall through to the top hit if none match.
		$keyword_map = array(
			'authors'   => array( 'author', 'writer', 'novelist', 'poet', 'essayist' ),
			'musicians' => array( 'musician', 'singer', 'composer', 'band', 'rapper', 'guitarist', 'drummer', 'pianist', 'rock', 'jazz', 'pop', 'electronic' ),
			'books'     => array( 'novel', 'book', 'novella', 'short story', 'story collection' ),
			'albums'    => array( 'album', 'studio album', 'compilation', 'live album', 'ep' ),
		);
		$keywords    = $keyword_map[ $collection_slug ] ?? null;
		if ( null === $keywords ) {
			return null;
		}

		$entity_id = $this->wikidata_resolve_entity( $title, $keywords );
		if ( null === $entity_id ) {
			return null;
		}

		$filename = $this->wikidata_image_filename( $entity_id );
		if ( null === $filename ) {
			return null;
		}

		return 'https://commons.wikimedia.org/wiki/Special:FilePath/'
			. rawurlencode( $filename )
			. '?width=256';
	}

	/**
	 * Searches Wikidata for `$title` and returns the QID of the first result
	 * whose description contains one of the collection-appropriate keywords.
	 * Falls back to the top hit if none of the top results match (better than
	 * dropping the row entirely; wrong matches still get caught downstream
	 * when the entity has no P18). Returns null only when search is empty.
	 *
	 * @param string            $title    Row title.
	 * @param array<int,string> $keywords Lowercase keywords to look for in entity descriptions.
	 */
	private function wikidata_resolve_entity( string $title, array $keywords ): ?string {
		$url  = 'https://www.wikidata.org/w/api.php?' . http_build_query(
			array(
				'action'   => 'wbsearchentities',
				'search'   => $title,
				'language' => 'en',
				'format'   => 'json',
				'limit'    => 10,
			)
		);
		$data = $this->fetch_json( $url );
		if ( null === $data || empty( $data['search'] ) ) {
			return null;
		}
		foreach ( $data['search'] as $hit ) {
			$description = strtolower( (string) ( $hit['description'] ?? '' ) );
			if ( '' === $description ) {
				continue;
			}
			foreach ( $keywords as $keyword ) {
				if ( false !== strpos( $description, $keyword ) ) {
					return isset( $hit['id'] ) ? (string) $hit['id'] : null;
				}
			}
		}
		return isset( $data['search'][0]['id'] ) ? (string) $data['search'][0]['id'] : null;
	}

	private function wikidata_image_filename( string $entity_id ): ?string {
		$url    = 'https://www.wikidata.org/w/api.php?' . http_build_query(
			array(
				'action' => 'wbgetentities',
				'ids'    => $entity_id,
				'props'  => 'claims',
				'format' => 'json',
			)
		);
		$data   = $this->fetch_json( $url );
		$claims = $data['entities'][ $entity_id ]['claims']['P18'] ?? null;
		if ( ! is_array( $claims ) ) {
			return null;
		}
		foreach ( $claims as $claim ) {
			$value = $claim['mainsnak']['datavalue']['value'] ?? '';
			if ( '' !== $value ) {
				return (string) $value;
			}
		}
		return null;
	}

	private function fetch_json( string $url ): ?array {
		$response = wp_remote_get( $url, array( 'timeout' => 15 ) );
		if ( is_wp_error( $response ) ) {
			return null;
		}
		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );
		return is_array( $data ) ? $data : null;
	}

	/**
	 * Resolves the row's seeded icon (if any), downloads the image, and
	 * writes the document-icon meta. Short-circuits before any HTTP work in
	 * three places: rows that already have an icon, collections that don't
	 * grant icons, and rows whose icon is bundled in `seed-assets/icons/`
	 * (the common case in fresh worktrees). Only rows missing from the
	 * bundle pay the Wikidata + image-download cost.
	 *
	 * @param int    $entry_id        Row post ID.
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	private function maybe_apply_row_icon( int $entry_id, string $collection_slug, string $title ): void {
		if ( $entry_id <= 0 ) {
			return;
		}
		if ( '' !== (string) get_post_meta( $entry_id, DocumentIdentity::META_KEY, true ) ) {
			return;
		}

		// `--with-real-images` overrides the bundled icon for books and albums:
		// the existing bundle was prefetched against picsum (Wikidata has no
		// P18 for most modern works), so the bundled file is a random photo
		// rather than the real cover. Reach for the live cover lookup instead.
		// Authors/musicians keep using the bundle: their Commons portraits
		// are correct already.
		$skip_bundle = $this->fetch_real_images
			&& in_array( $collection_slug, array( 'books', 'albums' ), true );

		if ( ! $skip_bundle ) {
			$bundle_path = $this->bundled_icon_path( $collection_slug, $title );
			if ( null !== $bundle_path ) {
				$icon_meta = $this->serialize_icon_meta(
					array(
						'type'   => 'image',
						'source' => $bundle_path,
					)
				);
				if ( '' !== $icon_meta ) {
					update_post_meta( $entry_id, DocumentIdentity::META_KEY, $icon_meta );
					WP_CLI::log( sprintf( '  Icon (bundle) attached to entry %d.', $entry_id ) );
				}
				return;
			}
		}

		// Default seed is fully offline: if the bundle didn't have a match,
		// don't reach for Wikidata or Picsum. The user opts in to network
		// lookups with `--with-real-images`, or runs `--prefetch-icons` to
		// extend the bundle once.
		if ( ! $this->fetch_real_images ) {
			return;
		}

		$icon_url = $this->row_icon_url( $collection_slug, $title );
		if ( null === $icon_url ) {
			return;
		}
		$icon_meta = $this->serialize_icon_meta(
			array(
				'type' => 'image',
				'url'  => $icon_url,
			)
		);
		if ( '' !== $icon_meta ) {
			update_post_meta( $entry_id, DocumentIdentity::META_KEY, $icon_meta );
			$source = $this->row_icon_source_label( $icon_url );
			WP_CLI::log( sprintf( '  Icon (%s) attached to entry %d.', $source, $entry_id ) );
		}
	}

	private function row_icon_source_label( string $url ): string {
		if ( false !== strpos( $url, 'commons.wikimedia.org' ) ) {
			return 'commons';
		}
		if ( false !== strpos( $url, 'openlibrary.org' ) ) {
			return 'open-library';
		}
		if ( false !== strpos( $url, 'coverartarchive.org' ) ) {
			return 'cover-art-archive';
		}
		return 'picsum';
	}

	/**
	 * Returns the absolute path to the bundled icon for a row, or null if
	 * none exists. Bundle filenames are deterministic on `(slug, title)`
	 * (not on URL hash) so the seeder can probe for them without first
	 * resolving Wikidata, which is the whole point of the bundle.
	 *
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	private function bundled_icon_path( string $collection_slug, string $title ): ?string {
		$icon_collections = array( 'authors', 'musicians', 'books', 'albums' );
		if ( ! in_array( $collection_slug, $icon_collections, true ) ) {
			return null;
		}
		$path = $this->bundle_icon_path( $collection_slug, $title );
		return file_exists( $path ) ? $path : null;
	}

	private function bundle_icon_path( string $collection_slug, string $title ): string {
		$slug = sanitize_title( $collection_slug );
		$key  = sanitize_title( $title );
		return CORTEXT_PATH . 'seed-assets/icons/' . $slug . '-' . $key . '.jpg';
	}

	/**
	 * Attaches a bundled cover image to a row when one is provided in
	 * `seed-assets/covers/<slug>-<title-slug>.jpg`. A few album rows also use
	 * their bundled album-art icon when there is no separate cover asset or
	 * requested live cover. That gives the seeded grid a mix of covered and
	 * uncovered cards while still working offline. Skips rows that already
	 * have `_thumbnail_id`, so a manually-set cover survives a reseed.
	 *
	 * @param int    $entry_id        Row post ID.
	 * @param string $collection_slug Source collection slug.
	 * @param string $title           Row title.
	 */
	private function maybe_apply_row_cover( int $entry_id, string $collection_slug, string $title ): void {
		if ( $entry_id <= 0 ) {
			return;
		}
		if ( (int) get_post_meta( $entry_id, '_thumbnail_id', true ) > 0 ) {
			return;
		}
		$slug = sanitize_title( $collection_slug );
		$key  = sanitize_title( $title );
		$path = CORTEXT_PATH . 'seed-assets/covers/' . $slug . '-' . $key . '.jpg';
		if ( file_exists( $path ) ) {
			$cover_id = $this->ensure_attachment_from_path( $path );
			if ( $cover_id > 0 ) {
				update_post_meta( $entry_id, '_thumbnail_id', $cover_id );
				WP_CLI::log( sprintf( '  Cover (bundle) attached to entry %d.', $entry_id ) );
			}
			return;
		}

		if ( ! $this->fetch_real_images ) {
			$this->maybe_apply_album_icon_as_row_cover( $entry_id, $collection_slug, $title );
			return;
		}
		$url = $this->real_cover_url( $collection_slug, $title );
		if ( null === $url ) {
			$this->maybe_apply_album_icon_as_row_cover( $entry_id, $collection_slug, $title );
			return;
		}
		$cover_id = $this->ensure_attachment_from_url( $url );
		if ( $cover_id > 0 ) {
			update_post_meta( $entry_id, '_thumbnail_id', $cover_id );
			$source = false !== strpos( $url, 'openlibrary.org' ) ? 'open-library' : 'cover-art-archive';
			WP_CLI::log( sprintf( '  Cover (%s) attached to entry %d.', $source, $entry_id ) );
			return;
		}

		$this->maybe_apply_album_icon_as_row_cover( $entry_id, $collection_slug, $title );
	}

	private function maybe_apply_album_icon_as_row_cover( int $entry_id, string $collection_slug, string $title ): void {
		if ( 'albums' !== sanitize_title( $collection_slug ) ) {
			return;
		}

		$covered_album_keys = array(
			'abbey-road',
			'the-dark-side-of-the-moon',
			'purple-rain',
			'save-rock-and-roll',
		);
		if ( ! in_array( sanitize_title( $title ), $covered_album_keys, true ) ) {
			return;
		}

		$path = $this->bundle_icon_path( $collection_slug, $title );
		if ( ! file_exists( $path ) ) {
			return;
		}

		$cover_id = $this->ensure_attachment_from_path( $path );
		if ( $cover_id > 0 ) {
			update_post_meta( $entry_id, '_thumbnail_id', $cover_id );
			WP_CLI::log( sprintf( '  Cover (album icon bundle) attached to entry %d.', $entry_id ) );
		}
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

	/**
	 * Builds a Gutenberg list block.
	 *
	 * @param string[] $items List item text.
	 * @param bool     $ordered Whether to render an ordered list.
	 */
	private function list_block( array $items, bool $ordered = false ): string {
		$tag      = $ordered ? 'ol' : 'ul';
		$attrs    = $ordered ? ' {"ordered":true}' : '';
		$children = '';

		foreach ( $items as $item ) {
			$children .= sprintf( '<li>%s</li>', esc_html( $item ) );
		}

		return sprintf(
			'<!-- wp:list%1$s --><%2$s class="wp-block-list">%3$s</%2$s><!-- /wp:list -->',
			$attrs,
			$tag,
			$children
		);
	}

	private function quote_block( string $text ): string {
		return sprintf(
			'<!-- wp:quote --><blockquote class="wp-block-quote"><p>%s</p></blockquote><!-- /wp:quote -->',
			esc_html( $text )
		);
	}

	private function separator_block(): string {
		return '<!-- wp:separator --><hr class="wp-block-separator has-alpha-channel-opacity"/><!-- /wp:separator -->';
	}

	/**
	 * Builds a realistic body for a seeded row.
	 *
	 * @param array<string,mixed> $spec  Collection spec.
	 * @param array<string,mixed> $entry Row values.
	 */
	private function entry_content( array $spec, array $entry ): string {
		$slug  = (string) ( $spec['slug'] ?? '' );
		$title = (string) ( $entry['title'] ?? 'Untitled' );
		$notes = isset( $entry['Notes'] ) ? trim( (string) $entry['Notes'] ) : '';

		$blocks = array(
			$this->paragraph( $this->entry_intro( $slug, $title ) ),
		);

		if ( '' !== $notes ) {
			$blocks[] = $this->quote_block( $notes );
		}

		$items = $this->entry_summary_items( $entry );
		if ( $items ) {
			$blocks[] = $this->heading( $this->entry_summary_heading( $slug ), 2 );
			$blocks[] = $this->list_block( $items );
		}

		$followup = $this->entry_followup( $slug );
		if ( '' !== $followup ) {
			$blocks[] = $this->separator_block();
			$blocks[] = $this->paragraph( $followup );
		}

		return $this->page_content( $blocks );
	}

	private function entry_intro( string $slug, string $title ): string {
		return match ( $slug ) {
			'authors'    => "{$title} is an author profile with enough context to make the row detail feel like a real research note rather than an empty database record.",
			'publishers' => "{$title} is an imprint record used by the library sample to demonstrate catalog metadata, reverse relations, and publisher-level rollups.",
			'books'      => "{$title} is a seeded book record with reading context, catalog fields, and links to author and publisher records.",
			'musicians'  => "{$title} is an artist profile for the music catalog, connected to album records and release rollups.",
			'labels'     => "{$title} is a label profile that gives albums a realistic publishing home and makes reverse catalog views useful.",
			'albums'     => "{$title} is an album record with release metadata, track links, and rollups that summarize the connected tracks.",
			'tracks'     => "{$title} is a track note used to check dense relation chips, numeric duration rollups, and short-form row bodies.",
			'people'     => "{$title} is a team member profile that participates in task assignment, project ownership, and people-centric rollups.",
			'projects'   => "{$title} is an operational project brief connected to tasks, owners, status fields, and due-date rollups.",
			'tasks'      => "{$title} is a seeded task brief with enough body content to test opening, editing, and saving row pages.",
			default      => "{$title} is a seeded row with body content for row-detail and full-page editing checks.",
		};
	}

	private function entry_summary_heading( string $slug ): string {
		return match ( $slug ) {
			'authors', 'musicians', 'people' => 'Profile',
			'books'                         => 'Reading state',
			'publishers', 'labels'          => 'Catalog role',
			'albums', 'tracks'              => 'Listening notes',
			'projects', 'tasks'             => 'Working notes',
			default                         => 'Details',
		};
	}

	/**
	 * Returns human-readable row field summaries.
	 *
	 * @param array<string,mixed> $entry Row values.
	 * @return string[]
	 */
	private function entry_summary_items( array $entry ): array {
		$items = array();
		foreach ( $entry as $field => $value ) {
			if ( in_array( $field, array( 'title', 'icon', 'Notes', 'Website', 'URL', 'Project URL' ), true ) ) {
				continue;
			}

			$formatted = $this->entry_value_label( $value );
			if ( '' === $formatted ) {
				continue;
			}

			$items[] = "{$field}: {$formatted}";
		}
		return array_slice( $items, 0, 6 );
	}

	/**
	 * Formats a seeded row field for body text.
	 *
	 * @param mixed $value Field value.
	 */
	private function entry_value_label( $value ): string {
		if ( is_bool( $value ) ) {
			return $value ? 'Yes' : 'No';
		}
		if ( is_array( $value ) ) {
			$values = array_filter(
				array_map(
					static fn( $item ): string => trim( (string) $item ),
					$value
				)
			);
			return implode( ', ', $values );
		}
		return trim( (string) $value );
	}

	private function entry_followup( string $slug ): string {
		return match ( $slug ) {
			'authors'    => 'Open the Books relation from this row to inspect the connected titles and the rollups derived from them.',
			'publishers' => 'Use this row to check reverse catalog chips, publisher rollups, and table cells with mixed text lengths.',
			'books'      => 'This row is useful for testing title editing, relation chips, select values, numeric ratings, and row page body autosave.',
			'musicians'  => 'The related albums provide enough surface area to inspect artist rollups and move between records from relation chips.',
			'labels'     => 'The label catalog makes reverse relations feel meaningful even when the row itself is mostly metadata.',
			'albums'     => 'Open related tracks to compare this album body with the track-level notes and runtime rollups.',
			'tracks'     => 'This short row body keeps track records lightweight while still making full-page row editing visible.',
			'people'     => 'Assignments and owned projects make this a good row for testing people lookups from several relation fields.',
			'projects'   => 'The linked tasks drive the rollups on this row, so it is a compact test case for project dashboards.',
			'tasks'      => 'Use this task body for row-detail editing checks alongside status, due date, effort, and assignment fields.',
			default      => '',
		};
	}

	private function data_view_block( int $collection_id, array $view_overrides = array() ): string {
		if ( $collection_id <= 0 ) {
			return '';
		}

		$styles = $this->data_view_layout_styles( $collection_id );

		$view = array(
			'type'          => 'table',
			'fields'        => array(),
			'sort'          => null,
			'filters'       => array(),
			'calculations'  => array(),
			'perPage'       => 25,
			'page'          => 1,
			'search'        => '',
			'layout'        => array(
				'density' => 'compact',
			),
			'layoutByType'  => array(
				'table' => array(
					'density' => 'compact',
				),
				'grid'  => array(),
				'list'  => array(),
			),
			'fieldsByType'  => array(
				'grid' => array(),
				'list' => array(),
			),
			'rowDetailMode' => 'side',
		);

		if ( $styles ) {
			$view['layout']['styles']                = $styles;
			$view['layoutByType']['table']['styles'] = $styles;
		}

		if ( $view_overrides ) {
			$layout_by_type_overrides = isset( $view_overrides['layoutByType'] ) && is_array( $view_overrides['layoutByType'] )
				? $view_overrides['layoutByType']
				: array();
			$fields_by_type_overrides = isset( $view_overrides['fieldsByType'] ) && is_array( $view_overrides['fieldsByType'] )
				? $view_overrides['fieldsByType']
				: array();
			unset( $view_overrides['layoutByType'], $view_overrides['fieldsByType'] );

			$view = array_merge( $view, $view_overrides );
			if ( $layout_by_type_overrides ) {
				$view['layoutByType'] = array_replace( $view['layoutByType'], $layout_by_type_overrides );
			}
			if ( $fields_by_type_overrides ) {
				$view['fieldsByType'] = array_replace( $view['fieldsByType'], $fields_by_type_overrides );
			}
		}

		$type = 'table';
		if ( isset( $view['type'] ) && in_array( $view['type'], array( 'table', 'grid', 'list' ), true ) ) {
			$type = $view['type'];
		}

		$view['type'] = $type;

		if ( ! isset( $view['layoutByType'][ $type ] ) || ! is_array( $view['layoutByType'][ $type ] ) ) {
			$view['layoutByType'][ $type ] = array();
		}
		$view['layout'] = $view['layoutByType'][ $type ];

		if ( 'grid' === $type && empty( $view['mediaField'] ) ) {
			$view['mediaField'] = 'cover';
		}

		$attributes = array(
			'collectionId' => $collection_id,
			'view'         => $view,
		);

		return sprintf(
			'<!-- wp:cortext/data-view %s /-->',
			wp_json_encode( $attributes )
		);
	}

	/**
	 * Returns DataViews field ids for visible list/grid fields by seeded title.
	 *
	 * @param int      $collection_id Collection post ID.
	 * @param string[] $titles        Field titles, in display order.
	 * @return string[]
	 */
	private function data_view_field_ids_by_titles( int $collection_id, array $titles ): array {
		if ( $collection_id <= 0 ) {
			return array();
		}

		$by_title = $this->attached_fields_by_title( $collection_id );
		$ids      = array();
		foreach ( $titles as $title ) {
			$title = (string) $title;
			if ( isset( $by_title[ $title ] ) ) {
				$ids[] = 'field-' . (int) $by_title[ $title ];
			}
		}

		return array_values( array_unique( $ids ) );
	}

	/**
	 * Builds default table column widths for seeded data-view blocks.
	 *
	 * Heuristics use field title and type cues so demo collections paint with
	 * comfortable widths out of the box (Title 260, Notes/Description 360,
	 * pluralized relations 280, rollups by aggregator family, etc). Lives in
	 * the seeder because it is demo presentation, not part of the document
	 * model.
	 *
	 * @param int $collection_id Collection ID.
	 * @return array<string,array{width:int,minWidth:int,maxWidth:int}>
	 */
	private function data_view_layout_styles( int $collection_id ): array {
		$styles = array(
			'title' => $this->data_view_width_style( 'Title', 'title' ),
		);

		foreach ( get_post_meta( $collection_id, 'cortext_fields', false ) as $field_id ) {
			$field_id = (int) $field_id;
			$field    = get_post( $field_id );
			if ( ! $field || Field::POST_TYPE !== $field->post_type ) {
				continue;
			}

			$type                          = (string) get_post_meta( $field_id, 'type', true );
			$styles[ "field-{$field_id}" ] = $this->data_view_width_style(
				$field->post_title,
				'' !== $type ? $type : 'text'
			);
		}

		return $styles;
	}

	/**
	 * Returns a persisted DataViews width style for one seeded column.
	 *
	 * @param string $field_title Field title.
	 * @param string $field_type Field type.
	 * @return array{width:int,minWidth:int,maxWidth:int}
	 */
	private function data_view_width_style( string $field_title, string $field_type ): array {
		$width     = $this->data_view_column_width( $field_title, $field_type );
		$min_width = match ( $field_type ) {
			'title'             => 80,
			'date', 'datetime'  => 64,
			default             => 32,
		};

		return array(
			'width'    => $width,
			'minWidth' => $min_width,
			'maxWidth' => $width,
		);
	}

	private function data_view_column_width( string $field_title, string $field_type ): int {
		$title = strtolower( $field_title );

		if ( 'title' === $field_type ) {
			return 260;
		}
		if ( 'icon' === $title ) {
			return 56;
		}
		if ( str_contains( $title, 'notes' ) || str_contains( $title, 'description' ) ) {
			return 360;
		}
		if ( str_contains( $title, 'website' ) || str_contains( $title, 'url' ) ) {
			return 260;
		}

		if ( 'relation' === $field_type ) {
			return str_ends_with( $title, 's' ) ? 280 : 220;
		}

		if ( 'rollup' === $field_type ) {
			if ( str_contains( $title, 'count' ) ) {
				return 112;
			}
			if ( str_contains( $title, 'genres' ) || str_contains( $title, 'statuses' ) || str_contains( $title, 'moods' ) ) {
				return 240;
			}
			if ( str_contains( $title, 'latest' ) || str_contains( $title, 'range' ) ) {
				return 160;
			}
			return 180;
		}

		return match ( $field_type ) {
			'checkbox'    => 76,
			'number'      => 96,
			'date',
			'datetime'    => 128,
			'select'      => 152,
			'multiselect' => 220,
			'email',
			'url'         => 260,
			default       => $this->data_view_text_column_width( $title ),
		};
	}

	private function data_view_text_column_width( string $field_title ): int {
		if ( in_array( $field_title, array( 'country', 'city', 'role' ), true ) ) {
			return 152;
		}
		if ( in_array( $field_title, array( 'source', 'format', 'type' ), true ) ) {
			return 144;
		}
		return 200;
	}

	private function seed_collection( array $spec ): int {
		$slug = $spec['slug'];

		// 1. Find or create collection. `get_posts` defaults to `post_status:
		// publish`, but our seeded collections are private; without an
		// explicit status the lookup never matches and re-running the
		// seeder accumulates duplicate collections sharing a slug.
		$existing = get_posts(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				// phpcs:ignore WordPress.DB.SlowDBQuery
				'meta_key'    => 'cortext_seed_slug',
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
					'post_type'   => Document::POST_TYPE,
					'post_title'  => $spec['title'],
					'post_status' => 'private',
				),
				true
			);

			if ( is_wp_error( $collection_id ) ) {
				WP_CLI::error( "Failed to create collection '{$spec['title']}': " . $collection_id->get_error_message() );
			}

			update_post_meta( $collection_id, 'cortext_seed_slug', $slug );
			WP_CLI::log( "Created collection '{$spec['title']}' (ID {$collection_id})." );
		}

		// In the universal-document model rows live in `crtxt_document`, which
		// the plugin registers on init; no per-collection CPT registration is
		// needed here.

		// 3. Find or create fields, attach to collection.
		$existing_field_ids = $this->remove_seeded_icon_field(
			$collection_id,
			get_post_meta( $collection_id, 'cortext_fields', false )
		);
		$field_ids          = array();
		$field_types        = array();
		$fields             = $spec['fields'];

		foreach ( $fields as $title => $config ) {
			$type          = is_array( $config ) ? $config['type'] : $config;
			$options       = is_array( $config ) && isset( $config['options'] ) ? $config['options'] : null;
			$number_format = is_array( $config ) && isset( $config['number_format'] ) ? $config['number_format'] : null;

			$field_types[ $title ] = $type;

			$found = $this->find_attached_field( $title, $existing_field_ids );

			if ( $found ) {
				update_post_meta( $found, 'type', $type );
				if ( null !== $options ) {
					update_post_meta( $found, 'options', wp_json_encode( $options ) );
				} else {
					delete_post_meta( $found, 'options' );
				}
				if ( null !== $number_format ) {
					update_post_meta( $found, 'number_format', wp_json_encode( $number_format ) );
				} else {
					delete_post_meta( $found, 'number_format' );
				}
				$field_ids[ $title ] = $found;
				WP_CLI::log( "Field '{$title}' already exists (ID {$found}); refreshed seed metadata." );
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
			if ( null !== $number_format ) {
				update_post_meta( $field_id, 'number_format', wp_json_encode( $number_format ) );
			}
			add_post_meta( $collection_id, 'cortext_fields', $field_id );
			$field_ids[ $title ] = $field_id;
			WP_CLI::log( "Created field '{$title}' (ID {$field_id}, type: {$type})." );
		}

		// 4. Register field meta on the entry CPT (safe to call repeatedly).
		foreach ( $field_ids as $title => $field_id ) {
			$type = $field_types[ $title ];
			register_post_meta(
				Document::POST_TYPE,
				"field-{$field_id}",
				array(
					'type'         => \Cortext\Fields\FieldTypeRegistry::wp_meta_type( $type ),
					'single'       => 'multiselect' !== $type,
					'show_in_rest' => true,
				)
			);
		}

		// 5. Insert entries that don't already exist (matched by title).
		$collection_term_id = Relations::trait_term_id_for_collection( (int) $collection_id );
		$existing_entries   = get_posts(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'any',
				'numberposts' => -1,
				'fields'      => 'ids',
				'tax_query'   => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
					array(
						'taxonomy' => TraitTaxonomy::TAXONOMY,
						'field'    => 'term_id',
						'terms'    => array( $collection_term_id ),
					),
				),
			)
		);

		$existing_entries_by_title = array();
		foreach ( $existing_entries as $entry_id ) {
			$existing_entry = get_post( (int) $entry_id );
			if ( $existing_entry ) {
				$existing_entries_by_title[ $existing_entry->post_title ] = (int) $entry_id;
			}
		}

		foreach ( $spec['entries'] as $entry ) {
			$entry_content = $this->entry_content( $spec, $entry );
			if ( isset( $existing_entries_by_title[ $entry['title'] ] ) ) {
				$existing_entry_id = $existing_entries_by_title[ $entry['title'] ];
				$this->update_entry_content( $existing_entry_id, $entry_content );
				$this->maybe_apply_row_icon( $existing_entry_id, $spec['slug'], $entry['title'] );
				$this->maybe_apply_row_cover( $existing_entry_id, $spec['slug'], $entry['title'] );
				WP_CLI::log( "Entry '{$entry['title']}' already exists. Skipping." );
				continue;
			}

			$entry_id = wp_insert_post(
				array(
					'post_type'    => Document::POST_TYPE,
					'post_title'   => $entry['title'],
					'post_status'  => 'private',
					'post_content' => $entry_content,
				),
				true
			);

			if ( is_wp_error( $entry_id ) ) {
				WP_CLI::error( "Failed to create entry '{$entry['title']}': " . $entry_id->get_error_message() );
			}

			$trait_term_id = Relations::trait_term_id_for_collection( (int) $collection_id );
			if ( $trait_term_id > 0 ) {
				wp_set_object_terms( (int) $entry_id, array( $trait_term_id ), TraitTaxonomy::TAXONOMY );
			}

			update_post_meta( (int) $entry_id, '_cortext_seed_entry_content_version', self::ENTRY_CONTENT_VERSION );
			$this->maybe_apply_row_icon( (int) $entry_id, $spec['slug'], $entry['title'] );
			$this->maybe_apply_row_cover( (int) $entry_id, $spec['slug'], $entry['title'] );

			foreach ( $field_ids as $field_name => $field_id ) {
				if ( array_key_exists( $field_name, $entry ) ) {
					$value = $entry[ $field_name ];
				} else {
					continue;
				}

				$type = $field_types[ $field_name ];

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
	 * Removes the old visible seeded Icon field from a collection.
	 *
	 * @param int   $collection_id Collection post ID.
	 * @param array $field_ids     Attached field IDs.
	 * @return array Remaining attached field IDs.
	 */
	private function remove_seeded_icon_field( int $collection_id, array $field_ids ): array {
		$removed = 0;

		foreach ( $field_ids as $field_id ) {
			$field_id = (int) $field_id;
			$field    = get_post( $field_id );
			if ( ! $field || Field::POST_TYPE !== $field->post_type || 'Icon' !== $field->post_title ) {
				continue;
			}

			delete_post_meta( $collection_id, 'cortext_fields', $field_id );
			if ( post_type_exists( Document::POST_TYPE ) ) {
				delete_post_meta_by_key( "field-{$field_id}" );
			}
			wp_delete_post( $field_id, true );
			++$removed;
		}

		if ( $removed > 0 ) {
			WP_CLI::log( sprintf( 'Removed %d seeded Icon field(s).', $removed ) );
		}

		return get_post_meta( $collection_id, 'cortext_fields', false );
	}

	private function update_entry_content( int $entry_id, string $content ): void {
		$content_version = (string) get_post_meta( $entry_id, '_cortext_seed_entry_content_version', true );
		if ( self::ENTRY_CONTENT_VERSION === $content_version ) {
			return;
		}

		wp_update_post(
			array(
				'ID'           => $entry_id,
				'post_content' => $content,
			)
		);
		update_post_meta( $entry_id, '_cortext_seed_entry_content_version', self::ENTRY_CONTENT_VERSION );
	}

	/**
	 * Seeds relation and rollup examples after all base collections exist.
	 *
	 * @param array<string,int> $collection_ids Collection IDs keyed by slug.
	 */
	private function seed_relationship_examples( array $collection_ids ): void {
		$this->seed_literature_relationships( $collection_ids );
		$this->seed_music_relationships( $collection_ids );
		$this->seed_work_relationships( $collection_ids );
	}

	/**
	 * Seeds the literature relation graph and rollups.
	 *
	 * @param array<string,int> $collection_ids Collection IDs keyed by slug.
	 */
	private function seed_literature_relationships( array $collection_ids ): void {
		$books_id      = $collection_ids['books'] ?? 0;
		$authors_id    = $collection_ids['authors'] ?? 0;
		$publishers_id = $collection_ids['publishers'] ?? 0;

		if ( $books_id < 1 || $authors_id < 1 || $publishers_id < 1 ) {
			return;
		}

		$author_relation    = $this->ensure_relation_pair(
			$books_id,
			'Author',
			$authors_id,
			'Books',
			false,
			true
		);
		$publisher_relation = $this->ensure_relation_pair(
			$books_id,
			'Publisher',
			$publishers_id,
			'Books',
			false,
			true
		);

		$book_fields = $this->attached_fields_by_title( $books_id );
		$this->ensure_rollup_field( $authors_id, 'Book count', $author_relation['reverse_id'], 0, 'count' );
		$this->ensure_rollup_field( $authors_id, 'Book genres', $author_relation['reverse_id'], $book_fields['Genre'] ?? 0, 'show_unique' );
		$this->ensure_rollup_field( $authors_id, 'Latest book', $author_relation['reverse_id'], $book_fields['Year'] ?? 0, 'max' );
		$this->ensure_rollup_field( $authors_id, 'Average rating', $author_relation['reverse_id'], $book_fields['Rating'] ?? 0, 'avg' );
		$this->ensure_rollup_field( $publishers_id, 'Catalog count', $publisher_relation['reverse_id'], 0, 'count' );
		$this->ensure_rollup_field( $publishers_id, 'Catalog genres', $publisher_relation['reverse_id'], $book_fields['Genre'] ?? 0, 'show_unique' );
		$this->ensure_rollup_field( $publishers_id, 'Latest publication', $publisher_relation['reverse_id'], $book_fields['Year'] ?? 0, 'max' );

		$this->register_collection_entries( $books_id );
		$this->register_collection_entries( $authors_id );
		$this->register_collection_entries( $publishers_id );

		$this->set_relations_from_title_map( 'books', $author_relation['source_id'], $this->book_author_relations() );
		$this->set_relations_from_title_map( 'books', $publisher_relation['source_id'], $this->book_publisher_relations() );
	}

	/**
	 * Seeds the music relation graph and rollups.
	 *
	 * @param array<string,int> $collection_ids Collection IDs keyed by slug.
	 */
	private function seed_music_relationships( array $collection_ids ): void {
		$musicians_id = $collection_ids['musicians'] ?? 0;
		$albums_id    = $collection_ids['albums'] ?? 0;
		$labels_id    = $collection_ids['labels'] ?? 0;
		$tracks_id    = $collection_ids['tracks'] ?? 0;

		if ( $musicians_id < 1 || $albums_id < 1 || $labels_id < 1 || $tracks_id < 1 ) {
			return;
		}

		$artist_relation = $this->ensure_relation_pair(
			$albums_id,
			'Artist',
			$musicians_id,
			'Albums',
			false,
			true
		);
		$label_relation  = $this->ensure_relation_pair(
			$albums_id,
			'Label',
			$labels_id,
			'Albums',
			false,
			true
		);
		$track_relation  = $this->ensure_relation_pair(
			$tracks_id,
			'Album',
			$albums_id,
			'Tracks',
			false,
			true
		);

		$album_fields = $this->attached_fields_by_title( $albums_id );
		$track_fields = $this->attached_fields_by_title( $tracks_id );
		$this->ensure_rollup_field( $musicians_id, 'Album count', $artist_relation['reverse_id'], 0, 'count' );
		$this->ensure_rollup_field( $musicians_id, 'Album genres', $artist_relation['reverse_id'], $album_fields['Genre'] ?? 0, 'show_unique' );
		$this->ensure_rollup_field( $musicians_id, 'Latest release', $artist_relation['reverse_id'], $album_fields['Year'] ?? 0, 'max' );
		$this->ensure_rollup_field( $labels_id, 'Release count', $label_relation['reverse_id'], 0, 'count' );
		$this->ensure_rollup_field( $labels_id, 'Release genres', $label_relation['reverse_id'], $album_fields['Genre'] ?? 0, 'show_unique' );
		$this->ensure_rollup_field( $labels_id, 'Latest release', $label_relation['reverse_id'], $album_fields['Year'] ?? 0, 'max' );
		$this->ensure_rollup_field( $albums_id, 'Track count', $track_relation['reverse_id'], 0, 'count' );
		$this->ensure_rollup_field( $albums_id, 'Runtime', $track_relation['reverse_id'], $track_fields['Duration'] ?? 0, 'sum' );
		$this->ensure_rollup_field( $albums_id, 'Track moods', $track_relation['reverse_id'], $track_fields['Mood'] ?? 0, 'show_unique' );

		$this->register_collection_entries( $musicians_id );
		$this->register_collection_entries( $albums_id );
		$this->register_collection_entries( $labels_id );
		$this->register_collection_entries( $tracks_id );

		$this->set_relations_from_title_map( 'albums', $artist_relation['source_id'], $this->album_artist_relations() );
		$this->set_relations_from_title_map( 'albums', $label_relation['source_id'], $this->album_label_relations() );
		$this->set_relations_from_title_map( 'tracks', $track_relation['source_id'], $this->track_album_relations() );
	}

	/**
	 * Seeds the work relation graph and rollups.
	 *
	 * @param array<string,int> $collection_ids Collection IDs keyed by slug.
	 */
	private function seed_work_relationships( array $collection_ids ): void {
		$projects_id = $collection_ids['projects'] ?? 0;
		$tasks_id    = $collection_ids['tasks'] ?? 0;
		$people_id   = $collection_ids['people'] ?? 0;

		if ( $projects_id < 1 || $tasks_id < 1 || $people_id < 1 ) {
			return;
		}

		$task_project_relation  = $this->ensure_relation_pair(
			$tasks_id,
			'Project',
			$projects_id,
			'Tasks',
			false,
			true
		);
		$task_assignee_relation = $this->ensure_relation_pair(
			$tasks_id,
			'Assignee',
			$people_id,
			'Assigned tasks',
			false,
			true
		);
		$project_owner_relation = $this->ensure_relation_pair(
			$projects_id,
			'Owner',
			$people_id,
			'Owned projects',
			false,
			true
		);

		$task_fields = $this->attached_fields_by_title( $tasks_id );
		$this->ensure_rollup_field( $projects_id, 'Task count', $task_project_relation['reverse_id'], 0, 'count' );
		$this->ensure_rollup_field( $projects_id, 'Task effort', $task_project_relation['reverse_id'], $task_fields['Effort'] ?? 0, 'sum' );
		$this->ensure_rollup_field( $projects_id, 'Task statuses', $task_project_relation['reverse_id'], $task_fields['Status'] ?? 0, 'show_unique' );
		$this->ensure_rollup_field( $projects_id, 'Latest task due', $task_project_relation['reverse_id'], $task_fields['Due'] ?? 0, 'latest' );
		$this->ensure_rollup_field( $projects_id, 'Task due range', $task_project_relation['reverse_id'], $task_fields['Due'] ?? 0, 'date_range' );
		$this->ensure_rollup_field( $people_id, 'Assigned task count', $task_assignee_relation['reverse_id'], 0, 'count' );
		$this->ensure_rollup_field( $people_id, 'Owned project count', $project_owner_relation['reverse_id'], 0, 'count' );

		$this->register_collection_entries( $projects_id );
		$this->register_collection_entries( $tasks_id );
		$this->register_collection_entries( $people_id );

		$this->set_relations_from_title_map( 'tasks', $task_project_relation['source_id'], $this->task_project_relations() );
		$this->set_relations_from_title_map( 'tasks', $task_assignee_relation['source_id'], $this->task_assignee_relations() );
		$this->set_relations_from_title_map( 'projects', $project_owner_relation['source_id'], $this->project_owner_relations() );
	}

	/**
	 * Seeds relation values from source-title to target-title maps.
	 *
	 * @param string                        $source_slug Source collection slug.
	 * @param int                           $field_id Relation field ID.
	 * @param array<string,string|string[]> $relations Source title => target title(s).
	 */
	private function set_relations_from_title_map( string $source_slug, int $field_id, array $relations ): void {
		if ( ! $this->seed_full_dataset ) {
			$relations = $this->compact_relation_map( $source_slug, $field_id, $relations );
		}

		foreach ( $relations as $source_title => $target_titles ) {
			$this->set_relation_by_titles(
				$source_slug,
				(string) $source_title,
				$field_id,
				is_array( $target_titles ) ? $target_titles : array( $target_titles )
			);
		}
	}

	/**
	 * Filters full relation maps down to rows present in compact seed mode.
	 *
	 * @param string                        $source_slug Source collection slug.
	 * @param int                           $field_id Relation field ID.
	 * @param array<string,string|string[]> $relations Source title => target title(s).
	 * @return array<string,string|string[]>
	 */
	private function compact_relation_map( string $source_slug, int $field_id, array $relations ): array {
		$titles_by_slug = $this->compact_seed_entry_titles();
		$source_titles  = array_fill_keys( $titles_by_slug[ $source_slug ] ?? array(), true );

		$target_collection_id = (int) get_post_meta( $field_id, 'related_collection_id', true );
		$target_slug          = $target_collection_id > 0 ? (string) get_post_meta( $target_collection_id, 'cortext_seed_slug', true ) : '';
		$target_titles        = array_fill_keys( $titles_by_slug[ $target_slug ] ?? array(), true );

		if ( ! $source_titles || ! $target_titles ) {
			return array();
		}

		$filtered = array();
		foreach ( $relations as $source_title => $raw_target_titles ) {
			$source_title = (string) $source_title;
			if ( ! isset( $source_titles[ $source_title ] ) ) {
				continue;
			}

			$raw_target_titles = is_array( $raw_target_titles ) ? $raw_target_titles : array( $raw_target_titles );
			$kept_targets      = array_values(
				array_filter(
					$raw_target_titles,
					static fn( $target_title ): bool => isset( $target_titles[ (string) $target_title ] )
				)
			);
			if ( ! $kept_targets ) {
				continue;
			}

			$filtered[ $source_title ] = 1 === count( $kept_targets )
				? (string) $kept_targets[0]
				: array_map( 'strval', $kept_targets );
		}

		return $filtered;
	}

	/**
	 * Returns seeded Book -> Author relations.
	 *
	 * @return array<string,string>
	 */
	private function book_author_relations(): array {
		return array(
			'The Left Hand of Darkness'       => 'Ursula K. Le Guin',
			'The Dispossessed'                => 'Ursula K. Le Guin',
			'A Wizard of Earthsea'            => 'Ursula K. Le Guin',
			'Kindred'                         => 'Octavia E. Butler',
			'Parable of the Sower'            => 'Octavia E. Butler',
			'Dawn'                            => 'Octavia E. Butler',
			'One Hundred Years of Solitude'   => 'Gabriel Garcia Marquez',
			'Love in the Time of Cholera'     => 'Gabriel Garcia Marquez',
			'Beloved'                         => 'Toni Morrison',
			'Song of Solomon'                 => 'Toni Morrison',
			'Mrs Dalloway'                    => 'Virginia Woolf',
			'To the Lighthouse'               => 'Virginia Woolf',
			'The Trial'                       => 'Franz Kafka',
			'The Castle'                      => 'Franz Kafka',
			'Invisible Cities'                => 'Italo Calvino',
			'If on a winter night a traveler' => 'Italo Calvino',
			'Ficciones'                       => 'Jorge Luis Borges',
			'Labyrinths'                      => 'Jorge Luis Borges',
			'Things Fall Apart'               => 'Chinua Achebe',
			'No Longer at Ease'               => 'Chinua Achebe',
			'The Passion According to G.H.'   => 'Clarice Lispector',
			'The Hour of the Star'            => 'Clarice Lispector',
			'The Tale of Genji'               => 'Murasaki Shikibu',
			'Childhoods End'                  => 'Arthur C. Clarke',
			'Rendezvous with Rama'            => 'Arthur C. Clarke',
			'Frankenstein'                    => 'Mary Shelley',
			'The Last Man'                    => 'Mary Shelley',
			'The Fifth Season'                => 'N. K. Jemisin',
			'The Obelisk Gate'                => 'N. K. Jemisin',
			'Never Let Me Go'                 => 'Kazuo Ishiguro',
			'Klara and the Sun'               => 'Kazuo Ishiguro',
			'The Name of the Rose'            => 'Umberto Eco',
			'Foucaults Pendulum'              => 'Umberto Eco',
			'The Savage Detectives'           => 'Roberto Bolano',
			'2666'                            => 'Roberto Bolano',
			'The Vegetarian'                  => 'Han Kang',
			'Human Acts'                      => 'Han Kang',
			'The Master and Margarita'        => 'Mikhail Bulgakov',
			'Heart of a Dog'                  => 'Mikhail Bulgakov',
			'Midnights Children'              => 'Salman Rushdie',
			'The Satanic Verses'              => 'Salman Rushdie',
			'The Colour of Magic'             => 'Terry Pratchett',
			'Mort'                            => 'Terry Pratchett',
			'Guards! Guards!'                 => 'Terry Pratchett',
			'Small Gods'                      => 'Terry Pratchett',
			'Hogfather'                       => 'Terry Pratchett',
			'Going Postal'                    => 'Terry Pratchett',
		);
	}

	/**
	 * Returns seeded Book -> Publisher relations.
	 *
	 * @return array<string,string>
	 */
	private function book_publisher_relations(): array {
		return array(
			'The Left Hand of Darkness'       => 'Gollancz',
			'The Dispossessed'                => 'Gollancz',
			'A Wizard of Earthsea'            => 'Penguin Classics',
			'Kindred'                         => 'Vintage',
			'Parable of the Sower'            => 'Orbit',
			'Dawn'                            => 'Orbit',
			'One Hundred Years of Solitude'   => 'Penguin Classics',
			'Love in the Time of Cholera'     => 'Vintage',
			'Beloved'                         => 'Vintage',
			'Song of Solomon'                 => 'Vintage',
			'Mrs Dalloway'                    => 'Penguin Classics',
			'To the Lighthouse'               => 'Penguin Classics',
			'The Trial'                       => 'Everyman Library',
			'The Castle'                      => 'Everyman Library',
			'Invisible Cities'                => 'Vintage',
			'If on a winter night a traveler' => 'Vintage',
			'Ficciones'                       => 'New Directions',
			'Labyrinths'                      => 'New Directions',
			'Things Fall Apart'               => 'Penguin Classics',
			'No Longer at Ease'               => 'Penguin Classics',
			'The Passion According to G.H.'   => 'New Directions',
			'The Hour of the Star'            => 'New Directions',
			'The Tale of Genji'               => 'Penguin Classics',
			'Childhoods End'                  => 'Gollancz',
			'Rendezvous with Rama'            => 'Gollancz',
			'Frankenstein'                    => 'Penguin Classics',
			'The Last Man'                    => 'Penguin Classics',
			'The Fifth Season'                => 'Orbit',
			'The Obelisk Gate'                => 'Orbit',
			'Never Let Me Go'                 => 'Faber and Faber',
			'Klara and the Sun'               => 'Faber and Faber',
			'The Name of the Rose'            => 'Farrar Straus and Giroux',
			'Foucaults Pendulum'              => 'Farrar Straus and Giroux',
			'The Savage Detectives'           => 'Farrar Straus and Giroux',
			'2666'                            => 'Farrar Straus and Giroux',
			'The Vegetarian'                  => 'Seagull Books',
			'Human Acts'                      => 'Seagull Books',
			'The Master and Margarita'        => 'Penguin Classics',
			'Heart of a Dog'                  => 'Penguin Classics',
			'Midnights Children'              => 'Vintage',
			'The Satanic Verses'              => 'Vintage',
			'The Colour of Magic'             => 'Gollancz',
			'Mort'                            => 'Gollancz',
			'Guards! Guards!'                 => 'Gollancz',
			'Small Gods'                      => 'Gollancz',
			'Hogfather'                       => 'Gollancz',
			'Going Postal'                    => 'Gollancz',
		);
	}

	/**
	 * Returns seeded Album -> Artist relations.
	 *
	 * @return array<string,string>
	 */
	private function album_artist_relations(): array {
		return array(
			'Homogenic'                            => 'Björk',
			'Vespertine'                           => 'Björk',
			'Blackstar'                            => 'David Bowie',
			'Low'                                  => 'David Bowie',
			'Blue'                                 => 'Joni Mitchell',
			'Hejira'                               => 'Joni Mitchell',
			'Kind of Blue'                         => 'Miles Davis',
			'Bitches Brew'                         => 'Miles Davis',
			'Pastel Blues'                         => 'Nina Simone',
			'Wild Is the Wind'                     => 'Nina Simone',
			'Kid A'                                => 'Radiohead',
			'In Rainbows'                          => 'Radiohead',
			'To Pimp a Butterfly'                  => 'Kendrick Lamar',
			'DAMN.'                                => 'Kendrick Lamar',
			'Hounds of Love'                       => 'Kate Bush',
			'The Dreaming'                         => 'Kate Bush',
			'Ambient 1: Music for Airports'        => 'Brian Eno',
			'Another Green World'                  => 'Brian Eno',
			'Zombie'                               => 'Fela Kuti',
			'Expensive Shit'                       => 'Fela Kuti',
			'Diamond Life'                         => 'Sade',
			'Love Deluxe'                          => 'Sade',
			'Selected Ambient Works 85-92'         => 'Aphex Twin',
			'Richard D. James Album'               => 'Aphex Twin',
			'The Miseducation of Lauryn Hill'      => 'Lauryn Hill',
			'Remain in Light'                      => 'Talking Heads',
			'Speaking in Tongues'                  => 'Talking Heads',
			'The Low End Theory'                   => 'A Tribe Called Quest',
			'Midnight Marauders'                   => 'A Tribe Called Quest',
			'Dummy'                                => 'Portishead',
			'Third'                                => 'Portishead',
			'Async'                                => 'Ryuichi Sakamoto',
			'Thousand Knives'                      => 'Ryuichi Sakamoto',
			'A Seat at the Table'                  => 'Solange',
			'When I Get Home'                      => 'Solange',
			'Abbey Road'                           => 'The Beatles',
			'Sgt. Peppers Lonely Hearts Club Band' => 'The Beatles',
			'The Dark Side of the Moon'            => 'Pink Floyd',
			'The Wall'                             => 'Pink Floyd',
			'Purple Rain'                          => 'Prince',
			'Take This to Your Grave'              => 'Fall Out Boy',
			'From Under the Cork Tree'             => 'Fall Out Boy',
			'Infinity on High'                     => 'Fall Out Boy',
			'Save Rock and Roll'                   => 'Fall Out Boy',
			'El Listón de tu Pelo'                 => 'Los Ángeles Azules',
			'Cómo te voy a olvidar'                => 'Los Ángeles Azules',
			'De Buenas Raíces'                     => 'Los Ángeles Azules',
		);
	}

	/**
	 * Returns seeded Album -> Label relations.
	 *
	 * @return array<string,string>
	 */
	private function album_label_relations(): array {
		return array(
			'Homogenic'                            => 'One Little Independent',
			'Vespertine'                           => 'One Little Independent',
			'Blackstar'                            => 'RCA',
			'Low'                                  => 'RCA',
			'Blue'                                 => 'Asylum',
			'Hejira'                               => 'Asylum',
			'Kind of Blue'                         => 'Columbia',
			'Bitches Brew'                         => 'Columbia',
			'Pastel Blues'                         => 'Columbia',
			'Wild Is the Wind'                     => 'Columbia',
			'Kid A'                                => 'XL Recordings',
			'In Rainbows'                          => 'XL Recordings',
			'To Pimp a Butterfly'                  => 'Top Dawg Entertainment',
			'DAMN.'                                => 'Top Dawg Entertainment',
			'Hounds of Love'                       => 'EMI',
			'The Dreaming'                         => 'EMI',
			'Ambient 1: Music for Airports'        => 'Island',
			'Another Green World'                  => 'Island',
			'Zombie'                               => 'Island',
			'Expensive Shit'                       => 'Island',
			'Diamond Life'                         => 'Epic',
			'Love Deluxe'                          => 'Epic',
			'Selected Ambient Works 85-92'         => 'Warp',
			'Richard D. James Album'               => 'Warp',
			'The Miseducation of Lauryn Hill'      => 'Columbia',
			'Remain in Light'                      => 'Sire',
			'Speaking in Tongues'                  => 'Sire',
			'The Low End Theory'                   => 'Jive',
			'Midnight Marauders'                   => 'Jive',
			'Dummy'                                => 'Island',
			'Third'                                => 'Island',
			'Async'                                => 'Milan',
			'Thousand Knives'                      => 'Columbia',
			'A Seat at the Table'                  => 'Columbia',
			'When I Get Home'                      => 'Columbia',
			'Abbey Road'                           => 'Apple Records',
			'Sgt. Peppers Lonely Hearts Club Band' => 'Apple Records',
			'The Dark Side of the Moon'            => 'Harvest',
			'The Wall'                             => 'Harvest',
			'Purple Rain'                          => 'Warner Bros. Records',
			'Take This to Your Grave'              => 'Fueled by Ramen',
			'From Under the Cork Tree'             => 'Fueled by Ramen',
			'Infinity on High'                     => 'Island',
			'Save Rock and Roll'                   => 'Island',
			'El Listón de tu Pelo'                 => 'Disa',
			'Cómo te voy a olvidar'                => 'Disa',
			'De Buenas Raíces'                     => 'Disa',
		);
	}

	/**
	 * Returns seeded Track -> Album relations.
	 *
	 * @return array<string,string>
	 */
	private function track_album_relations(): array {
		return array(
			'Jóga'                          => 'Homogenic',
			'Bachelorette'                  => 'Homogenic',
			'Hidden Place'                  => 'Vespertine',
			'Pagan Poetry'                  => 'Vespertine',
			'Blackstar'                     => 'Blackstar',
			'Lazarus'                       => 'Blackstar',
			'Speed of Life'                 => 'Low',
			'Warszawa'                      => 'Low',
			'Carey'                         => 'Blue',
			'A Case of You'                 => 'Blue',
			'Coyote'                        => 'Hejira',
			'Amelia'                        => 'Hejira',
			'So What'                       => 'Kind of Blue',
			'Blue in Green'                 => 'Kind of Blue',
			'Pharaohs Dance'                => 'Bitches Brew',
			'Spanish Key'                   => 'Bitches Brew',
			'Sinnerman'                     => 'Pastel Blues',
			'Strange Fruit'                 => 'Pastel Blues',
			'Everything in Its Right Place' => 'Kid A',
			'Idioteque'                     => 'Kid A',
			'15 Step'                       => 'In Rainbows',
			'Reckoner'                      => 'In Rainbows',
			'Wesleys Theory'                => 'To Pimp a Butterfly',
			'Alright'                       => 'To Pimp a Butterfly',
			'DNA.'                          => 'DAMN.',
			'DUCKWORTH.'                    => 'DAMN.',
			'Running Up That Hill'          => 'Hounds of Love',
			'Cloudbusting'                  => 'Hounds of Love',
			'Suspended in Gaffa'            => 'The Dreaming',
			'Sat in Your Lap'               => 'The Dreaming',
			'1/1'                           => 'Ambient 1: Music for Airports',
			'2/1'                           => 'Ambient 1: Music for Airports',
			'St. Elmos Fire'                => 'Another Green World',
			'The Big Ship'                  => 'Another Green World',
			'Zombie'                        => 'Zombie',
			'Mister Follow Follow'          => 'Zombie',
			'Smooth Operator'               => 'Diamond Life',
			'Your Love Is King'             => 'Diamond Life',
			'No Ordinary Love'              => 'Love Deluxe',
			'Cherish the Day'               => 'Love Deluxe',
			'Xtal'                          => 'Selected Ambient Works 85-92',
			'Ageispolis'                    => 'Selected Ambient Works 85-92',
			'4'                             => 'Richard D. James Album',
			'Girl/Boy Song'                 => 'Richard D. James Album',
			'Doo Wop'                       => 'The Miseducation of Lauryn Hill',
			'Ex-Factor'                     => 'The Miseducation of Lauryn Hill',
			'Born Under Punches'            => 'Remain in Light',
			'Once in a Lifetime'            => 'Remain in Light',
			'Burning Down the House'        => 'Speaking in Tongues',
			'This Must Be the Place'        => 'Speaking in Tongues',
			'Buggin Out'                    => 'The Low End Theory',
			'Scenario'                      => 'The Low End Theory',
			'Electric Relaxation'           => 'Midnight Marauders',
			'Award Tour'                    => 'Midnight Marauders',
			'Mysterons'                     => 'Dummy',
			'Glory Box'                     => 'Dummy',
			'The Rip'                       => 'Third',
			'Machine Gun'                   => 'Third',
			'andata'                        => 'Async',
			'fullmoon'                      => 'Async',
			'Cranes in the Sky'             => 'A Seat at the Table',
			'Dont Touch My Hair'            => 'A Seat at the Table',
			'Things I Imagined'             => 'When I Get Home',
			'Binz'                          => 'When I Get Home',
		);
	}

	/**
	 * Returns seeded Project -> Owner relations.
	 *
	 * @return array<string,string>
	 */
	private function project_owner_relations(): array {
		return array(
			'Seed knowledge workspace'    => 'Miguel Fonseca',
			'Relation field polish'       => 'Iris Okafor',
			'Row detail editing'          => 'Hector Prieto',
			'Collection icon pass'        => 'Ava Chen',
			'Import modeling guide'       => 'Sam Rivera',
			'DataViews saved views'       => 'Priya Shah',
			'Public collection templates' => 'Mina Park',
			'Performance baseline'        => 'Rae Kim',
		);
	}

	/**
	 * Returns seeded Task -> Project relations.
	 *
	 * @return array<string,string>
	 */
	private function task_project_relations(): array {
		return array(
			'Replace flat seed tables with connected data' => 'Seed knowledge workspace',
			'Add collection icons to sidebar rows'         => 'Collection icon pass',
			'Seed author rollups from related books'       => 'Seed knowledge workspace',
			'Create album track rollups'                   => 'Seed knowledge workspace',
			'Rewrite workspace landing page content'       => 'Seed knowledge workspace',
			'Add richer research page blocks'              => 'Seed knowledge workspace',
			'Check relation picker with dozens of rows'    => 'Relation field polish',
			'Normalize seed option colors to palette names' => 'Seed knowledge workspace',
			'Add people ownership relation'                => 'Relation field polish',
			'Backfill task relation examples'              => 'Seed knowledge workspace',
			'Verify seeded pages update on rerun'          => 'Seed knowledge workspace',
			'Document reset command behavior'              => 'Import modeling guide',
			'Audit row detail read-only relation fields'   => 'Row detail editing',
			'Tune sidebar icon spacing'                    => 'Collection icon pass',
			'Create publisher catalog examples'            => 'Seed knowledge workspace',
			'Create label catalog examples'                => 'Seed knowledge workspace',
			'Stress test table horizontal scroll'          => 'Performance baseline',
			'Add task footer calculation examples'         => 'DataViews saved views',
			'Review collection creation defaults'          => 'Import modeling guide',
			'Design row page opening states'               => 'Row detail editing',
			'Add import fixture notes'                     => 'Import modeling guide',
			'Profile rollup formatting'                    => 'Performance baseline',
			'Polish empty date displays'                   => 'Row detail editing',
			'Write manual QA checklist page'               => 'Import modeling guide',
			'Check collection home preference with icons'  => 'Collection icon pass',
			'Clean up old paintings seed references'       => 'Seed knowledge workspace',
			'Add saved view fixture once model exists'     => 'DataViews saved views',
			'Review mobile table density'                  => 'Performance baseline',
			'Add cover image fallback tests'               => 'Collection icon pass',
			'Prepare demo script for relation chips'       => 'Import modeling guide',
		);
	}

	/**
	 * Returns seeded Task -> Assignee relations.
	 *
	 * @return array<string,string>
	 */
	private function task_assignee_relations(): array {
		return array(
			'Replace flat seed tables with connected data' => 'Hector Prieto',
			'Add collection icons to sidebar rows'         => 'Ava Chen',
			'Seed author rollups from related books'       => 'Iris Okafor',
			'Create album track rollups'                   => 'Iris Okafor',
			'Rewrite workspace landing page content'       => 'Nora Singh',
			'Add richer research page blocks'              => 'Nora Singh',
			'Check relation picker with dozens of rows'    => 'Sam Rivera',
			'Normalize seed option colors to palette names' => 'Rae Kim',
			'Add people ownership relation'                => 'Hector Prieto',
			'Backfill task relation examples'              => 'Owen Brooks',
			'Verify seeded pages update on rerun'          => 'Priya Shah',
			'Document reset command behavior'              => 'Eli Novak',
			'Audit row detail read-only relation fields'   => 'Iris Okafor',
			'Tune sidebar icon spacing'                    => 'Mina Park',
			'Create publisher catalog examples'            => 'Owen Brooks',
			'Create label catalog examples'                => 'Owen Brooks',
			'Stress test table horizontal scroll'          => 'Rae Kim',
			'Add task footer calculation examples'         => 'Leo Martin',
			'Review collection creation defaults'          => 'Sam Rivera',
			'Design row page opening states'               => 'Mina Park',
			'Add import fixture notes'                     => 'Eli Novak',
			'Profile rollup formatting'                    => 'Rae Kim',
			'Polish empty date displays'                   => 'Leo Martin',
			'Write manual QA checklist page'               => 'Nora Singh',
			'Check collection home preference with icons'  => 'Priya Shah',
			'Clean up old paintings seed references'       => 'Hector Prieto',
			'Add saved view fixture once model exists'     => 'Priya Shah',
			'Review mobile table density'                  => 'Mina Park',
			'Add cover image fallback tests'               => 'Leo Martin',
			'Prepare demo script for relation chips'       => 'Nora Singh',
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
			get_post_meta( $collection_id, 'cortext_fields', false )
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

		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		WP_CLI::log( "Created field '{$title}' (ID {$field_id})." );

		return (int) $field_id;
	}

	/**
	 * Rewrites the `fields` meta on a collection so attached fields appear
	 * in the requested order, with any unlisted titles preserved at the end.
	 * Field titles not present on the collection are silently skipped, so
	 * callers can pass a single canonical order even when a collection
	 * doesn't grant every field (compact mode, future opt-outs).
	 *
	 * @param int           $collection_id Collection post ID.
	 * @param array<string> $title_order   Canonical title order, top to bottom.
	 */
	private function reorder_collection_fields_by_titles( int $collection_id, array $title_order ): void {
		$by_title = $this->attached_fields_by_title( $collection_id );
		if ( ! $by_title ) {
			return;
		}

		$ordered_ids   = array();
		$ordered_index = array();
		foreach ( $title_order as $title ) {
			$title = (string) $title;
			if ( isset( $by_title[ $title ] ) ) {
				$ordered_ids[]                        = (int) $by_title[ $title ];
				$ordered_index[ $by_title[ $title ] ] = true;
			}
		}

		// Preserve any field titles the canonical order didn't mention so
		// the seeder doesn't accidentally drop new fields a future spec adds.
		foreach ( $by_title as $title => $field_id ) {
			if ( ! isset( $ordered_index[ $field_id ] ) ) {
				$ordered_ids[] = (int) $field_id;
			}
		}

		delete_post_meta( $collection_id, 'cortext_fields' );
		foreach ( $ordered_ids as $field_id ) {
			add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		}
	}

	/**
	 * Canonical column order per collection slug. Lead with the field a
	 * reader most likely scans for (Author for a book, Artist for an album,
	 * Status for a task), follow with the spec-level fields, then rollups,
	 * and trail with metadata fields. Unlisted titles are appended at the
	 * end by `reorder_collection_fields_by_titles`.
	 *
	 * @return array<string,array<int,string>>
	 */
	private function canonical_column_orders(): array {
		return array(
			'authors'    => array(
				'Country',
				'Era',
				'Born',
				'Genres',
				'Books',
				'Book count',
				'Latest book',
				'Average rating',
				'Book genres',
				'Website',
				'Notes',
			),
			'publishers' => array(
				'Country',
				'Founded',
				'Focus',
				'Books',
				'Catalog count',
				'Latest publication',
				'Catalog genres',
				'Website',
				'Notes',
			),
			'books'      => array(
				'Author',
				'Publisher',
				'Year',
				'Genre',
				'Pages',
				'Rating',
				'Read?',
				'Status',
				'Notes',
			),
			'musicians'  => array(
				'Country',
				'Active since',
				'Genres',
				'Albums',
				'Album count',
				'Latest release',
				'Album genres',
				'Website',
				'Notes',
			),
			'labels'     => array(
				'Country',
				'Founded',
				'Focus',
				'Albums',
				'Release count',
				'Latest release',
				'Release genres',
				'Website',
				'Notes',
			),
			'albums'     => array(
				'Artist',
				'Label',
				'Year',
				'Genre',
				'Format',
				'Length',
				'Tracks',
				'Track count',
				'Runtime',
				'Track moods',
				'Favorite?',
				'Notes',
			),
			'tracks'     => array(
				'Album',
				'Track #',
				'Duration',
				'Mood',
				'Favorite?',
				'Notes',
			),
			'people'     => array(
				'Role',
				'Team',
				'Capacity',
				'Owned projects',
				'Owned project count',
				'Assigned tasks',
				'Assigned task count',
				'Email',
				'Location',
				'Notes',
			),
			'projects'   => array(
				'Status',
				'Owner',
				'Priority',
				'Tasks',
				'Task count',
				'Task effort',
				'Progress',
				'Kickoff',
				'Due',
				'Latest task due',
				'Task statuses',
				'Task due range',
				'Tags',
				'Blocked?',
				'Project URL',
				'Notes',
			),
			'tasks'      => array(
				'Status',
				'Project',
				'Assignee',
				'Type',
				'Effort',
				'Due',
				'Reminder',
				'Tags',
				'Done?',
				'URL',
				'Notes',
			),
		);
	}

	/**
	 * Returns attached field IDs keyed by post title.
	 *
	 * @param int $collection_id Collection post ID.
	 * @return array<string,int>
	 */
	private function attached_fields_by_title( int $collection_id ): array {
		$fields = array();
		foreach ( get_post_meta( $collection_id, 'cortext_fields', false ) as $field_id ) {
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
		$target_slug          = (string) get_post_meta( $target_collection_id, 'cortext_seed_slug', true );
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

		$collections = get_posts(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				// phpcs:ignore WordPress.DB.SlowDBQuery
				'meta_key'    => 'cortext_seed_slug',
				// phpcs:ignore WordPress.DB.SlowDBQuery
				'meta_value'  => $collection_slug,
				'numberposts' => 1,
				'fields'      => 'ids',
			)
		);
		if ( ! $collections ) {
			return 0;
		}
		$term_id = Relations::trait_term_id_for_collection( (int) $collections[0] );
		if ( $term_id < 1 ) {
			return 0;
		}

		$entries = get_posts(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				'title'       => $title,
				'numberposts' => 1,
				'fields'      => 'ids',
				'tax_query'   => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
					array(
						'taxonomy' => TraitTaxonomy::TAXONOMY,
						'field'    => 'term_id',
						'terms'    => array( $term_id ),
					),
				),
			)
		);

		return $entries ? (int) $entries[0] : 0;
	}

	private function register_collection_entries( int $collection_id ): void {
		// No-op in the universal-document model. The single `crtxt_document`
		// CPT is registered on `init`; rows are assigned to a collection via
		// the `crtxt_trait` taxonomy.
		unset( $collection_id );
	}

	private function reset(): void {
		// 1. Delete entries for each collection.
		$collections = get_posts(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'any',
				'numberposts' => -1,
				'meta_query'  => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => 'cortext_fields',
						'compare' => 'EXISTS',
					),
				),
			)
		);

		foreach ( $collections as $collection ) {
			$entries = get_posts(
				array(
					'post_type'   => Document::POST_TYPE,
					'post_status' => 'any',
					'numberposts' => -1,
					'fields'      => 'ids',
					'tax_query'   => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
						array(
							'taxonomy' => TraitTaxonomy::TAXONOMY,
							'field'    => 'term_id',
							'terms'    => array( Relations::trait_term_id_for_collection( (int) $collection->ID ) ),
						),
					),
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
				'post_type'   => Document::POST_TYPE,
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

		if ( delete_metadata( 'user', 0, self::FAVORITES_META_KEY, '', true ) ) {
			WP_CLI::log( 'Deleted sidebar favorites.' );
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
