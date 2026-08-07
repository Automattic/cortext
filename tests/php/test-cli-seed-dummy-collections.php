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

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		( new ArchiveCascade() )->register_status();

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();
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

	private function invoke_seeder_method( string $name, ...$arguments ) {
		$method = new ReflectionMethod( $this->seeder, $name );
		$method->setAccessible( true );

		return $method->invoke( $this->seeder, ...$arguments );
	}
}
