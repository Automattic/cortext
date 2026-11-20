<?php
/**
 * Tests for the collection-to-row leg of Cortext\PostType\TrashCascade.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\FieldValues\FieldValueIndex;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Response;

final class Test_Row_Trash_Cascade extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_actions( 'before_delete_post' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		( new TrashCascade() )->register();
	}

	public function tear_down(): void {
		FieldValueIndex::flush_runtime_caches();
		delete_option( 'cortext_field_values_index_status' );
		delete_option( 'cortext_field_values_schema_version' );
		remove_all_filters( 'wordbless_wpdb_delete' );
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		parent::tear_down();
	}

	public function test_register_hooks_trash_untrash_and_delete_actions(): void {
		$this->assertNotFalse( has_action( 'wp_trash_post' ) );
		$this->assertNotFalse( has_action( 'untrashed_post' ) );
		$this->assertNotFalse( has_action( 'before_delete_post' ) );
	}

	public function test_trashing_collection_trashes_its_rows_and_stamps_marker(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 3 );

		wp_trash_post( $collection_id );

		foreach ( $row_ids as $row_id ) {
			$this->assertSame( 'trash', get_post_status( $row_id ) );
			$this->assertSame(
				(string) $collection_id,
				(string) get_post_meta( $row_id, TrashCascade::COLLECTION_MARKER_META, true ),
				'Each row trashed by the cascade carries the collection id as its owner marker.'
			);
		}
	}

	public function test_restoring_collection_revives_only_rows_its_cascade_trashed(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 2 );
		$independently_trashed       = $this->create_row_for_collection( $collection_id );

		// Trash one row independently. It carries no marker.
		wp_trash_post( $independently_trashed );

		wp_trash_post( $collection_id );
		wp_untrash_post( $collection_id );

		foreach ( $row_ids as $row_id ) {
			$this->assertNotSame( 'trash', get_post_status( $row_id ), 'Cascade-trashed rows come back on restore.' );
			$this->assertSame(
				'',
				(string) get_post_meta( $row_id, TrashCascade::COLLECTION_MARKER_META, true ),
				'Marker is cleared so a future cascade restore does not revive the row twice.'
			);
		}

		$this->assertSame(
			'trash',
			get_post_status( $independently_trashed ),
			'Rows that were already in trash without the marker stay there after the collection restore.'
		);
	}

	public function test_permanent_delete_of_collection_removes_all_rows(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 2 );

		wp_delete_post( $collection_id, true );

		foreach ( $row_ids as $row_id ) {
			$this->assertNull( get_post( $row_id ), 'Rows must be gone after a collection force-delete.' );
		}
	}

	public function test_permanent_delete_keeps_priority_lead_over_trait_term_sync(): void {
		// Production wires TraitTaxonomy::sync_term_on_delete at priority 10
		// on `before_delete_post`, and registers it BEFORE TrashCascade. If
		// TrashCascade::on_delete ran at the same priority, the trait term
		// would be deleted first and `all_row_ids` (which queries by term)
		// would return empty, leaving the rows orphaned. Re-add the term sync
		// hook on top of the test's clean slate to reproduce the production
		// order, then assert the cascade still finds and deletes the rows.
		( new TraitTaxonomy() )->register_taxonomy();
		add_action(
			'before_delete_post',
			array( new TraitTaxonomy(), 'sync_term_on_delete' ),
			10,
			2
		);

		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 2 );

		wp_delete_post( $collection_id, true );

		foreach ( $row_ids as $row_id ) {
			$this->assertNull(
				get_post( $row_id ),
				'TrashCascade::on_delete must run before TraitTaxonomy::sync_term_on_delete, otherwise the row lookup loses its key.'
			);
		}
	}

	public function test_permanent_delete_of_already_trashed_collection_still_force_deletes_rows(): void {
		[ $collection_id, $row_ids ] = $this->create_collection_with_rows( 2 );

		wp_trash_post( $collection_id );

		wp_delete_post( $collection_id, true );

		foreach ( $row_ids as $row_id ) {
			$this->assertNull( get_post( $row_id ) );
		}
	}

	public function test_trashing_collection_keeps_rows_shared_with_another_collection(): void {
		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 2 );
		$collection_b               = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$this->add_membership( $shared_row, $collection_b );

		wp_trash_post( $collection_a );

		$this->assertNotSame(
			'trash',
			get_post_status( $shared_row ),
			'A row that also belongs to another collection survives trashing one of its collections.'
		);
		$this->assertSame(
			'',
			(string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ),
			'A surviving shared row carries no cascade marker.'
		);
		$this->assertSame(
			'trash',
			get_post_status( $row_ids[1] ),
			'Rows exclusive to the trashed collection still follow it to trash.'
		);
	}

	public function test_restoring_collection_leaves_shared_rows_untouched(): void {
		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 2 );
		$collection_b               = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$this->add_membership( $shared_row, $collection_b );

		wp_trash_post( $collection_a );
		wp_untrash_post( $collection_a );

		$this->assertNotSame( 'trash', get_post_status( $shared_row ), 'The shared row was never trashed.' );
		$this->assertNotSame( 'trash', get_post_status( $row_ids[1] ), 'The exclusive row comes back on restore.' );
		$this->assertTrue(
			has_term( TraitTaxonomy::term_id_for_trait( $collection_b ), TraitTaxonomy::TAXONOMY, $shared_row ),
			'The shared row keeps its other membership across the trash/restore.'
		);
	}

	public function test_trashing_last_active_collection_trashes_shared_row(): void {
		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 1 );
		$collection_b               = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$this->add_membership( $shared_row, $collection_b );

		wp_trash_post( $collection_a );

		$this->assertNotSame(
			'trash',
			get_post_status( $shared_row ),
			'The row stays live while its second collection is active.'
		);

		wp_trash_post( $collection_b );

		$this->assertSame(
			'trash',
			get_post_status( $shared_row ),
			'Trashing the last active collection must not leave a live row with only trashed memberships.'
		);
		$this->assertSame(
			(string) $collection_b,
			(string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ),
			'The final active collection owns the cascade marker.'
		);

		$response = ( new TrashCascade() )->extend_trash_response(
			new WP_REST_Response( array() ),
			get_post( $collection_b ),
			new WP_REST_Request( 'DELETE', '/' )
		);
		$this->assertContains(
			$shared_row,
			$response->get_data()['cascade_deleted'],
			'The trash response includes the shared row that the last active collection cascaded.'
		);
	}

	public function test_restoring_any_member_collection_revives_cascade_trashed_shared_row(): void {
		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 1 );
		$collection_b               = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$this->add_membership( $shared_row, $collection_b );

		wp_trash_post( $collection_a );
		wp_trash_post( $collection_b );
		$this->assertSame( (string) $collection_b, (string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ) );
		$this->assertContains(
			$shared_row,
			( new TrashCascade() )->restore_candidates_for_root( $collection_a ),
			'The restore snapshot includes rows marked by a different member collection.'
		);

		wp_untrash_post( $collection_a );

		$this->assertNotSame(
			'trash',
			get_post_status( $shared_row ),
			'Restoring collection A revives the row even though collection B caused the cascade.'
		);
		$this->assertSame( 'trash', get_post_status( $collection_b ) );
		$this->assertSame( '', (string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ) );
	}

	public function test_restoring_collection_does_not_revive_manually_trashed_shared_row(): void {
		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 1 );
		$collection_b               = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$this->add_membership( $shared_row, $collection_b );

		wp_trash_post( $shared_row );
		wp_trash_post( $collection_a );
		wp_trash_post( $collection_b );
		$this->assertSame( '', (string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ) );

		wp_untrash_post( $collection_a );

		$this->assertSame(
			'trash',
			get_post_status( $shared_row ),
			'A row sent to trash directly has no cascade marker and must stay there.'
		);
	}

	public function test_permanent_delete_of_last_active_collection_preserves_row_for_trashed_membership(): void {
		$this->register_term_delete_hook();

		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 1 );
		$collection_b               = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$this->add_membership( $shared_row, $collection_b );

		wp_trash_post( $collection_b );
		wp_trash_post( $collection_a );
		$this->assertSame( (string) $collection_a, (string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ) );

		// Match DocumentsController's permanent-delete walk. A shared row is
		// not an owned descendant of A because B still retains it for restore.
		$descendants = ( new TrashCascade() )->descendants_for_root( $collection_a );
		$this->assertNotContains( $shared_row, $descendants );
		foreach ( array_reverse( $descendants ) as $descendant_id ) {
			wp_delete_post( $descendant_id, true );
		}
		wp_delete_post( $collection_a, true );

		$this->assertNotNull( get_post( $shared_row ) );
		$this->assertSame( 'trash', get_post_status( $shared_row ) );

		wp_untrash_post( $collection_b );

		$this->assertNotSame( 'trash', get_post_status( $shared_row ) );
		$this->assertSame( '', (string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ) );
	}

	public function test_direct_force_delete_of_last_active_collection_trashes_shared_row_until_restore(): void {
		$this->register_term_delete_hook();

		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 1 );
		$collection_b               = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$this->add_membership( $shared_row, $collection_b );

		wp_trash_post( $collection_b );
		$this->assertNotSame( 'trash', get_post_status( $shared_row ) );

		wp_delete_post( $collection_a, true );

		$this->assertSame(
			'trash',
			get_post_status( $shared_row ),
			'A force-delete of the last active membership mirrors the last-active trash cascade.'
		);
		$this->assertSame( (string) $collection_a, (string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ) );

		wp_untrash_post( $collection_b );

		$this->assertNotSame( 'trash', get_post_status( $shared_row ) );
		$this->assertSame( '', (string) get_post_meta( $shared_row, TrashCascade::COLLECTION_MARKER_META, true ) );
	}

	public function test_permanent_delete_keeps_rows_shared_with_another_collection(): void {
		// Reproduce the production hook order so the term is deleted after the
		// cascade decides which rows to keep.
		( new TraitTaxonomy() )->register_taxonomy();
		add_action(
			'before_delete_post',
			array( new TraitTaxonomy(), 'sync_term_on_delete' ),
			10,
			2
		);

		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 2 );
		$collection_b               = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$this->add_membership( $shared_row, $collection_b );

		wp_delete_post( $collection_a, true );

		$this->assertNotNull(
			get_post( $shared_row ),
			'A row shared with another collection survives a permanent delete of one collection.'
		);
		$remaining = wp_get_object_terms( $shared_row, TraitTaxonomy::TAXONOMY, array( 'fields' => 'slugs' ) );
		$this->assertSame(
			array( (string) $collection_b ),
			is_array( $remaining ) ? array_values( $remaining ) : array(),
			'The surviving row keeps only its membership in the other collection; the deleted one is dropped.'
		);
		$this->assertNull( get_post( $row_ids[1] ), 'Rows exclusive to the deleted collection are still removed.' );
	}

	public function test_permanent_delete_detaches_collection_relations_from_surviving_shared_rows(): void {
		$this->register_term_delete_hook();

		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 1 );
		$collection_b               = $this->create_collection();
		$target_collection          = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$target_row                 = $this->create_row_for_collection( $target_collection );
		$this->add_membership( $shared_row, $collection_b );

		$forward_field = $this->create_relation_field( $collection_a, 'Related', $target_collection );
		$reverse_field = $this->create_relation_field( $target_collection, 'Backlinks', $collection_a );
		update_post_meta( $forward_field, 'relation_reverse_field_id', (string) $reverse_field );
		update_post_meta( $reverse_field, 'relation_reverse_field_id', (string) $forward_field );

		add_post_meta( $shared_row, Relations::meta_key( $forward_field ), (string) $target_row );
		add_post_meta( $target_row, Relations::meta_key( $reverse_field ), (string) $shared_row );
		$this->assertSame( array( $shared_row ), Relations::relation_values( $target_row, $reverse_field ) );

		wp_delete_post( $collection_a, true );

		$this->assertNotNull( get_post( $shared_row ) );
		$this->assertSame(
			array(),
			Relations::relation_values( $target_row, $reverse_field ),
			'A surviving row must not leave reverse pointers from the deleted collection behind.'
		);
	}

	public function test_permanent_delete_keeps_relation_field_owned_by_surviving_membership(): void {
		$this->register_term_delete_hook();

		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 1 );
		$collection_b               = $this->create_collection();
		$target_collection          = $this->create_collection();
		$shared_row                 = $row_ids[0];
		$target_row                 = $this->create_row_for_collection( $target_collection );
		$this->add_membership( $shared_row, $collection_b );

		$forward_field = $this->create_relation_field( $collection_a, 'Related', $target_collection );
		$reverse_field = $this->create_relation_field( $target_collection, 'Backlinks', $collection_b );
		add_post_meta( $collection_b, 'cortext_fields', (string) $forward_field );
		update_post_meta( $forward_field, 'relation_reverse_field_id', (string) $reverse_field );
		update_post_meta( $reverse_field, 'relation_reverse_field_id', (string) $forward_field );

		add_post_meta( $shared_row, Relations::meta_key( $forward_field ), (string) $target_row );
		add_post_meta( $target_row, Relations::meta_key( $reverse_field ), (string) $shared_row );

		wp_delete_post( $collection_a, true );

		$this->assertNotNull( get_post( $shared_row ) );
		$this->assertSame(
			array( $shared_row ),
			Relations::relation_values( $target_row, $reverse_field ),
			'A shared relation field remains valid through the surviving collection.'
		);
	}

	public function test_permanent_delete_cleans_collection_sidecar_before_term_deletion(): void {
		$this->register_term_delete_hook();

		$index       = new FieldValueIndex();
		$reflection  = new \ReflectionClass( FieldValueIndex::class );
		$table_cache = $reflection->getProperty( 'table_exists_cache' );
		$table_cache->setAccessible( true );
		$table_cache->setValue( null, array( $index->table_name() => true ) );

		$deleted_collection_ids = array();
		add_filter(
			'wordbless_wpdb_delete',
			static function ( $result, string $table, array $where ) use ( &$deleted_collection_ids, $index ) {
				if ( $index->table_name() === $table && isset( $where['collection_id'] ) ) {
					$deleted_collection_ids[] = (int) $where['collection_id'];
				}
				return $result;
			},
			10,
			3
		);

		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 1 );
		$collection_b               = $this->create_collection();
		$this->add_membership( $row_ids[0], $collection_b );

		wp_delete_post( $collection_a, true );

		$this->assertContains(
			$collection_a,
			$deleted_collection_ids,
			'The sidecar must be cleared while the mirror term still identifies the post as a collection.'
		);
		$this->assertNotNull( get_post( $row_ids[0] ) );
	}

	public function test_permanent_delete_finalizes_sidecar_cleanup_after_self_relation_reindex(): void {
		$this->register_term_delete_hook();

		$index       = new FieldValueIndex();
		$reflection  = new \ReflectionClass( FieldValueIndex::class );
		$table_cache = $reflection->getProperty( 'table_exists_cache' );
		$table_cache->setAccessible( true );
		$table_cache->setValue( null, array( $index->table_name() => true ) );
		update_option( 'cortext_field_values_index_status', FieldValueIndex::STATUS_READY, false );
		update_option( 'cortext_field_values_schema_version', 3, false );

		[ $collection_a, $row_ids ] = $this->create_collection_with_rows( 2 );
		$collection_b               = $this->create_collection();
		$source_row                 = $row_ids[0];
		$target_row                 = $row_ids[1];
		$this->add_membership( $source_row, $collection_b );
		$this->add_membership( $target_row, $collection_b );

		$forward_field = $this->create_relation_field( $collection_a, 'Related', $collection_a );
		$reverse_field = $this->create_relation_field( $collection_a, 'Backlinks', $collection_a );
		update_post_meta( $forward_field, 'relation_reverse_field_id', (string) $reverse_field );
		update_post_meta( $reverse_field, 'relation_reverse_field_id', (string) $forward_field );
		add_post_meta( $source_row, Relations::meta_key( $forward_field ), (string) $target_row );
		add_post_meta( $target_row, Relations::meta_key( $reverse_field ), (string) $source_row );

		$sidecar_deletes = array();
		add_filter(
			'wordbless_wpdb_delete',
			static function ( $result, string $table, array $where ) use ( &$sidecar_deletes, $index ) {
				if ( $index->table_name() === $table ) {
					$sidecar_deletes[] = $where;
					return 1;
				}
				return $result;
			},
			10,
			3
		);

		wp_delete_post( $collection_a, true );

		$this->assertNotNull( get_post( $source_row ) );
		$this->assertNotNull( get_post( $target_row ) );
		$this->assertNotEmpty( $sidecar_deletes );
		$this->assertContains(
			array(
				'row_id'        => $target_row,
				'collection_id' => $collection_a,
				'field_id'      => $reverse_field,
			),
			$sidecar_deletes,
			'The relation detach re-indexes the shared self-relation target before final cleanup.'
		);
		$this->assertSame(
			array( 'collection_id' => $collection_a ),
			$sidecar_deletes[ count( $sidecar_deletes ) - 1 ],
			'The final sidecar operation removes the entire deleted collection after relation re-indexing.'
		);
	}

	public function test_trashing_a_non_collection_post_is_a_noop(): void {
		// The collection-to-row cascade only fires when the trashed document
		// carries `cortext_fields`. Trashing anything else (pages, regular WP
		// posts) should not invoke the row walk.
		register_post_type(
			'some_other_post_type',
			array(
				'public'   => false,
				'supports' => array( 'title' ),
			)
		);

		$post_id = wp_insert_post(
			array(
				'post_type'   => 'some_other_post_type',
				'post_status' => 'private',
				'post_title'  => 'Not a collection',
			)
		);

		$this->assertIsInt( $post_id );
		wp_trash_post( $post_id );

		$this->assertSame( 'trash', get_post_status( $post_id ), 'Trash itself still applies.' );
	}

	/**
	 * Creates a collection (`crtxt_document` with `cortext_fields` meta) and
	 * a set of rows tagged with its mirror trait term.
	 *
	 * @param int $row_count Number of rows to create.
	 *
	 * @return array{0:int,1:int[]} Collection id, row ids.
	 */
	private function create_collection_with_rows( int $row_count ): array {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . wp_generate_uuid4(),
			)
		);
		$this->assertGreaterThan( 0, $collection_id );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Title',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		$row_ids = array();
		for ( $i = 0; $i < $row_count; $i++ ) {
			$row_ids[] = $this->create_row_for_collection( $collection_id );
		}

		return array( $collection_id, $row_ids );
	}

	/**
	 * Creates a collection (`crtxt_document` with `cortext_fields` meta) with no
	 * rows, used as the second collection a shared row belongs to.
	 */
	private function create_collection(): int {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . wp_generate_uuid4(),
			)
		);
		$this->assertGreaterThan( 0, $collection_id );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Title',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		return $collection_id;
	}

	/**
	 * Adds a collection membership without dropping the row's existing ones.
	 *
	 * @param int $row_id        Row document id.
	 * @param int $collection_id Collection document id.
	 */
	private function add_membership( int $row_id, int $collection_id ): void {
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );

		$existing = wp_get_object_terms( $row_id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) );
		$existing = is_array( $existing ) ? array_map( 'intval', $existing ) : array();

		wp_set_object_terms(
			$row_id,
			array_values( array_unique( array_merge( $existing, array( $term_id ) ) ) ),
			TraitTaxonomy::TAXONOMY,
			false
		);
	}

	/**
	 * Creates and attaches one side of a relation field pair.
	 *
	 * @param int    $collection_id        Owning collection document id.
	 * @param string $title                Field title.
	 * @param int    $related_collection_id Related collection document id.
	 */
	private function create_relation_field( int $collection_id, string $title, int $related_collection_id ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array(
					'type'                  => 'relation',
					'relation_multiple'     => '1',
					'related_collection_id' => (string) $related_collection_id,
				),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		return $field_id;
	}

	/**
	 * Reinstalls the production mirror-term deletion hook after test setup clears it.
	 */
	private function register_term_delete_hook(): void {
		( new TraitTaxonomy() )->register_taxonomy();
		add_action(
			'before_delete_post',
			array( new TraitTaxonomy(), 'sync_term_on_delete' ),
			10,
			2
		);
	}

	private function create_row_for_collection( int $collection_id ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Row ' . wp_generate_uuid4(),
			)
		);
		$this->assertGreaterThan( 0, $id );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

		return $id;
	}
}
