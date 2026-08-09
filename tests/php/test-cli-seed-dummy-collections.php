<?php
/**
 * Tests for Cortext\CLI\SeedDummyCollections.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\CLI\SeedDummyCollections;
use Cortext\Documents;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\Taxonomy\TraitTaxonomy;
use ReflectionMethod;
use WorDBless\BaseTestCase;

final class Test_CLI_Seed_Dummy_Collections extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private SeedDummyCollections $seeder;
	private ArchiveCascade $archive_cascade;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		remove_all_actions( 'transition_post_status' );
		remove_all_filters( 'map_meta_cap' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$this->archive_cascade = new ArchiveCascade();
		$this->archive_cascade->register_status();
		$this->archive_cascade->register_meta();
		$this->archive_cascade->register();
		$this->seeder = new SeedDummyCollections();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();

		parent::tear_down();
	}

	public function test_seed_page_tree_reuses_archived_page(): void {
		$page_id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => Documents::STATUS_ARCHIVED,
				'post_title'  => 'Archived sample page',
			)
		);

		$result = $this->invoke_seeder_method(
			'seed_page_tree',
			array( 'title' => 'Archived sample page' ),
			0
		);

		$this->assertSame( $page_id, $result );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $page_id ) );
	}

	public function test_seed_collection_reuses_archived_collection_and_row(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => Documents::STATUS_ARCHIVED,
				'post_title'  => 'Archived sample collection',
				'meta_input'  => array( 'cortext_seed_slug' => 'archived-fixture' ),
			)
		);
		$term_id       = $this->memo_insert_term(
			'Archived sample collection',
			(string) $collection_id,
			TraitTaxonomy::TAXONOMY
		);
		$row_id        = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => Documents::STATUS_ARCHIVED,
				'post_title'  => 'Archived sample row',
			)
		);
		$this->memo_set_object_terms( $row_id, array( $term_id ) );

		$result = $this->invoke_seeder_method(
			'seed_collection',
			array(
				'slug'    => 'archived-fixture',
				'title'   => 'Archived sample collection',
				'fields'  => array(),
				'entries' => array( array( 'title' => 'Archived sample row' ) ),
			)
		);

		$this->assertSame( $collection_id, $result );
		$this->assertSame(
			$row_id,
			$this->invoke_seeder_method( 'entry_id_by_title', 'archived-fixture', 'Archived sample row' )
		);
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $collection_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $row_id ) );
	}

	public function test_seed_page_tree_archives_new_child_with_archived_parent(): void {
		$parent_id = $this->create_page( 'Archived parent' );
		$this->archive_cascade->archive( $parent_id );

		$child_id = $this->invoke_seeder_method(
			'seed_page_tree',
			array( 'title' => 'New child' ),
			$parent_id
		);

		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $child_id ) );
		$this->assertSame( 'private', get_post_meta( $child_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $child_id, ArchiveCascade::PARENT_MARKER_META, true ) );

		$this->archive_cascade->unarchive( $parent_id );

		$this->assertSame( 'private', get_post_status( $child_id ) );
	}

	public function test_seed_collection_archives_new_row_with_archived_collection(): void {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Archived fixture',
				'meta_input'  => array( 'cortext_seed_slug' => 'archived-new-row' ),
			)
		);
		$this->memo_insert_term( 'Archived fixture', (string) $collection_id, TraitTaxonomy::TAXONOMY );
		$this->archive_cascade->archive( (int) $collection_id );

		$this->invoke_seeder_method(
			'seed_collection',
			array(
				'slug'    => 'archived-new-row',
				'title'   => 'Archived fixture',
				'fields'  => array(),
				'entries' => array( array( 'title' => 'New archived row' ) ),
			)
		);
		$row_id = $this->invoke_seeder_method( 'entry_id_by_title', 'archived-new-row', 'New archived row' );

		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $row_id ) );
		$this->assertSame( 'private', get_post_meta( $row_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( (string) $collection_id, (string) get_post_meta( $row_id, ArchiveCascade::COLLECTION_MARKER_META, true ) );

		$this->archive_cascade->unarchive( (int) $collection_id );

		$this->assertSame( 'private', get_post_status( $row_id ) );
	}

	public function test_nesting_collection_under_archived_page_archives_collection_and_rows(): void {
		$page_id = $this->create_page( 'Library' );
		$this->archive_cascade->archive( $page_id );

		$collection_id = $this->create_page( 'Books' );
		$term_id       = $this->memo_insert_term( 'Books', (string) $collection_id, TraitTaxonomy::TAXONOMY );
		$row_id        = $this->create_page( 'Book row' );
		$this->memo_set_object_terms( $row_id, array( $term_id ) );

		$this->invoke_seeder_method( 'nest_collections_under_pages', array( 'books' => $collection_id ) );

		$this->assertSame( $page_id, (int) get_post( $collection_id )->post_parent );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $collection_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $row_id ) );
		$this->assertSame( (string) $page_id, (string) get_post_meta( $collection_id, ArchiveCascade::PARENT_MARKER_META, true ) );
		$this->assertSame( (string) $collection_id, (string) get_post_meta( $row_id, ArchiveCascade::COLLECTION_MARKER_META, true ) );

		$this->archive_cascade->unarchive( $page_id );

		$this->assertSame( 'private', get_post_status( $collection_id ) );
		$this->assertSame( 'private', get_post_status( $row_id ) );
	}

	public function test_seed_preferences_skip_archived_candidates(): void {
		$user_id           = $this->create_user();
		$workspace_page_id = $this->create_page( 'Welcome' );
		$library_id        = $this->create_page( 'Library' );
		$music_id          = $this->create_page( 'Music Catalog' );
		$team_id           = $this->create_page( 'Team Workspace' );
		$this->archive_cascade->archive( $workspace_page_id );
		$this->archive_cascade->archive( $library_id );

		$this->invoke_seeder_method( 'seed_workspace_home', $user_id, $workspace_page_id );
		$this->invoke_seeder_method( 'seed_favorites', $user_id, $workspace_page_id );

		$this->assertSame( '', get_user_meta( $user_id, 'cortext_workspace_home', true ) );
		$this->assertSame(
			array( "page:{$music_id}", "page:{$team_id}" ),
			get_user_meta( $user_id, 'cortext_favorites', true )
		);
	}

	public function test_seed_preferences_keep_existing_archived_values(): void {
		$user_id     = $this->create_user();
		$archived_id = $this->create_page( 'Archived preference' );
		$active_id   = $this->create_page( 'Active candidate' );
		$this->archive_cascade->archive( $archived_id );
		update_user_meta( $user_id, 'cortext_workspace_home', $archived_id );
		update_user_meta( $user_id, 'cortext_favorites', array( $archived_id ) );

		$this->invoke_seeder_method( 'seed_workspace_home', $user_id, $active_id );
		$this->invoke_seeder_method( 'seed_favorites', $user_id, $active_id );

		$this->assertSame( $archived_id, get_user_meta( $user_id, 'cortext_workspace_home', true ) );
		$this->assertSame( array( $archived_id ), get_user_meta( $user_id, 'cortext_favorites', true ) );
	}

	private function invoke_seeder_method( string $name, ...$arguments ) {
		$method = new ReflectionMethod( $this->seeder, $name );
		$method->setAccessible( true );

		return $method->invoke( $this->seeder, ...$arguments );
	}

	private function create_page( string $title ): int {
		return (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
	}

	private function create_user(): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_seed_', false ),
				'user_pass'  => 'password',
				'role'       => 'administrator',
			)
		);
	}
}
