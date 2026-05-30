<?php
/**
 * Tests for Cortext\PostType\Field::cleanup_after_delete.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;

final class Test_Post_Type_Field_Cleanup extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private Field $field;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );

		$this->field = new Field();
		$this->field->register();
		do_action( 'init' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_registers_before_delete_post_hook(): void {
		$this->assertSame(
			10,
			has_action( 'before_delete_post', array( $this->field, 'cleanup_after_delete' ) )
		);
	}

	public function test_field_delete_detaches_from_collection_schema(): void {
		$collection_id = $this->create_collection();
		$field_id      = $this->attach_field( $collection_id, 'text' );

		$this->assertContains( (string) $field_id, $this->stored_fields( $collection_id ) );

		wp_delete_post( $field_id, true );

		$this->assertNotContains( (string) $field_id, $this->stored_fields( $collection_id ) );
	}

	public function test_field_delete_clears_row_value_meta(): void {
		$collection_id = $this->create_collection();
		$field_id      = $this->attach_field( $collection_id, 'text' );
		$row_a         = $this->create_row( $collection_id );
		$row_b         = $this->create_row( $collection_id );
		update_post_meta( $row_a, "field-{$field_id}", 'reading' );
		update_post_meta( $row_b, "field-{$field_id}", 'done' );

		wp_delete_post( $field_id, true );

		$this->assertSame( '', get_post_meta( $row_a, "field-{$field_id}", true ) );
		$this->assertSame( '', get_post_meta( $row_b, "field-{$field_id}", true ) );
	}

	public function test_field_delete_keeps_other_field_meta_on_same_row(): void {
		$collection_id = $this->create_collection();
		$field_a       = $this->attach_field( $collection_id, 'text' );
		$field_b       = $this->attach_field( $collection_id, 'text' );
		$row_id        = $this->create_row( $collection_id );
		update_post_meta( $row_id, "field-{$field_a}", 'value-a' );
		update_post_meta( $row_id, "field-{$field_b}", 'value-b' );

		wp_delete_post( $field_a, true );

		$this->assertSame( '', get_post_meta( $row_id, "field-{$field_a}", true ) );
		$this->assertSame(
			'value-b',
			get_post_meta( $row_id, "field-{$field_b}", true ),
			'Other field meta on the same row must be left alone.'
		);
		$this->assertContains( (string) $field_b, $this->stored_fields( $collection_id ) );
	}

	public function test_relation_field_delete_removes_reverse_and_detaches_both(): void {
		$tasks_id   = $this->create_collection();
		$people_id  = $this->create_collection();
		$source_id  = $this->attach_relation_field( $tasks_id, $people_id );
		$reverse_id = $this->attach_relation_field( $people_id, $tasks_id );
		update_post_meta( $source_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $source_id );

		$task_id   = $this->create_row( $tasks_id );
		$person_id = $this->create_row( $people_id );
		add_post_meta( $task_id, Relations::meta_key( $source_id ), (string) $person_id );
		add_post_meta( $person_id, Relations::meta_key( $reverse_id ), (string) $task_id );

		wp_delete_post( $source_id, true );

		$this->assertNull( get_post( $reverse_id ) );
		$this->assertNotContains( (string) $source_id, $this->stored_fields( $tasks_id ) );
		$this->assertNotContains( (string) $reverse_id, $this->stored_fields( $people_id ) );
		$this->assertSame(
			array(),
			get_post_meta( $task_id, Relations::meta_key( $source_id ), false )
		);
		$this->assertSame(
			array(),
			get_post_meta( $person_id, Relations::meta_key( $reverse_id ), false )
		);
	}

	public function test_relation_field_delete_removes_dependent_rollup(): void {
		$projects_id = $this->create_collection();
		$invoices_id = $this->create_collection();
		$relation_id = $this->attach_relation_field( $projects_id, $invoices_id );
		$reverse_id  = $this->attach_relation_field( $invoices_id, $projects_id );
		update_post_meta( $relation_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $relation_id );

		$amount_id = $this->attach_field( $invoices_id, 'number' );
		$rollup_id = $this->attach_rollup_field( $projects_id, $relation_id, $amount_id );

		wp_delete_post( $relation_id, true );

		$this->assertNull( get_post( $rollup_id ) );
		$this->assertNotContains( (string) $rollup_id, $this->stored_fields( $projects_id ) );
	}

	public function test_target_field_delete_removes_dependent_rollup(): void {
		$projects_id = $this->create_collection();
		$invoices_id = $this->create_collection();
		$relation_id = $this->attach_relation_field( $projects_id, $invoices_id );
		$reverse_id  = $this->attach_relation_field( $invoices_id, $projects_id );
		update_post_meta( $relation_id, 'relation_reverse_field_id', (string) $reverse_id );
		update_post_meta( $reverse_id, 'relation_reverse_field_id', (string) $relation_id );

		$amount_id = $this->attach_field( $invoices_id, 'number' );
		$rollup_id = $this->attach_rollup_field( $projects_id, $relation_id, $amount_id );

		wp_delete_post( $amount_id, true );

		$this->assertNull( get_post( $rollup_id ) );
		$this->assertNotContains( (string) $rollup_id, $this->stored_fields( $projects_id ) );
	}

	public function test_non_field_delete_leaves_schema_untouched(): void {
		$collection_id = $this->create_collection();
		$field_id      = $this->attach_field( $collection_id, 'text' );
		$row_id        = $this->create_row( $collection_id );
		update_post_meta( $row_id, "field-{$field_id}", 'value' );

		// Deleting a row must not run the field cleanup.
		wp_delete_post( $row_id, true );

		$this->assertContains( (string) $field_id, $this->stored_fields( $collection_id ) );
	}

	/**
	 * Creates a collection document and forces its mirror term so
	 * `Document::is_collection` resolves true.
	 */
	private function create_collection(): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . wp_generate_uuid4(),
			)
		);
		( new TraitTaxonomy() )->ensure_mirror_term( $id );
		return $id;
	}

	/**
	 * Creates a row document attached to a collection's trait term.
	 *
	 * @param int $collection_id Collection document id.
	 */
	private function create_row( int $collection_id ): int {
		$row_id  = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Row ' . wp_generate_uuid4(),
			)
		);
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		if ( $term_id > 0 ) {
			wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		}
		return $row_id;
	}

	/**
	 * Inserts a field and attaches it to a collection's `cortext_fields`.
	 *
	 * @param int                  $collection_id Collection document id.
	 * @param string               $type          Field type.
	 * @param array<string,string> $meta          Extra meta to store on the field.
	 */
	private function attach_field( int $collection_id, string $type, array $meta = array() ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => ucfirst( $type ) . ' field',
				'meta_input'  => array_merge( array( 'type' => $type ), $meta ),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		return $field_id;
	}

	/**
	 * Inserts a relation field pointing at a target collection and attaches it
	 * to its owner collection.
	 *
	 * @param int $owner_id  Collection that owns the field.
	 * @param int $target_id Collection the relation points at.
	 */
	private function attach_relation_field( int $owner_id, int $target_id ): int {
		return $this->attach_field(
			$owner_id,
			'relation',
			array(
				'related_collection_id' => (string) $target_id,
				'relation_multiple'     => '1',
			)
		);
	}

	/**
	 * Inserts a rollup field that depends on a relation and target field and
	 * attaches it to its owner collection.
	 *
	 * @param int $owner_id     Collection that owns the rollup.
	 * @param int $relation_id  Relation field the rollup walks.
	 * @param int $target_id    Target field the rollup aggregates.
	 */
	private function attach_rollup_field( int $owner_id, int $relation_id, int $target_id ): int {
		return $this->attach_field(
			$owner_id,
			'rollup',
			array(
				'rollup_relation_field_id' => (string) $relation_id,
				'rollup_target_field_id'   => (string) $target_id,
				'rollup_aggregator'        => 'sum',
			)
		);
	}

	/**
	 * Returns the stored `cortext_fields` entries for a collection.
	 *
	 * @param int $collection_id Collection document id.
	 * @return string[]
	 */
	private function stored_fields( int $collection_id ): array {
		return array_map(
			'strval',
			(array) get_post_meta( $collection_id, 'cortext_fields', false )
		);
	}
}
