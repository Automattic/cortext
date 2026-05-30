<?php
/**
 * Tests for Cortext\Documents\DocumentDuplicator.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Documents;
use Cortext\Documents\DocumentDuplicator;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_Error;
use WP_Post;

final class Test_Document_Duplicator extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private Documents $documents;
	private DocumentDuplicator $duplicator;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new DocumentIdentity() )->register();
		$trait_taxonomy = new TraitTaxonomy();
		$trait_taxonomy->register_taxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$this->documents  = new Documents();
		$this->duplicator = new DocumentDuplicator( $this->documents );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_duplicate_rejects_non_document_post_type(): void {
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Foreign post',
			)
		);
		$post    = get_post( $post_id );

		$result = $this->duplicator->duplicate( $post );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'cortext_duplicate_invalid_post_type', $result->get_error_code() );
	}

	public function test_duplicate_returns_expected_result_shape(): void {
		$source_id = $this->create_page( 'Source' );
		$source    = get_post( $source_id );

		$result = $this->duplicator->duplicate( $source );

		$this->assertIsArray( $result );
		$this->assertArrayHasKey( 'document', $result );
		$this->assertArrayHasKey( 'collection_id', $result );
		$this->assertArrayHasKey( 'skipped_fields', $result );
		$this->assertInstanceOf( WP_Post::class, $result['document'] );
		$this->assertSame( 0, $result['collection_id'] );
		$this->assertSame( array(), $result['skipped_fields'] );
	}

	public function test_duplicate_page_prefixes_copy_of_to_title(): void {
		$source_id = $this->create_page( 'Welcome' );
		$source    = get_post( $source_id );

		$result = $this->duplicator->duplicate( $source );

		$this->assertIsArray( $result );
		$this->assertSame( 'Copy of Welcome', $result['document']->post_title );
	}

	public function test_duplicate_page_uses_copy_of_untitled_when_title_blank(): void {
		$source_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => '',
			)
		);
		$source    = get_post( $source_id );

		$result = $this->duplicator->duplicate( $source );

		$this->assertIsArray( $result );
		$this->assertSame( 'Copy of Untitled', $result['document']->post_title );
	}

	public function test_duplicate_page_copies_content_excerpt_status_and_parent(): void {
		$parent_id = $this->create_page( 'Parent' );
		$source_id = (int) wp_insert_post(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_status'  => 'publish',
				'post_title'   => 'Source',
				'post_content' => 'Hello body',
				'post_excerpt' => 'Hello excerpt',
				'post_parent'  => $parent_id,
			)
		);
		$source    = get_post( $source_id );

		$result = $this->duplicator->duplicate( $source );

		$this->assertIsArray( $result );
		$document = $result['document'];
		// Trim because `post_content` may be slashed in the WorDBless mock.
		$this->assertSame( 'Hello body', wp_unslash( (string) $document->post_content ) );
		$this->assertSame( 'Hello excerpt', wp_unslash( (string) $document->post_excerpt ) );
		$this->assertSame( 'publish', $document->post_status );
		$this->assertSame( $parent_id, (int) $document->post_parent );
	}

	public function test_duplicate_collection_clones_schema_with_new_field_posts(): void {
		$collection_id = $this->create_collection_with_fields(
			array(
				array( 'Owner', 'text' ),
				array( 'Date', 'date' ),
			)
		);

		$result = $this->duplicator->duplicate( get_post( $collection_id ) );

		$this->assertIsArray( $result );
		$cloned_field_ids = $this->stored_collection_field_ids( (int) $result['document']->ID );
		$this->assertCount( 2, $cloned_field_ids );

		$titles = array_map(
			static fn ( int $id ): string => (string) get_post( $id )->post_title,
			array_map( 'intval', $cloned_field_ids )
		);
		$this->assertSame( array( 'Copy of Owner', 'Copy of Date' ), $titles );
		// New field posts have new IDs that are different from the source.
		$source_field_ids = Document::collection_field_ids( $collection_id );
		foreach ( $cloned_field_ids as $cloned_id ) {
			$this->assertNotContains( (int) $cloned_id, $source_field_ids );
		}
	}

	public function test_duplicate_collection_reports_relation_fields_as_skipped(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Links',
			)
		);
		$relation_id   = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Linked',
				'meta_input'  => array( 'type' => 'relation' ),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $relation_id );
		$scalar_id = $this->attach_field( $collection_id, 'Label', 'text' );
		unset( $scalar_id );

		$result = $this->duplicator->duplicate( get_post( $collection_id ) );

		$this->assertIsArray( $result );
		$this->assertCount( 1, $result['skipped_fields'] );
		$this->assertSame( $relation_id, $result['skipped_fields'][0]['id'] );
		$this->assertSame( 'relation_unsupported', $result['skipped_fields'][0]['reason'] );

		$cloned_field_ids = $this->stored_collection_field_ids( (int) $result['document']->ID );
		// Only the scalar field is copied.
		$this->assertCount( 1, $cloned_field_ids );
	}

	public function test_duplicate_collection_remaps_rollup_references_to_new_field_ids(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Metrics',
			)
		);
		$target_id     = $this->attach_field( $collection_id, 'Score', 'number' );
		$relation_id   = $this->attach_field( $collection_id, 'Relation', 'relation' );
		// `clone_schema` skips relation fields but rollups still copy and need
		// their pointers remapped.
		$rollup_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Total',
				'meta_input'  => array(
					'type'                     => 'rollup',
					'rollup_relation_field_id' => (string) $relation_id,
					'rollup_target_field_id'   => (string) $target_id,
					'rollup_aggregator'        => 'sum',
				),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $rollup_id );

		$result = $this->duplicator->duplicate( get_post( $collection_id ) );

		$this->assertIsArray( $result );
		$cloned_field_ids = array_map( 'intval', $this->stored_collection_field_ids( (int) $result['document']->ID ) );
		// Two fields cloned: the target and the rollup (relation is skipped).
		$this->assertCount( 2, $cloned_field_ids );
		$cloned_target = $cloned_field_ids[0];
		$cloned_rollup = $cloned_field_ids[1];

		$this->assertSame(
			(string) $cloned_target,
			(string) get_post_meta( $cloned_rollup, 'rollup_target_field_id', true )
		);
		// The relation pointer pointed at a skipped field so it should be left
		// at the source's id (no entry in the map → no remap).
		$this->assertSame(
			(string) $relation_id,
			(string) get_post_meta( $cloned_rollup, 'rollup_relation_field_id', true )
		);
	}

	public function test_duplicate_row_keeps_trait_and_copies_field_values(): void {
		$collection_id = $this->create_collection_with_fields(
			array( array( 'Status', 'text' ) )
		);
		$field_id      = Document::collection_field_ids( $collection_id )[0];
		$row_id        = $this->create_row( $collection_id, 'First' );
		update_post_meta( $row_id, "field-{$field_id}", 'shipping' );

		$result = $this->duplicator->duplicate( get_post( $row_id ) );

		$this->assertIsArray( $result );
		$this->assertSame( $collection_id, $result['collection_id'] );
		$new_row_id = (int) $result['document']->ID;
		$this->assertSame(
			'shipping',
			(string) get_post_meta( $new_row_id, "field-{$field_id}", true )
		);

		// New row carries the same trait term as the source.
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		$this->assertTrue( has_term( $term_id, TraitTaxonomy::TAXONOMY, $new_row_id ) );
	}

	public function test_duplicate_row_copies_multiselect_values_as_multi_meta(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Picks',
			)
		);
		$field_id      = $this->attach_field( $collection_id, 'Tags', 'multiselect' );
		$row_id        = $this->create_row( $collection_id, 'Pick' );
		add_post_meta( $row_id, "field-{$field_id}", 'red' );
		add_post_meta( $row_id, "field-{$field_id}", 'blue' );

		$result = $this->duplicator->duplicate( get_post( $row_id ) );

		$this->assertIsArray( $result );
		$new_row_id = (int) $result['document']->ID;
		$values     = array_map( 'strval', get_post_meta( $new_row_id, "field-{$field_id}", false ) );
		sort( $values );
		$this->assertSame( array( 'blue', 'red' ), $values );
	}

	public function test_duplicate_row_skips_relation_when_reverse_is_not_multiple(): void {
		$collection_id = $this->create_collection_with_fields( array() );
		$other_id      = $this->create_collection_with_fields( array() );

		$forward_field = $this->attach_field( $collection_id, 'Links', 'relation' );
		update_post_meta( $forward_field, 'relation_multiple', '1' );
		update_post_meta( $forward_field, 'related_collection_id', (string) $other_id );

		$reverse_field = $this->attach_field( $other_id, 'Backlinks', 'relation' );
		update_post_meta( $reverse_field, 'relation_multiple', '0' );
		update_post_meta( $reverse_field, 'related_collection_id', (string) $collection_id );

		// Wire reverse pointer.
		update_post_meta( $forward_field, 'relation_reverse_field_id', (string) $reverse_field );

		$row_id    = $this->create_row( $collection_id, 'Has links' );
		$target_id = $this->create_row( $other_id, 'Target' );
		add_post_meta( $row_id, "field-{$forward_field}", (string) $target_id );

		$result = $this->duplicator->duplicate( get_post( $row_id ) );

		$this->assertIsArray( $result );
		$new_row_id = (int) $result['document']->ID;
		$copied     = get_post_meta( $new_row_id, "field-{$forward_field}", false );
		$this->assertSame(
			array(),
			$copied,
			'Relation values must not propagate when the reverse field rejects multiple owners.'
		);
	}

	public function test_duplicate_row_skips_rollup_field_values(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Rollup parent',
			)
		);
		$target_id     = $this->attach_field( $collection_id, 'Score', 'number' );
		$rollup_id     = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Sum',
				'meta_input'  => array(
					'type'                   => 'rollup',
					'rollup_target_field_id' => (string) $target_id,
					'rollup_aggregator'      => 'sum',
				),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $rollup_id );

		$row_id = $this->create_row( $collection_id, 'A row' );
		update_post_meta( $row_id, "field-{$target_id}", '5' );
		// A stale cached rollup value sitting on the source.
		update_post_meta( $row_id, "field-{$rollup_id}", '99' );

		$result = $this->duplicator->duplicate( get_post( $row_id ) );

		$this->assertIsArray( $result );
		$new_row_id = (int) $result['document']->ID;
		$this->assertSame( '5', (string) get_post_meta( $new_row_id, "field-{$target_id}", true ) );
		$this->assertSame( '', (string) get_post_meta( $new_row_id, "field-{$rollup_id}", true ) );
	}

	public function test_duplicate_hybrid_document_clones_schema_and_keeps_membership(): void {
		// A document that's BOTH a collection (has cortext_fields) and a row
		// (carries a trait term of some OTHER collection). This is an edge
		// case the data model permits even if no UX path exposes it.
		$parent_collection_id = $this->create_collection_with_fields(
			array( array( 'Owner', 'text' ) )
		);
		$parent_field_id      = Document::collection_field_ids( $parent_collection_id )[0];

		$hybrid_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Hybrid',
			)
		);
		// Hybrid is itself a collection.
		$self_field_id = $this->attach_field( $hybrid_id, 'Self schema', 'text' );
		unset( $self_field_id );
		// Hybrid is also a row of the parent collection.
		$parent_term_id = TraitTaxonomy::term_id_for_trait( $parent_collection_id );
		wp_set_object_terms( $hybrid_id, array( $parent_term_id ), TraitTaxonomy::TAXONOMY, false );
		update_post_meta( $hybrid_id, "field-{$parent_field_id}", 'me' );

		$result = $this->duplicator->duplicate( get_post( $hybrid_id ) );

		$this->assertIsArray( $result );
		$new_id = (int) $result['document']->ID;
		// Schema was cloned.
		$cloned_field_ids = $this->stored_collection_field_ids( $new_id );
		$this->assertCount( 1, $cloned_field_ids );
		$this->assertSame( 'Copy of Self schema', (string) get_post( (int) $cloned_field_ids[0] )->post_title );
		// Membership was preserved.
		$this->assertSame( $parent_collection_id, $result['collection_id'] );
		$this->assertTrue( has_term( $parent_term_id, TraitTaxonomy::TAXONOMY, $new_id ) );
		// Field value from the parent collection was copied.
		$this->assertSame(
			'me',
			(string) get_post_meta( $new_id, "field-{$parent_field_id}", true )
		);
	}

	public function test_duplicate_collection_copies_field_description_and_default(): void {
		$collection_id = $this->create_collection_with_fields( array( array( 'Status', 'text' ) ) );
		$field_id      = Document::collection_field_ids( $collection_id )[0];
		update_post_meta( $field_id, 'description', 'Ships from the warehouse' );
		update_post_meta(
			$field_id,
			'default_value',
			(string) wp_json_encode(
				array(
					'mode'  => 'value',
					'value' => 'pending',
				)
			)
		);

		$result = $this->duplicator->duplicate( get_post( $collection_id ) );

		$this->assertIsArray( $result );
		$cloned_field_id = (int) $this->stored_collection_field_ids( (int) $result['document']->ID )[0];
		$this->assertSame( 'Ships from the warehouse', get_post_meta( $cloned_field_id, 'description', true ) );
		$this->assertStringContainsString( 'pending', (string) get_post_meta( $cloned_field_id, 'default_value', true ) );
	}

	private function create_page( string $title ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
		$this->assertGreaterThan( 0, $id );
		return $id;
	}

	/**
	 * Creates a collection document with the given list of `[title, type]`
	 * fields wired through `cortext_fields`.
	 *
	 * @param array<int, array{0: string, 1: string}> $fields Field definitions.
	 */
	private function create_collection_with_fields( array $fields ): int {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . wp_generate_uuid4(),
			)
		);
		foreach ( $fields as $field ) {
			[ $title, $type ] = $field;
			$this->attach_field( $collection_id, $title, $type );
		}
		// At least one field must exist for `Document::is_collection` to return
		// true; tests that need an empty schema can add fields later or pass
		// `[]` and rely on the term being created when a field is added.
		if ( count( $fields ) === 0 ) {
			$this->attach_field( $collection_id, 'Placeholder', 'text' );
		}
		return $collection_id;
	}

	private function attach_field( int $collection_id, string $title, string $type ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => $type ),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		return $field_id;
	}

	private function create_row( int $collection_id, string $title ): int {
		$id      = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		return $id;
	}

	/**
	 * Reads the stored `cortext_fields` entries for a collection directly from
	 * WorDBless's in-memory store so duplicate-test assertions see real DB
	 * state.
	 *
	 * @param int $collection_id Collection document id.
	 * @return string[]
	 */
	private function stored_collection_field_ids( int $collection_id ): array {
		$store  = \WorDBless\PostMeta::init()->meta[ $collection_id ] ?? array();
		$stored = array();
		foreach ( $store as $row ) {
			if ( isset( $row['meta_key'] ) && 'cortext_fields' === $row['meta_key'] ) {
				$stored[] = (string) maybe_unserialize( $row['meta_value'] );
			}
		}
		return $stored;
	}
}
