<?php
/**
 * Tests for the in-memory term-store shim.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_Term;

final class Test_In_Memory_Term_Store extends BaseTestCase {

	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		$this->install_in_memory_term_store();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_term_store();

		parent::tear_down();
	}

	public function test_get_the_terms_rebuilds_invalid_cached_term_objects(): void {
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Cached relationship owner',
			)
		);
		$term_id = $this->memo_insert_term( 'Trait 42', '42', TraitTaxonomy::TAXONOMY );
		$this->memo_set_object_terms( $post_id, array( $term_id ) );

		wp_cache_delete( $term_id, 'terms' );

		$this->assertSame( array( null ), get_object_term_cache( $post_id, TraitTaxonomy::TAXONOMY ) );

		$terms = get_the_terms( $post_id, TraitTaxonomy::TAXONOMY );

		$this->assertIsArray( $terms );
		$this->assertCount( 1, $terms );
		$this->assertInstanceOf( WP_Term::class, $terms[0] );
		$this->assertSame( $term_id, $terms[0]->term_id );
		$this->assertSame( '42', $terms[0]->slug );
	}

	public function test_get_the_terms_preserves_valid_term_objects(): void {
		$term_id = $this->memo_insert_term( 'Trait 7', '7', TraitTaxonomy::TAXONOMY );
		$term    = get_term( $term_id, TraitTaxonomy::TAXONOMY );
		$terms   = array( $term );

		$this->assertInstanceOf( WP_Term::class, $term );
		$this->assertSame( $terms, $this->mock_get_the_terms( $terms, 123, TraitTaxonomy::TAXONOMY ) );
	}

	public function test_get_the_terms_drops_invalid_cache_without_a_backing_relationship(): void {
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Orphaned relationship cache',
			)
		);

		wp_cache_set( $post_id, array( 999 ), TraitTaxonomy::TAXONOMY . '_relationships' );
		$this->assertSame( array( null ), get_object_term_cache( $post_id, TraitTaxonomy::TAXONOMY ) );
		$this->assertFalse( get_the_terms( $post_id, TraitTaxonomy::TAXONOMY ) );
	}
}
