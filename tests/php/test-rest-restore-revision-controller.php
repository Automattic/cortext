<?php
/**
 * Tests for Cortext\Rest\RestoreRevisionController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
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

	private function create_page(): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_status'  => 'private',
				'post_title'   => 'Page',
				'post_content' => '<!-- wp:paragraph --><p>Current</p><!-- /wp:paragraph -->',
			)
		);
		$this->assertGreaterThan( 0, $id );
		return $id;
	}

	private function create_collection(): int {
		$id = $this->create_page();

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Name',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $id, 'cortext_fields', (string) $field_id );

		return $id;
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
	 * Creates a revision post for a document.
	 *
	 * @param int                  $parent_id Document ID.
	 * @param array<string,string> $args Revision post overrides.
	 */
	private function create_revision( int $parent_id, array $args = array() ): int {
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
