<?php
/**
 * Tests for the trash mutation routes on Cortext\Rest\DocumentsController.
 *
 * Read tests (GET /cortext/v1/documents) live in
 * test-rest-documents-controller.php; this file owns restore and
 * permanent-delete because they need the trash cascade engine fixture.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Documents;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Rest\DocumentsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Documents_Controller_Mutations extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new DocumentIdentity() )->register();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_actions( 'transition_post_status' );
		remove_all_filters( 'wp_untrash_post_status' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$archive_cascade = new ArchiveCascade();
		$archive_cascade->register_status();
		$archive_cascade->register_meta();
		$archive_cascade->register();

		$trash_cascade = new TrashCascade();
		$trash_cascade->register();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentsController( null, $trash_cascade, $archive_cascade ) )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_routes_are_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/archive', $routes );
		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/unarchive', $routes );
		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/restore', $routes );
		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/permanent-delete', $routes );
	}

	public function test_archive_and_unarchive_return_affected_ids_and_updated_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page( array( 'post_status' => 'private' ) );
		$child_id  = $this->create_page(
			array(
				'post_parent' => $parent_id,
				'post_status' => 'publish',
			)
		);

		$response = $this->archive( $parent_id );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id ), $data['archived'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $parent_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $child_id ) );
		$this->assertSame( $parent_id, $data['post']['id'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, $data['post']['status'] );

		$response = $this->unarchive( $parent_id );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id ), $data['restored'] );
		$this->assertSame( 'private', get_post_status( $parent_id ) );
		$this->assertSame( 'publish', get_post_status( $child_id ) );
		$this->assertSame( 'private', $data['post']['status'] );
	}

	public function test_updating_status_through_core_rest_archives_document_tree(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		$request   = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $parent_id );
		$request->set_param( 'status', Documents::STATUS_ARCHIVED );

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( Documents::STATUS_ARCHIVED, $response->get_data()['status'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $child_id ) );

		$list = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$list->set_param( 'context', 'edit' );
		$list->set_param( 'status', Documents::STATUS_ARCHIVED );
		$listed_ids = array_column( rest_do_request( $list )->get_data(), 'id' );
		$this->assertContains( $parent_id, $listed_ids );
		$this->assertContains( $child_id, $listed_ids );
	}

	public function test_core_rest_rejects_writes_to_archived_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = $this->create_page(
			array(
				'post_title'   => 'Original title',
				'post_content' => 'Original content',
			)
		);
		$icon    = '{"type":"emoji","value":"A"}';
		update_post_meta( $post_id, DocumentIdentity::META_KEY, $icon );
		$this->archive( $post_id );
		$before = get_post( $post_id );

		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$request->set_param( 'title', 'Changed title' );
		$request->set_param( 'content', 'Changed content' );
		$request->set_param(
			'meta',
			array( DocumentIdentity::META_KEY => '{"type":"emoji","value":"B"}' )
		);

		$response = rest_do_request( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived', $response->get_data()['code'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $post_id ) );
		$this->assertSame( $before->post_title, get_post( $post_id )->post_title );
		$this->assertSame( $before->post_content, get_post( $post_id )->post_content );
		$this->assertSame( $icon, get_post_meta( $post_id, DocumentIdentity::META_KEY, true ) );
	}

	public function test_core_rest_rejects_stale_status_writes_to_archived_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = $this->create_page( array( 'post_title' => 'Keep this title' ) );
		$this->archive( $post_id );
		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$request->set_param( 'status', 'publish' );
		$request->set_param( 'title', 'Stale editor title' );

		$response = rest_do_request( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived', $response->get_data()['code'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $post_id ) );
		$this->assertSame( 'Keep this title', get_post( $post_id )->post_title );
		$this->assertSame( 'publish', get_post_meta( $post_id, ArchiveCascade::STATUS_META, true ) );
	}

	public function test_core_rest_requires_the_unarchive_endpoint_to_restore_status(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = $this->create_page( array( 'post_status' => 'private' ) );
		$this->archive( $post_id );
		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$request->set_param( 'status', 'private' );

		$response = rest_do_request( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $post_id ) );

		$response = $this->unarchive( $post_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'private', get_post_status( $post_id ) );
	}

	public function test_core_rest_rejects_autosaves_for_archived_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = $this->create_page( array( 'post_content' => 'Saved content' ) );
		$this->archive( $post_id );
		$before_revisions = get_posts(
			array(
				'post_type'      => 'revision',
				'post_status'    => 'inherit',
				'post_parent'    => $post_id,
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);
		$request          = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $post_id . '/autosaves' );
		$request->set_param( 'content', 'Unsaved stale content' );

		$response = rest_do_request( $request );

		$after_revisions = get_posts(
			array(
				'post_type'      => 'revision',
				'post_status'    => 'inherit',
				'post_parent'    => $post_id,
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);
		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived', $response->get_data()['code'] );
		$this->assertSame( 'Saved content', get_post( $post_id )->post_content );
		$this->assertSame( $before_revisions, $after_revisions );
	}

	public function test_core_rest_requires_trash_before_permanently_deleting_an_archived_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = $this->create_page();
		$this->archive( $post_id );

		$delete_request = new WP_REST_Request( 'DELETE', '/wp/v2/crtxt_documents/' . $post_id );
		$delete_request->set_param( 'force', true );
		$delete_response = rest_do_request( $delete_request );

		$this->assertSame( 400, $delete_response->get_status() );
		$this->assertSame( 'cortext_document_not_trashed', $delete_response->get_data()['code'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $post_id ) );
		$this->assertSame( 'publish', get_post_meta( $post_id, ArchiveCascade::STATUS_META, true ) );

		$trash_request  = new WP_REST_Request( 'DELETE', '/wp/v2/crtxt_documents/' . $post_id );
		$trash_response = rest_do_request( $trash_request );

		$this->assertSame( 200, $trash_response->get_status() );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $post_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_meta( $post_id, '_wp_trash_meta_status', true ) );

		$this->assertSame( 200, $this->permanent_delete( $post_id )->get_status() );
		$this->assertNull( get_post( $post_id ) );
	}

	public function test_core_rest_rejects_creating_active_documents_under_archived_parents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page();
		$this->archive( $parent_id );
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_param( 'title', 'Blocked child' );
		$request->set_param( 'status', 'publish' );
		$request->set_param( 'parent', $parent_id );

		$response = rest_do_request( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived_container', $response->get_data()['code'] );
		$this->assertSame( $parent_id, $response->get_data()['data']['container_id'] );
		$this->assertSame(
			array(),
			get_posts(
				array(
					'post_type'   => Document::POST_TYPE,
					'post_status' => 'any',
					'title'       => 'Blocked child',
					'fields'      => 'ids',
				)
			)
		);
	}

	public function test_core_rest_rejects_creating_active_rows_in_archived_collections(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$filler_term = wp_insert_term( 'Filler', TraitTaxonomy::TAXONOMY, array( 'slug' => 'filler' ) );
		$this->assertIsArray( $filler_term );
		$collection_id = $this->create_full_page_collection( 'archived-create-target' );
		$this->assertNotSame( $collection_id, TraitTaxonomy::term_id_for_trait( $collection_id ) );
		$this->archive( $collection_id );
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_param( 'title', 'Blocked row' );
		$request->set_param( 'status', 'publish' );
		$request->set_param( 'cortext_trait', $collection_id );

		$response = rest_do_request( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived_container', $response->get_data()['code'] );
		$this->assertSame( $collection_id, $response->get_data()['data']['container_id'] );
		$this->assertSame(
			array(),
			get_posts(
				array(
					'post_type'   => Document::POST_TYPE,
					'post_status' => 'any',
					'title'       => 'Blocked row',
					'fields'      => 'ids',
				)
			)
		);
	}

	public function test_core_rest_rejects_native_trait_terms_for_archived_collections(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$filler_term = wp_insert_term( 'Native filler', TraitTaxonomy::TAXONOMY, array( 'slug' => 'native-filler' ) );
		$this->assertIsArray( $filler_term );
		$collection_id = $this->create_full_page_collection( 'archived-native-trait-target' );
		$term_id       = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertNotSame( $collection_id, $term_id );
		$this->archive( $collection_id );
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_param( 'title', 'Blocked native row' );
		$request->set_param( 'status', 'publish' );
		$request->set_param( TraitTaxonomy::TAXONOMY, array( $term_id ) );

		$response = rest_do_request( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived_container', $response->get_data()['code'] );
		$this->assertSame( $collection_id, $response->get_data()['data']['container_id'] );
	}

	public function test_core_rest_lets_a_valid_trait_param_override_archived_native_terms(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$active_collection_id   = $this->create_full_page_collection( 'active-trait-winner' );
		$archived_collection_id = $this->create_full_page_collection( 'archived-native-loser' );
		$archived_term_id       = TraitTaxonomy::term_id_for_trait( $archived_collection_id );
		$this->archive( $archived_collection_id );
		// WordPress applies the native terms first. `assign_trait_from_request` then
		// replaces them with the collection from `cortext_trait`.
		add_action( 'rest_after_insert_' . Document::POST_TYPE, array( new Document(), 'assign_trait_from_request' ), 10, 3 );
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_param( 'title', 'Row despite stale native terms' );
		$request->set_param( 'status', 'publish' );
		$request->set_param( 'cortext_trait', $active_collection_id );
		$request->set_param( TraitTaxonomy::TAXONOMY, array( $archived_term_id ) );

		$response = rest_do_request( $request );
		remove_all_actions( 'rest_after_insert_' . Document::POST_TYPE );

		$this->assertSame( 201, $response->get_status() );
		$row_id = (int) $response->get_data()['id'];
		$this->assertSame(
			array( TraitTaxonomy::term_id_for_trait( $active_collection_id ) ),
			array_map( 'intval', wp_get_object_terms( $row_id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) ) )
		);
	}

	public function test_core_rest_rejects_moving_active_documents_into_archived_containers(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$collection_id = $this->create_full_page_collection( 'archived-update-target' );
		$page_id       = $this->create_page( array( 'post_title' => 'Original page' ) );
		$row_id        = $this->create_page( array( 'post_title' => 'Original row' ) );
		$this->archive( $parent_id );
		$this->archive( $collection_id );

		$parent_request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $page_id );
		$parent_request->set_param( 'parent', $parent_id );
		$parent_request->set_param( 'title', 'Changed page' );
		$parent_response = rest_do_request( $parent_request );

		$trait_request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $row_id );
		$trait_request->set_param( 'cortext_trait', $collection_id );
		$trait_request->set_param( 'title', 'Changed row' );
		$trait_response = rest_do_request( $trait_request );

		$this->assertSame( 409, $parent_response->get_status() );
		$this->assertSame( 409, $trait_response->get_status() );
		$this->assertSame( 0, (int) get_post( $page_id )->post_parent );
		$this->assertSame( 'Original page', get_post( $page_id )->post_title );
		$this->assertSame( 'Original row', get_post( $row_id )->post_title );
		$this->assertSame(
			array(),
			wp_get_object_terms( $row_id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) )
		);
	}

	public function test_core_rest_rejects_writes_to_active_documents_still_in_archived_containers(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$collection_id = $this->create_full_page_collection( 'archived-existing-container' );
		$this->archive( $parent_id );
		$this->archive( $collection_id );
		$child_id  = $this->create_page(
			array(
				'post_content' => 'Existing content',
				'post_parent'  => $parent_id,
				'post_title'   => 'Existing child',
			)
		);
		$row_id    = $this->create_row( $collection_id );
		$row_title = get_post( $row_id )->post_title;

		$child_request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $child_id );
		$child_request->set_param( 'title', 'Changed child' );
		$row_request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $row_id );
		$row_request->set_param( 'title', 'Changed row' );
		$autosave_request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $child_id . '/autosaves' );
		$autosave_request->set_param( 'content', 'Changed content' );

		$this->assertSame( 409, rest_do_request( $child_request )->get_status() );
		$this->assertSame( 409, rest_do_request( $row_request )->get_status() );
		$this->assertSame( 409, rest_do_request( $autosave_request )->get_status() );
		$this->assertSame( 'Existing child', get_post( $child_id )->post_title );
		$this->assertSame( 'Existing content', get_post( $child_id )->post_content );
		$this->assertSame( $row_title, get_post( $row_id )->post_title );
	}

	public function test_core_rest_allows_active_documents_to_leave_archived_containers_or_be_archived(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$collection_id = $this->create_full_page_collection( 'archived-leave-target' );
		$this->archive( $parent_id );
		$this->archive( $collection_id );
		$moved_id    = $this->create_page( array( 'post_parent' => $parent_id ) );
		$archived_id = $this->create_page( array( 'post_parent' => $parent_id ) );
		$row_id      = $this->create_row( $collection_id );

		$move_request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $moved_id );
		$move_request->set_param( 'parent', 0 );
		$archive_request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $archived_id );
		$archive_request->set_param( 'status', Documents::STATUS_ARCHIVED );
		$leave_collection_request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $row_id );
		$leave_collection_request->set_param( TraitTaxonomy::TAXONOMY, array() );

		$this->assertSame( 200, rest_do_request( $move_request )->get_status() );
		$this->assertSame( 200, rest_do_request( $archive_request )->get_status() );
		$this->assertSame( 200, rest_do_request( $leave_collection_request )->get_status() );
		$this->assertSame( 0, (int) get_post( $moved_id )->post_parent );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $archived_id ) );
		$this->assertSame(
			array(),
			wp_get_object_terms( $row_id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) )
		);
	}

	public function test_cascaded_documents_cannot_be_unarchived_while_their_container_is_archived(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		$this->archive( $parent_id );

		$response = $this->unarchive( $child_id );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived_container', $response->get_data()['code'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $child_id ) );
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $child_id, ArchiveCascade::PARENT_MARKER_META, true ) );
	}

	public function test_unarchive_rejects_descendants_that_belong_to_another_archived_container(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$collection_id = $this->create_full_page_collection( 'overlapping-unarchive' );
		$row_id        = $this->create_page( array( 'post_parent' => $parent_id ) );
		$term_id       = TraitTaxonomy::term_id_for_trait( $collection_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		$this->archive( $parent_id );
		$this->archive( $collection_id );

		$response = $this->unarchive( $parent_id );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived_container', $response->get_data()['code'] );
		$this->assertSame( $collection_id, $response->get_data()['data']['container_id'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $parent_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $row_id ) );
	}

	public function test_trashed_document_cannot_be_restored_under_an_archived_parent(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		wp_trash_post( $child_id );
		$this->archive( $parent_id );

		$response = $this->restore( $child_id );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived_container', $response->get_data()['code'] );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $child_id ) );
	}

	public function test_restore_rejects_descendants_that_belong_to_another_archived_container(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$collection_id = $this->create_full_page_collection( 'overlapping-restore' );
		$row_id        = $this->create_page( array( 'post_parent' => $parent_id ) );
		$term_id       = TraitTaxonomy::term_id_for_trait( $collection_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		wp_trash_post( $parent_id );
		$this->archive( $collection_id );

		$response = $this->restore( $parent_id );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_document_archived_container', $response->get_data()['code'] );
		$this->assertSame( $collection_id, $response->get_data()['data']['container_id'] );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $parent_id ) );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $row_id ) );
	}

	public function test_core_rest_archive_checks_every_page_in_the_cascade(): void {
		$author_id = $this->create_user( 'contributor' );
		$other_id  = $this->create_user( 'contributor' );
		$parent_id = $this->create_page(
			array(
				'post_author' => $author_id,
				'post_status' => 'draft',
			)
		);
		$child_id  = $this->create_page(
			array(
				'post_author' => $other_id,
				'post_parent' => $parent_id,
				'post_status' => 'draft',
			)
		);
		wp_set_current_user( $author_id );
		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $parent_id );
		$request->set_param( 'status', Documents::STATUS_ARCHIVED );

		$response = rest_do_request( $request );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'cortext_document_archive_forbidden', $response->get_data()['code'] );
		$this->assertSame( 'draft', get_post_status( $parent_id ) );
		$this->assertSame( 'draft', get_post_status( $child_id ) );
		$this->assertSame( '', (string) get_post_meta( $parent_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( '', (string) get_post_meta( $child_id, ArchiveCascade::PARENT_MARKER_META, true ) );
	}

	public function test_core_rest_rejects_archiving_a_trashed_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = $this->create_page();
		wp_trash_post( $post_id );
		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$request->set_param( 'status', Documents::STATUS_ARCHIVED );

		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_document_in_trash', $response->get_data()['code'] );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $post_id ) );
		$this->assertSame( '', (string) get_post_meta( $post_id, ArchiveCascade::STATUS_META, true ) );
	}

	public function test_archive_rejects_archived_and_trashed_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$archived_id = $this->create_page();
		$this->archive( $archived_id );
		$response = $this->archive( $archived_id );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_document_already_archived', $response->get_data()['code'] );

		$trashed_id = $this->create_page();
		wp_trash_post( $trashed_id );
		$response = $this->archive( $trashed_id );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_document_in_trash', $response->get_data()['code'] );
	}

	public function test_unarchive_rejects_document_that_is_not_archived(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->unarchive( $this->create_page() );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_document_not_archived', $response->get_data()['code'] );
	}

	public function test_archive_requires_edit_post_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->archive( $this->create_page() );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_archive_checks_every_page_in_the_cascade(): void {
		$author_id = $this->create_user( 'contributor' );
		$other_id  = $this->create_user( 'contributor' );
		$parent_id = $this->create_page(
			array(
				'post_author' => $author_id,
				'post_status' => 'draft',
			)
		);
		$child_id  = $this->create_page(
			array(
				'post_author' => $other_id,
				'post_parent' => $parent_id,
				'post_status' => 'draft',
			)
		);
		wp_set_current_user( $author_id );

		$response = $this->archive( $parent_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'draft', get_post_status( $parent_id ) );
		$this->assertSame( 'draft', get_post_status( $child_id ) );
		$this->assertSame( '', (string) get_post_meta( $child_id, ArchiveCascade::PARENT_MARKER_META, true ) );
	}

	public function test_archive_checks_every_row_in_the_cascade(): void {
		$author_id = $this->create_user( 'contributor' );
		$other_id  = $this->create_user( 'contributor' );
		wp_set_current_user( $author_id );
		$collection_id = $this->create_full_page_collection( 'mixed-owners' );
		$row_id        = $this->create_row( $collection_id );
		wp_update_post(
			array(
				'ID'          => $row_id,
				'post_author' => $other_id,
			)
		);

		$response = $this->archive( $collection_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'private', get_post_status( $collection_id ) );
		$this->assertSame( 'private', get_post_status( $row_id ) );
		$this->assertSame( '', (string) get_post_meta( $row_id, ArchiveCascade::COLLECTION_MARKER_META, true ) );
	}

	public function test_unarchive_checks_every_page_in_the_cascade(): void {
		$admin_id  = $this->create_user( 'administrator' );
		$author_id = $this->create_user( 'contributor' );
		$other_id  = $this->create_user( 'contributor' );
		$parent_id = $this->create_page(
			array(
				'post_author' => $author_id,
				'post_status' => 'draft',
			)
		);
		$child_id  = $this->create_page(
			array(
				'post_author' => $other_id,
				'post_parent' => $parent_id,
				'post_status' => 'draft',
			)
		);
		wp_set_current_user( $admin_id );
		$this->archive( $parent_id );
		wp_set_current_user( $author_id );

		$response = $this->unarchive( $parent_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $parent_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $child_id ) );
		$this->assertSame( 'draft', get_post_meta( $parent_id, ArchiveCascade::STATUS_META, true ) );
		$this->assertSame( (string) $parent_id, (string) get_post_meta( $child_id, ArchiveCascade::PARENT_MARKER_META, true ) );
	}

	public function test_unarchive_requires_publish_capability_for_private_documents(): void {
		$admin_id  = $this->create_user( 'administrator' );
		$author_id = $this->create_user( 'contributor' );
		$post_id   = $this->create_page(
			array(
				'post_author' => $author_id,
				'post_status' => 'private',
			)
		);
		wp_set_current_user( $admin_id );
		$this->archive( $post_id );
		wp_set_current_user( $author_id );

		$response = $this->unarchive( $post_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $post_id ) );
	}

	public function test_contributor_cannot_unarchive_or_force_delete_originally_published_document(): void {
		$admin_id  = $this->create_user( 'administrator' );
		$author_id = $this->create_user( 'contributor' );
		$post_id   = $this->create_page(
			array(
				'post_author' => $author_id,
				'post_status' => 'publish',
			)
		);
		wp_set_current_user( $admin_id );
		$this->archive( $post_id );
		wp_set_current_user( $author_id );

		$unarchive_response = $this->unarchive( $post_id );
		$delete_request     = new WP_REST_Request( 'DELETE', '/wp/v2/crtxt_documents/' . $post_id );
		$delete_request->set_param( 'force', true );
		$delete_response = rest_do_request( $delete_request );

		$this->assertSame( 403, $unarchive_response->get_status() );
		$this->assertSame( 403, $delete_response->get_status() );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $post_id ) );
	}

	public function test_restores_a_trashed_page_and_returns_its_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );
		$this->assertSame( 'trash', get_post_status( $page_id ) );

		$response = $this->restore( $page_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNotSame( 'trash', get_post_status( $page_id ) );

		$data = $response->get_data();
		$this->assertSame( array( $page_id ), $data['restored'] );
		// The freshly-untrashed post is included so the canvas can drop the
		// banner without a follow-up GET.
		$this->assertIsArray( $data['post'] );
		$this->assertSame( $page_id, $data['post']['id'] );
		$this->assertNotSame( 'trash', $data['post']['status'] );
	}

	public function test_returns_revived_descendants_in_restored_array(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$grandchild_id = $this->create_page( array( 'post_parent' => $child_id ) );

		wp_trash_post( $parent_id );

		$response = $this->restore( $parent_id );

		$this->assertSame( 200, $response->get_status() );
		$restored = $response->get_data()['restored'];
		$this->assertCount( 3, $restored );
		$this->assertContains( $parent_id, $restored );
		$this->assertContains( $child_id, $restored );
		$this->assertContains( $grandchild_id, $restored );
	}

	public function test_restore_omits_descendants_that_were_independently_trashed(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id  = $this->create_page();
		$sibling_id = $this->create_page();

		// Sibling lives in trash from its own delete, untagged.
		wp_trash_post( $sibling_id );
		wp_trash_post( $parent_id );

		$response = $this->restore( $parent_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $parent_id ), $response->get_data()['restored'] );
		$this->assertSame( 'trash', get_post_status( $sibling_id ), 'Independent trash should not be revived.' );
	}

	public function test_rejects_unknown_post_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->restore( 99999 );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_document_not_found', $response->get_data()['code'] );
	}

	public function test_rejects_non_document_post_type(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'A regular post',
			)
		);
		wp_trash_post( $post_id );

		$response = $this->restore( $post_id );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_document_not_found', $response->get_data()['code'] );
	}

	public function test_rejects_page_that_is_not_in_trash(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();

		$response = $this->restore( $page_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_document_not_trashed', $response->get_data()['code'] );
	}

	public function test_requires_delete_post_capability(): void {
		// Subscriber lacks delete_post on any post.
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );

		$response = $this->restore( $page_id );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_permanent_delete_removes_a_trashed_page(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );

		$response = $this->permanent_delete( $page_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $page_id ), $response->get_data()['deleted'] );
		$this->assertNull( get_post( $page_id ) );
	}

	public function test_permanent_delete_cascades_through_tagged_descendants(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$grandchild_id = $this->create_page( array( 'post_parent' => $child_id ) );

		wp_trash_post( $parent_id );

		$response = $this->permanent_delete( $parent_id );

		$this->assertSame( 200, $response->get_status() );
		$deleted = $response->get_data()['deleted'];
		$this->assertCount( 3, $deleted );
		$this->assertContains( $parent_id, $deleted );
		$this->assertContains( $child_id, $deleted );
		$this->assertContains( $grandchild_id, $deleted );

		// Parent is the last entry, so descendants are gone before WP's
		// hierarchical reparenting could fire on the parent's deletion.
		$this->assertSame( $parent_id, end( $deleted ) );

		$this->assertNull( get_post( $parent_id ) );
		$this->assertNull( get_post( $child_id ) );
		$this->assertNull( get_post( $grandchild_id ) );
	}

	public function test_permanent_delete_leaves_independently_trashed_siblings_alone(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id  = $this->create_page();
		$sibling_id = $this->create_page();

		wp_trash_post( $sibling_id );
		wp_trash_post( $parent_id );

		$this->permanent_delete( $parent_id );

		$this->assertSame( 'trash', get_post_status( $sibling_id ), 'Independently trashed sibling stays untouched.' );
	}

	public function test_permanent_delete_rejects_page_that_is_not_in_trash(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();

		$response = $this->permanent_delete( $page_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_document_not_trashed', $response->get_data()['code'] );
	}

	public function test_permanent_delete_requires_delete_post_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );

		$response = $this->permanent_delete( $page_id );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_permanent_delete_removes_a_trashed_row_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'trashrow' );
		$row_id        = $this->create_row( $collection_id );
		wp_trash_post( $row_id );

		$response = $this->permanent_delete( $row_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $row_id ), $response->get_data()['deleted'] );
		$this->assertNull( get_post( $row_id ) );
	}

	public function test_trash_response_lists_cascade_deleted_descendants(): void {
		// The sidebar uses this list to drop favorites without re-walking the
		// page tree. Without it, the client carries that knowledge.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$grandchild_id = $this->create_page( array( 'post_parent' => $child_id ) );

		$inline_collection_id = $this->create_full_page_collection( 'inline' );
		wp_update_post(
			array(
				'ID'          => $inline_collection_id,
				'post_parent' => $parent_id,
			)
		);

		$request  = new WP_REST_Request( 'DELETE', '/wp/v2/crtxt_documents/' . $parent_id );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertArrayHasKey( 'cascade_deleted', $data );
		$this->assertIsArray( $data['cascade_deleted'] );
		$this->assertContains( $child_id, $data['cascade_deleted'] );
		$this->assertContains( $grandchild_id, $data['cascade_deleted'] );
		$this->assertContains(
			$inline_collection_id,
			$data['cascade_deleted'],
			'Collections owned by the trashed page belong in the cascade response.'
		);
	}

	public function test_restores_a_trashed_full_page_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'restorable' );
		wp_trash_post( $collection_id );
		$this->assertSame( 'trash', get_post_status( $collection_id ) );

		$response = $this->restore( $collection_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNotSame( 'trash', get_post_status( $collection_id ) );
		$this->assertSame( array( $collection_id ), $response->get_data()['restored'] );
	}

	public function test_permanent_delete_removes_a_trashed_collection_and_its_rows(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'wipeable' );
		$row_id        = $this->create_row( $collection_id );
		wp_trash_post( $collection_id );

		// The cascade has to walk rows on permanent delete even if the trait
		// term lookup briefly fails.
		$response = $this->permanent_delete( $collection_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( get_post( $collection_id ) );
		$this->assertNull( get_post( $row_id ), 'Rows go with their collection on permanent delete.' );
	}

	public function test_permanent_delete_response_includes_cascaded_row_ids(): void {
		// Without this, the sidebar can't tell that an open row from the
		// deleted collection is gone and the canvas stays on a phantom URL.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'reported' );
		$row_id        = $this->create_row( $collection_id );
		wp_trash_post( $collection_id );

		$response = $this->permanent_delete( $collection_id );

		$this->assertSame( 200, $response->get_status() );
		$deleted = $response->get_data()['deleted'];
		$this->assertContains( $collection_id, $deleted );
		$this->assertContains(
			$row_id,
			$deleted,
			'The response must list rows deleted by the collection-to-row cascade so the sidebar can navigate away from them.'
		);
	}

	public function test_restore_skips_cascade_walk_for_flat_row_documents(): void {
		// A row that is just a `crtxt_document` with a trait term and no
		// nested documents should come back on its own.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'widgets' );
		$row_id        = $this->create_row( $collection_id );
		wp_trash_post( $row_id );

		$response = $this->restore( $row_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $row_id ), $response->get_data()['restored'] );
	}

	private function restore( int $id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $id . '/restore' );
		return rest_do_request( $request );
	}

	private function archive( int $id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $id . '/archive' );
		return rest_do_request( $request );
	}

	private function unarchive( int $id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $id . '/unarchive' );
		return rest_do_request( $request );
	}

	private function permanent_delete( int $id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $id . '/permanent-delete' );
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

	private function create_page( array $args = array() ): int {
		$defaults = array(
			'post_type'   => Document::POST_TYPE,
			'post_status' => 'publish',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		return (int) $id;
	}

	private function create_full_page_collection( string $slug ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . $slug,
				'post_name'   => $slug,
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Title',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( (int) $id, 'cortext_fields', (string) $field_id );

		return (int) $id;
	}

	private function create_row( int $collection_id ): int {
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
