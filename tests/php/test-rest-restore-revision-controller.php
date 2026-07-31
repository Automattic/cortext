<?php
/**
 * Tests for Cortext\Rest\RestoreRevisionController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Editor\RevisionMetaFormat;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Relations;
use Cortext\Rest\RestoreRevisionController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Restore_Revision_Controller extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new Document() )->register_collection_meta();
		( new DocumentIdentity() )->register();
		( new RevisionMetaFormat() )->register();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RestoreRevisionController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/restore-revision', $routes );
	}

	public function test_restores_document_content_and_field_meta(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection();
		$field_id      = (int) get_post_meta( $collection_id, 'cortext_fields', true );
		$row_id        = $this->create_row( $collection_id );
		update_post_meta( $row_id, "field-{$field_id}", 'new value' );

		$revision_id = $this->create_revision(
			$row_id,
			array(
				'post_title'   => 'Old title',
				'post_content' => '<!-- wp:paragraph --><p>Old body</p><!-- /wp:paragraph -->',
			)
		);
		$this->add_revision_meta( $revision_id, "field-{$field_id}", 'old value' );

		$response = $this->restore_revision( $row_id, $revision_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Old title', get_post( $row_id )->post_title );
		$this->assertStringContainsString( 'Old body', get_post( $row_id )->post_content );
		$this->assertSame( 'old value', get_post_meta( $row_id, "field-{$field_id}", true ) );
		$this->assertSame( $revision_id, $response->get_data()['revision'] );
		// A pre-restore snapshot is reported so the restore stays reversible.
		$this->assertArrayHasKey( 'snapshot', $response->get_data() );
		// The restored state is also revisioned so history can keep treating
		// the latest revision as the current visual version.
		$this->assertArrayHasKey( 'restoredSnapshot', $response->get_data() );
	}

	public function test_restore_creates_current_revision_for_restored_state(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page(
			array(
				'post_title'   => 'Current title',
				'post_content' => '<!-- wp:paragraph --><p>Current body</p><!-- /wp:paragraph -->',
			)
		);

		$revision_id = $this->create_revision(
			$page_id,
			array(
				'post_title'   => 'Old title',
				'post_content' => '<!-- wp:paragraph --><p>Old body</p><!-- /wp:paragraph -->',
			)
		);

		$response = $this->restore_revision( $page_id, $revision_id );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertGreaterThan( 0, (int) $data['snapshot'] );
		$this->assertGreaterThan( 0, (int) $data['restoredSnapshot'] );
		$this->assertSame( 'Current title', get_post( (int) $data['snapshot'] )->post_title );
		$this->assertSame( 'Old title', get_post( (int) $data['restoredSnapshot'] )->post_title );

		$this->assertArrayHasKey(
			(int) $data['restoredSnapshot'],
			wp_get_post_revisions( $page_id )
		);
	}

	public function test_restores_icon_and_cover_identity(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id      = $this->create_page();
		$current_icon = '{"type":"wp","name":"star","color":"red"}';
		$old_icon     = '{"type":"wp","name":"home","color":"blue"}';
		update_post_meta( $page_id, DocumentIdentity::META_KEY, $current_icon );
		update_post_meta( $page_id, '_thumbnail_id', '222' );

		$revision_id = $this->create_revision( $page_id );
		$this->add_revision_meta( $revision_id, DocumentIdentity::META_KEY, $old_icon );
		$this->add_revision_meta( $revision_id, '_thumbnail_id', '111' );

		$response = $this->restore_revision( $page_id, $revision_id );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $old_icon, get_post_meta( $page_id, DocumentIdentity::META_KEY, true ) );
		$this->assertSame( 111, (int) get_post_thumbnail_id( $page_id ) );
		$this->assertSame( 111, (int) ( $data['post']['featured_media'] ?? 0 ) );
		$this->assertSame( 2, $data['metaRestored']['identity'] );
	}

	public function test_restore_clears_icon_and_cover_when_revision_has_none(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		update_post_meta( $page_id, DocumentIdentity::META_KEY, '{"type":"wp","name":"star"}' );
		update_post_meta( $page_id, '_thumbnail_id', '222' );

		$revision_id = $this->create_revision( $page_id );
		$response    = $this->restore_revision( $page_id, $revision_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '', get_post_meta( $page_id, DocumentIdentity::META_KEY, true ) );
		$this->assertSame( 0, (int) get_post_thumbnail_id( $page_id ) );
	}

	public function test_restore_of_unmarked_revision_leaves_every_meta_value_alone(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection();
		$field_id      = (int) get_post_meta( $collection_id, 'cortext_fields', true );
		$row_id        = $this->create_row( $collection_id );
		$icon          = '{"type":"wp","name":"star"}';
		update_post_meta( $row_id, DocumentIdentity::META_KEY, $icon );
		update_post_meta( $row_id, '_thumbnail_id', '222' );
		update_post_meta( $row_id, Relations::meta_key( $field_id ), 'live value' );

		// Written by a build that did not revision metadata yet, so its silence
		// about the icon, cover and field values means "unknown", not "empty".
		$revision_id = $this->create_legacy_revision(
			$row_id,
			array( 'post_title' => 'Old title' )
		);

		$response = $this->restore_revision( $row_id, $revision_id );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $data['contentOnly'] );
		$this->assertSame( 'Old title', get_post( $row_id )->post_title );
		$this->assertSame( $icon, get_post_meta( $row_id, DocumentIdentity::META_KEY, true ) );
		$this->assertSame( 222, (int) get_post_thumbnail_id( $row_id ) );
		$this->assertSame( 'live value', get_post_meta( $row_id, Relations::meta_key( $field_id ), true ) );
		$this->assertSame(
			array(
				'fields'    => 0,
				'relations' => 0,
				'schema'    => 0,
				'identity'  => 0,
				'formulas'  => 0,
			),
			$data['metaRestored']
		);
	}

	public function test_restore_of_marked_revision_is_not_content_only(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id     = $this->create_page();
		$revision_id = $this->create_revision( $page_id );

		$response = $this->restore_revision( $page_id, $revision_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['contentOnly'] );
	}

	public function test_restore_snapshot_keeps_current_icon_and_cover_reversible(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id      = $this->create_page();
		$current_icon = '{"type":"wp","name":"star","color":"red"}';
		$old_icon     = '{"type":"wp","name":"home","color":"blue"}';
		update_post_meta( $page_id, DocumentIdentity::META_KEY, $current_icon );
		update_post_meta( $page_id, '_thumbnail_id', '222' );

		$revision_id = $this->create_revision( $page_id );
		$this->add_revision_meta( $revision_id, DocumentIdentity::META_KEY, $old_icon );
		$this->add_revision_meta( $revision_id, '_thumbnail_id', '111' );

		$response    = $this->restore_revision( $page_id, $revision_id );
		$snapshot_id = (int) ( $response->get_data()['snapshot'] ?? 0 );

		$this->assertGreaterThan( 0, $snapshot_id );
		$this->assertSame( $current_icon, get_post_meta( $snapshot_id, DocumentIdentity::META_KEY, true ) );
		$this->assertSame( 222, (int) get_post_meta( $snapshot_id, '_thumbnail_id', true ) );
	}

	public function test_requires_edit_permission(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id     = $this->create_page();
		$revision_id = $this->create_revision( $page_id );

		wp_set_current_user( $this->create_user( 'subscriber' ) );
		$response = $this->restore_revision( $page_id, $revision_id );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_rejects_restore_when_another_user_holds_post_lock(): void {
		require_once ABSPATH . 'wp-admin/includes/post.php';

		$owner_id = $this->create_user( 'administrator' );
		wp_set_current_user( $owner_id );
		$page_id = $this->create_page( array( 'post_title' => 'Current title' ) );
		wp_set_post_lock( $page_id );

		$revision_id = $this->create_revision(
			$page_id,
			array( 'post_title' => 'Old title' )
		);

		wp_set_current_user( $this->create_user( 'administrator' ) );
		$response = $this->restore_revision( $page_id, $revision_id );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame(
			'cortext_revision_restore_locked_document',
			$response->get_data()['code']
		);
		$this->assertSame( 'Current title', get_post( $page_id )->post_title );
	}

	public function test_invalid_relation_revision_is_rejected_before_any_restore_writes(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$source_collection_id = $this->create_collection();
		$target_collection_id = $this->create_collection();
		$relation_id          = $this->create_field(
			'Relation',
			'relation',
			array(
				'related_collection_id'     => (string) $target_collection_id,
				'relation_reverse_field_id' => '999999',
			)
		);
		add_post_meta( $source_collection_id, 'cortext_fields', (string) $relation_id );

		$row_id    = $this->create_row( $source_collection_id );
		$target_id = $this->create_row( $target_collection_id );
		update_post_meta( $row_id, Relations::meta_key( $relation_id ), (string) $target_id );
		$current_icon = '{"type":"wp","name":"star"}';
		$old_icon     = '{"type":"wp","name":"home"}';
		update_post_meta( $row_id, DocumentIdentity::META_KEY, $current_icon );

		$revision_id = $this->create_revision(
			$row_id,
			array( 'post_title' => 'Old title' )
		);
		$this->add_revision_meta( $revision_id, Relations::meta_key( $relation_id ), (string) $target_id );
		$this->add_revision_meta( $revision_id, DocumentIdentity::META_KEY, $old_icon );
		$revision_count = count( wp_get_post_revisions( $row_id ) );

		$response = $this->restore_revision( $row_id, $revision_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_relation_reverse_missing', $response->get_data()['code'] );
		$this->assertSame( 'Page', get_post( $row_id )->post_title );
		$this->assertSame( $current_icon, get_post_meta( $row_id, DocumentIdentity::META_KEY, true ) );
		$this->assertSame(
			array( (string) $target_id ),
			get_post_meta( $row_id, Relations::meta_key( $relation_id ), false )
		);
		$this->assertCount( $revision_count, wp_get_post_revisions( $row_id ) );
	}

	public function test_restore_filters_deleted_fields_from_historical_collection_schema(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection();
		$existing_id   = (int) get_post_meta( $collection_id, 'cortext_fields', true );
		$deleted_id    = $this->create_field( 'Deleted field' );
		$revision_id   = $this->create_revision( $collection_id );
		$this->add_revision_meta( $revision_id, 'cortext_fields', (string) $existing_id );
		$this->add_revision_meta( $revision_id, 'cortext_fields', (string) $deleted_id );
		$this->add_revision_meta(
			$revision_id,
			'cortext_detail_layout',
			array(
				'fields' => array(
					array(
						'field'   => "field-{$existing_id}",
						'visible' => true,
					),
					array(
						'field'   => "field-{$deleted_id}",
						'visible' => true,
					),
				),
			)
		);
		wp_delete_post( $deleted_id, true );

		$response = $this->restore_revision( $collection_id, $revision_id );
		$layout   = get_post_meta( $collection_id, 'cortext_detail_layout', true );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( (string) $existing_id ),
			get_post_meta( $collection_id, 'cortext_fields', false )
		);
		$this->assertSame( "field-{$existing_id}", $layout['fields'][0]['field'] );
		$this->assertCount( 1, $layout['fields'] );
	}

	public function test_restore_keeps_collection_schema_when_revision_carries_none(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection();
		$field_id      = (int) get_post_meta( $collection_id, 'cortext_fields', true );
		$revision_id   = $this->create_revision(
			$collection_id,
			array( 'post_title' => 'Old title' )
		);

		$response = $this->restore_revision( $collection_id, $revision_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Old title', get_post( $collection_id )->post_title );
		// Revisions older than the revisioned-meta registration hold no schema.
		// Restoring one must not blank the collection's live field list.
		$this->assertSame(
			array( (string) $field_id ),
			get_post_meta( $collection_id, 'cortext_fields', false )
		);
		$this->assertSame( 0, $response->get_data()['metaRestored']['schema'] );
	}

	public function test_restore_validates_historical_layout_against_live_schema(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection();
		$existing_id   = (int) get_post_meta( $collection_id, 'cortext_fields', true );
		$foreign_id    = $this->create_field( 'Field from another collection' );
		$revision_id   = $this->create_revision( $collection_id );
		$this->add_revision_meta(
			$revision_id,
			'cortext_detail_layout',
			array(
				'fields' => array(
					array(
						'field'   => "field-{$existing_id}",
						'visible' => true,
					),
					array(
						'field'   => "field-{$foreign_id}",
						'visible' => true,
					),
				),
			)
		);

		$response = $this->restore_revision( $collection_id, $revision_id );
		$layout   = get_post_meta( $collection_id, 'cortext_detail_layout', true );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( "field-{$existing_id}", $layout['fields'][0]['field'] );
		$this->assertCount( 1, $layout['fields'] );
	}

	public function test_restore_recomputes_formula_instead_of_replaying_stored_output(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection();
		$number_id     = $this->create_field( 'Amount', 'number' );
		$formula_id    = $this->create_field(
			'Doubled',
			'formula',
			array( 'expression' => "prop(\"Amount\") * 2" )
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $number_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $formula_id );

		$row_id = $this->create_row( $collection_id );
		update_post_meta( $row_id, Relations::meta_key( $number_id ), '10' );
		update_post_meta( $row_id, Relations::meta_key( $formula_id ), '20' );

		$revision_id = $this->create_revision( $row_id );
		$this->add_revision_meta( $revision_id, Relations::meta_key( $number_id ), '4' );
		// Stale materialised output: it does not match the restored input.
		$this->add_revision_meta( $revision_id, Relations::meta_key( $formula_id ), '999' );

		$response = $this->restore_revision( $row_id, $revision_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '4', get_post_meta( $row_id, Relations::meta_key( $number_id ), true ) );
		$this->assertNotSame(
			'999',
			get_post_meta( $row_id, Relations::meta_key( $formula_id ), true ),
			'A revision must never replay a formula value verbatim.'
		);
		// Name + Amount are authored; the formula is derived and excluded.
		$this->assertSame( 2, $response->get_data()['metaRestored']['fields'] );
	}

	public function test_restore_uses_cached_meta_when_snapshot_prunes_selected_revision(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id  = $this->create_page( array( 'post_title' => 'Current title' ) );
		$old_icon = '{"type":"wp","name":"home"}';
		update_post_meta( $page_id, DocumentIdentity::META_KEY, '{"type":"wp","name":"star"}' );
		$revision_id = $this->create_revision(
			$page_id,
			array( 'post_title' => 'Old title' )
		);
		$this->add_revision_meta( $revision_id, DocumentIdentity::META_KEY, $old_icon );

		$prune_selected = static function () use ( $revision_id ): void {
			if ( get_post( $revision_id ) instanceof \WP_Post ) {
				wp_delete_post_revision( $revision_id );
			}
		};
		add_action( '_wp_put_post_revision', $prune_selected );
		try {
			$response = $this->restore_revision( $page_id, $revision_id );
		} finally {
			remove_action( '_wp_put_post_revision', $prune_selected );
		}

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( get_post( $revision_id ) );
		$this->assertSame( 'Old title', get_post( $page_id )->post_title );
		$this->assertSame( $old_icon, get_post_meta( $page_id, DocumentIdentity::META_KEY, true ) );
	}

	public function test_restores_fields_from_every_trait_on_multi_trait_row(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$first_collection_id  = $this->create_collection();
		$second_collection_id = $this->create_collection();
		$first_field_id       = (int) get_post_meta( $first_collection_id, 'cortext_fields', true );
		$second_field_id      = (int) get_post_meta( $second_collection_id, 'cortext_fields', true );
		$row_id               = $this->create_row( $first_collection_id );
		$second_term_id       = TraitTaxonomy::term_id_for_trait( $second_collection_id );
		wp_set_object_terms( $row_id, array( $second_term_id ), TraitTaxonomy::TAXONOMY, true );

		update_post_meta( $row_id, Relations::meta_key( $first_field_id ), 'new first' );
		update_post_meta( $row_id, Relations::meta_key( $second_field_id ), 'new second' );
		$revision_id = $this->create_revision( $row_id );
		$this->add_revision_meta( $revision_id, Relations::meta_key( $first_field_id ), 'old first' );
		$this->add_revision_meta( $revision_id, Relations::meta_key( $second_field_id ), 'old second' );

		$response = $this->restore_revision( $row_id, $revision_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'old first', get_post_meta( $row_id, Relations::meta_key( $first_field_id ), true ) );
		$this->assertSame( 'old second', get_post_meta( $row_id, Relations::meta_key( $second_field_id ), true ) );
		$this->assertSame( 2, $response->get_data()['metaRestored']['fields'] );
	}

	public function test_rejects_restore_for_trashed_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id     = $this->create_page();
		$revision_id = $this->create_revision(
			$page_id,
			array( 'post_title' => 'Old title' )
		);

		wp_update_post(
			array(
				'ID'          => $page_id,
				'post_status' => 'trash',
			)
		);

		$response = $this->restore_revision( $page_id, $revision_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_revision_restore_trashed_document',
			$response->get_data()['code']
		);
	}

	public function test_rejects_revision_from_another_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$first_id    = $this->create_page();
		$second_id   = $this->create_page();
		$revision_id = $this->create_revision( $second_id );

		$response = $this->restore_revision( $first_id, $revision_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_revision_not_for_document', $response->get_data()['code'] );
	}

	private function restore_revision( int $post_id, int $revision_id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $post_id . '/restore-revision' );
		$request->set_param( 'revision_id', $revision_id );
		return rest_do_request( $request );
	}

	private function create_user( string $role ): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_', false ),
				'user_pass'  => 'password',
				'role'       => $role,
			)
		);
	}

	/**
	 * Creates a document test page.
	 *
	 * @param array<string,mixed> $args Post overrides.
	 */
	private function create_page( array $args = array() ): int {
		$id = (int) wp_insert_post(
			array_merge(
				array(
					'post_type'    => Document::POST_TYPE,
					'post_status'  => 'private',
					'post_title'   => 'Page',
					'post_content' => '<!-- wp:paragraph --><p>Current</p><!-- /wp:paragraph -->',
				),
				$args
			)
		);
		$this->assertGreaterThan( 0, $id );
		return $id;
	}

	private function create_collection(): int {
		$id = $this->create_page();

		$field_id = $this->create_field( 'Name' );
		add_post_meta( $id, 'cortext_fields', (string) $field_id );

		return $id;
	}

	/**
	 * Creates a field post.
	 *
	 * @param string               $title Field title.
	 * @param string               $type  Field type.
	 * @param array<string,string> $meta Extra field metadata.
	 */
	private function create_field( string $title, string $type = 'text', array $meta = array() ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array_merge( array( 'type' => $type ), $meta ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		return $field_id;
	}

	private function create_row( int $collection_id ): int {
		$id = $this->create_page();

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

		return $id;
	}

	/**
	 * Adds metadata to a revision post.
	 *
	 * @param int    $revision_id Revision ID.
	 * @param string $key         Meta key.
	 * @param mixed  $value       Meta value.
	 */
	private function add_revision_meta( int $revision_id, string $key, $value ): void {
		add_metadata( 'post', $revision_id, $key, $value );
	}

	/**
	 * Creates a revision post for a document, stamped as carrying metadata the
	 * way `wp_save_post_revision()` would.
	 *
	 * @param int                  $parent_id Document ID.
	 * @param array<string,string> $args Revision post overrides.
	 */
	private function create_revision( int $parent_id, array $args = array() ): int {
		$id = $this->create_legacy_revision( $parent_id, $args );
		update_metadata( 'post', $id, RevisionMetaFormat::META_KEY, RevisionMetaFormat::VERSION );
		return $id;
	}

	/**
	 * Creates a revision from before Cortext revisioned metadata: no marker, and
	 * therefore no knowledge of the icon, cover, schema or field values.
	 *
	 * @param int                  $parent_id Document ID.
	 * @param array<string,string> $args Revision post overrides.
	 */
	private function create_legacy_revision( int $parent_id, array $args = array() ): int {
		$id = (int) wp_insert_post(
			array_merge(
				array(
					'post_type'    => 'revision',
					'post_status'  => 'inherit',
					'post_parent'  => $parent_id,
					'post_title'   => 'Revision title',
					'post_content' => '<!-- wp:paragraph --><p>Revision</p><!-- /wp:paragraph -->',
				),
				$args
			)
		);
		$this->assertGreaterThan( 0, $id );
		return $id;
	}
}
