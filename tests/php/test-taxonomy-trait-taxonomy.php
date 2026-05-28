<?php
/**
 * Tests for Cortext\Taxonomy\TraitTaxonomy.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;

final class Test_Taxonomy_Trait_Taxonomy extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private TraitTaxonomy $trait_taxonomy;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new Field() )->register_post_type();

		$this->trait_taxonomy = new TraitTaxonomy();
		$this->trait_taxonomy->register_taxonomy();

		// Wire the meta listeners directly; `register()` would queue them on
		// `init`, which has already fired in the test harness.
		add_action( 'added_post_meta', array( $this->trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $this->trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $this->trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $this->trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_taxonomy_constant_matches_expected_slug(): void {
		$this->assertSame( 'crtxt_trait', TraitTaxonomy::TAXONOMY );
	}

	public function test_register_taxonomy_attaches_to_document_post_type(): void {
		$this->assertTrue( taxonomy_exists( TraitTaxonomy::TAXONOMY ) );
		$this->assertContains(
			Document::POST_TYPE,
			(array) get_taxonomy( TraitTaxonomy::TAXONOMY )->object_type
		);
	}

	public function test_term_slug_for_trait_uses_document_id(): void {
		$this->assertSame( '42', TraitTaxonomy::term_slug_for_trait( 42 ) );
	}

	public function test_term_id_for_trait_returns_zero_when_missing(): void {
		$this->assertSame( 0, TraitTaxonomy::term_id_for_trait( 12345 ) );
	}

	public function test_term_id_for_trait_returns_wp_term_id_when_present(): void {
		$collection_id = $this->create_collection();

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );

		$this->assertGreaterThan( 0, $term_id );
	}

	public function test_trait_id_for_term_returns_document_id(): void {
		$collection_id = $this->create_collection();
		$term_id       = TraitTaxonomy::term_id_for_trait( $collection_id );

		$this->assertSame( $collection_id, TraitTaxonomy::trait_id_for_term( $term_id ) );
	}

	public function test_trait_id_for_term_returns_zero_for_missing_term(): void {
		$this->assertSame( 0, TraitTaxonomy::trait_id_for_term( 99999 ) );
	}

	public function test_trait_id_for_term_returns_zero_for_malformed_slug(): void {
		// Insert a foreign term with a non-numeric slug into the in-memory
		// store, then verify the parser refuses it.
		$term_id = $this->memo_insert_term( 'Weird', 'not-a-number', TraitTaxonomy::TAXONOMY );

		$this->assertSame( 0, TraitTaxonomy::trait_id_for_term( $term_id ) );
	}

	public function test_trait_id_from_slug_parses_numeric_slugs(): void {
		$this->assertSame( 17, TraitTaxonomy::trait_id_from_slug( '17' ) );
	}

	public function test_trait_id_from_slug_rejects_non_numeric_slugs(): void {
		$this->assertSame( 0, TraitTaxonomy::trait_id_from_slug( 'foo' ) );
		$this->assertSame( 0, TraitTaxonomy::trait_id_from_slug( '12abc' ) );
		$this->assertSame( 0, TraitTaxonomy::trait_id_from_slug( '' ) );
		$this->assertSame( 0, TraitTaxonomy::trait_id_from_slug( '-5' ) );
	}

	public function test_sync_term_creates_mirror_on_first_cortext_fields_meta(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Albums',
			)
		);
		// No term exists yet.
		$this->assertSame( 0, TraitTaxonomy::term_id_for_trait( $collection_id ) );

		add_post_meta( $collection_id, 'cortext_fields', '7' );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );

		$term = get_term( $term_id, TraitTaxonomy::TAXONOMY );
		$this->assertNotNull( $term );
		$this->assertSame( (string) $collection_id, $term->slug );
		$this->assertSame( "Trait {$collection_id}", $term->name );
	}

	public function test_sync_term_is_idempotent_across_multiple_cortext_fields_writes(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Recipes',
			)
		);

		add_post_meta( $collection_id, 'cortext_fields', '1' );
		$first_term_id = TraitTaxonomy::term_id_for_trait( $collection_id );

		add_post_meta( $collection_id, 'cortext_fields', '2' );
		add_post_meta( $collection_id, 'cortext_fields', '3' );

		$this->assertSame( $first_term_id, TraitTaxonomy::term_id_for_trait( $collection_id ) );
	}

	public function test_sync_term_keeps_mirror_when_collection_loses_fields(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Goes away',
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', '11' );
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );

		// Field reorder and similar bulk edits wipe `cortext_fields` and
		// re-add the entries in a new order. The reconciler must not delete
		// the term during that gap, or `wp_delete_term` would cascade and
		// strip every row→collection relationship.
		\WorDBless\PostMeta::init()->clear_all_meta_for_object( $collection_id );
		$this->trait_taxonomy->ensure_mirror_term_state( $collection_id );

		$this->assertSame( $term_id, TraitTaxonomy::term_id_for_trait( $collection_id ) );
	}

	public function test_sync_term_ignores_meta_on_other_post_types(): void {
		$foreign_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Foreign',
			)
		);
		add_post_meta( $foreign_id, 'cortext_fields', '1' );

		$this->assertSame( 0, TraitTaxonomy::term_id_for_trait( $foreign_id ) );
	}

	public function test_ensure_mirror_term_state_does_not_recreate_an_existing_term(): void {
		$collection_id = $this->create_collection();
		$first_term_id = TraitTaxonomy::term_id_for_trait( $collection_id );

		$this->trait_taxonomy->ensure_mirror_term_state( $collection_id );

		$this->assertSame( $first_term_id, TraitTaxonomy::term_id_for_trait( $collection_id ) );
	}

	public function test_permanent_delete_removes_the_mirror_term(): void {
		$collection_id = $this->create_collection();
		$this->assertGreaterThan( 0, TraitTaxonomy::term_id_for_trait( $collection_id ) );

		wp_delete_post( $collection_id, true );

		$this->assertSame( 0, TraitTaxonomy::term_id_for_trait( $collection_id ) );
	}

	public function test_trash_keeps_the_mirror_term_intact(): void {
		$collection_id = $this->create_collection();
		$term_id       = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );

		wp_trash_post( $collection_id );

		$this->assertSame(
			$term_id,
			TraitTaxonomy::term_id_for_trait( $collection_id ),
			'Trashed collections keep their mirror term so a restore reattaches the rows.'
		);
	}

	private function create_collection(): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . wp_generate_uuid4(),
			)
		);

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Title',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		add_post_meta( $id, 'cortext_fields', (string) $field_id );

		return $id;
	}
}
