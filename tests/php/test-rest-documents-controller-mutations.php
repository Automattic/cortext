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
use Cortext\PostType\DocumentFreeze;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\DocumentWriteGuard;
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

		( new DocumentWriteGuard() )->register();
		( new DocumentFreeze() )->register();

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
		$this->assertArrayHasKey( '/cortext/v1/documents/empty-trash', $routes );
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
		$this->assertSame( array( $child_id ), $data['published'] );
		$this->assertSame( 'private', get_post_status( $parent_id ) );
		$this->assertSame( 'publish', get_post_status( $child_id ) );
		$this->assertSame( 'private', $data['post']['status'] );
	}

	public function test_unarchive_lists_a_published_root_with_its_published_descendants(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		$draft_id  = $this->create_page(
			array(
				'post_parent' => $parent_id,
				'post_status' => 'draft',
			)
		);
		$this->archive( $parent_id );

		$data = $this->unarchive( $parent_id )->get_data();

		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id, $draft_id ), $data['restored'] );
		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id ), $data['published'] );
	}

	public function test_unarchive_lists_nothing_published_when_no_restored_document_is_public(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_full_page_collection( 'private-rows' );
		$row_id        = $this->create_row( $collection_id );
		$this->archive( $collection_id );

		$data = $this->unarchive( $collection_id )->get_data();

		$this->assertEqualsCanonicalizing( array( $collection_id, $row_id ), $data['restored'] );
		$this->assertSame( array(), $data['published'] );
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

	public function test_core_rest_rejects_writes_to_trashed_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$post_id = $this->create_page(
			array(
				'post_title'   => 'Original title',
				'post_content' => 'Original content',
			)
		);
		$icon    = '{"type":"emoji","value":"A"}';
		update_post_meta( $post_id, DocumentIdentity::META_KEY, $icon );
		wp_trash_post( $post_id );

		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$request->set_param( 'title', 'Changed title' );
		$request->set_param( 'content', 'Changed content' );
		$request->set_param(
			'meta',
			array( DocumentIdentity::META_KEY => '{"type":"emoji","value":"B"}' )
		);
		$autosave = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $post_id . '/autosaves' );
		$autosave->set_param( 'content', 'Autosaved content' );

		foreach ( array( rest_do_request( $request ), rest_do_request( $autosave ) ) as $response ) {
			$this->assertSame( 409, $response->get_status() );
			$this->assertSame( 'cortext_document_in_trash', $response->get_data()['code'] );
		}
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $post_id ) );
		$this->assertSame( 'Original title', get_post( $post_id )->post_title );
		$this->assertSame( 'Original content', get_post( $post_id )->post_content );
		$this->assertSame( $icon, get_post_meta( $post_id, DocumentIdentity::META_KEY, true ) );

		$this->assertSame( 200, $this->restore( $post_id )->get_status() );
		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$request->set_param( 'title', 'Edited after restore' );

		$this->assertSame( 200, rest_do_request( $request )->get_status() );
		$this->assertSame( 'Edited after restore', get_post( $post_id )->post_title );
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

		$this->assertSame( 409, $response->get_status() );
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

	public function test_restore_lists_the_restored_documents_that_are_published_again(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page( array( 'post_status' => 'private' ) );
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		$draft_id  = $this->create_page(
			array(
				'post_parent' => $parent_id,
				'post_status' => 'draft',
			)
		);
		wp_trash_post( $parent_id );

		$data = $this->restore( $parent_id )->get_data();

		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id, $draft_id ), $data['restored'] );
		$this->assertSame( array( $child_id ), $data['published'] );
	}

	public function test_restore_lists_nothing_published_when_documents_return_to_archived(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		$this->archive( $parent_id );
		wp_trash_post( $parent_id );

		$data = $this->restore( $parent_id )->get_data();

		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $parent_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $child_id ) );
		$this->assertSame( array(), $data['published'] );
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

	public function test_restore_response_includes_shared_row_revived_by_another_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_a = $this->create_full_page_collection( 'shared-a' );
		$collection_b = $this->create_full_page_collection( 'shared-b' );
		$row_id       = $this->create_row( $collection_a );
		$term_id      = TraitTaxonomy::term_id_for_trait( $collection_b );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, true );

		wp_trash_post( $collection_a );
		wp_trash_post( $collection_b );
		$this->assertSame( 'trash', get_post_status( $row_id ) );

		$response = $this->restore( $collection_a );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNotSame( 'trash', get_post_status( $row_id ) );
		$this->assertContains( $collection_a, $response->get_data()['restored'] );
		$this->assertContains(
			$row_id,
			$response->get_data()['restored'],
			'The response must report a shared row revived through this collection even when another collection owned its trash marker.'
		);
	}

	public function test_restore_response_includes_shared_row_archived_with_another_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_a = $this->create_full_page_collection( 'cross-restore-a' );
		$collection_b = $this->create_full_page_collection( 'cross-restore-b' );
		$row_id       = $this->create_row( $collection_a );
		wp_set_object_terms( $row_id, array( TraitTaxonomy::term_id_for_trait( $collection_b ) ), TraitTaxonomy::TAXONOMY, true );

		wp_trash_post( $collection_a );
		$this->assertSame( 200, $this->archive( $collection_b )->get_status() );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $row_id ) );

		$response = $this->restore( $collection_a );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'private', get_post_status( $row_id ) );
		$this->assertContains( $row_id, $response->get_data()['restored'] );
	}

	public function test_unarchive_revives_shared_row_left_in_trash_by_a_deleted_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_a = $this->create_full_page_collection( 'cross-unarchive-a' );
		$collection_b = $this->create_full_page_collection( 'cross-unarchive-b' );
		$row_id       = $this->create_row( $collection_a );
		wp_set_object_terms( $row_id, array( TraitTaxonomy::term_id_for_trait( $collection_b ) ), TraitTaxonomy::TAXONOMY, true );

		$this->assertSame( 200, $this->archive( $collection_b )->get_status() );
		wp_trash_post( $collection_a );
		$this->assertSame( 200, $this->permanent_delete( $collection_a )->get_status() );
		$this->assertSame( 'trash', get_post_status( $row_id ), 'The row is kept for its archived collection.' );

		$response = $this->unarchive( $collection_b );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'private', get_post_status( $row_id ) );
		$this->assertContains( $row_id, $response->get_data()['restored'] );
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

	public function test_trash_listing_reports_when_and_by_whom_each_document_was_trashed(): void {
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		wp_update_user(
			array(
				'ID'           => $user_id,
				'display_name' => 'Ada',
			)
		);

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		wp_trash_post( $parent_id );

		$trashed_at = (int) get_post_meta( $parent_id, '_wp_trash_meta_time', true );
		$by_id      = array_column( $this->listing( 'trash' ), null, 'id' );

		foreach ( array( $parent_id, $child_id ) as $id ) {
			$this->assertSame(
				array(
					'id'   => $user_id,
					'name' => 'Ada',
				),
				$by_id[ $id ]['trashed_by'],
				'Cascaded children record the same user as their root.'
			);
		}
		$this->assertSame( gmdate( 'c', $trashed_at ), $by_id[ $parent_id ]['trashed_at'] );
		// Core's `wp_scheduled_delete` cutoff is `time() - EMPTY_TRASH_DAYS days`.
		$this->assertSame(
			gmdate( 'c', $trashed_at + EMPTY_TRASH_DAYS * DAY_IN_SECONDS ),
			$by_id[ $parent_id ]['purge_at']
		);
	}

	public function test_trash_listing_has_no_user_for_documents_trashed_without_one(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		wp_trash_post( $page_id );
		delete_post_meta( $page_id, TrashCascade::TRASHED_BY_USER_META );

		$by_id = array_column( $this->listing( 'trash' ), null, 'id' );

		$this->assertNull( $by_id[ $page_id ]['trashed_by'] );
	}

	public function test_restore_forgets_who_trashed_the_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		wp_trash_post( $parent_id );

		$this->restore( $parent_id );

		$this->assertSame( '', get_post_meta( $parent_id, TrashCascade::TRASHED_BY_USER_META, true ) );
		$this->assertSame( '', get_post_meta( $child_id, TrashCascade::TRASHED_BY_USER_META, true ) );
	}

	public function test_archived_listing_reports_when_and_by_whom_each_document_was_archived(): void {
		$user_id = $this->create_user( 'administrator' );
		wp_set_current_user( $user_id );
		wp_update_user(
			array(
				'ID'           => $user_id,
				'display_name' => 'Ada',
			)
		);

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		$this->archive( $parent_id );

		$archived_at = (int) get_post_meta( $parent_id, ArchiveCascade::TIME_META, true );
		$by_id       = array_column( $this->listing( Documents::STATUS_ARCHIVED ), null, 'id' );

		foreach ( array( $parent_id, $child_id ) as $id ) {
			$this->assertSame(
				array(
					'id'   => $user_id,
					'name' => 'Ada',
				),
				$by_id[ $id ]['archived_by'],
				'Cascaded children record the same user as their root.'
			);
		}
		$this->assertSame( gmdate( 'c', $archived_at ), $by_id[ $parent_id ]['archived_at'] );
		$this->assertArrayNotHasKey( 'purge_at', $by_id[ $parent_id ] );
	}

	public function test_archived_listing_has_no_user_for_documents_archived_without_one(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		$this->archive( $page_id );
		delete_post_meta( $page_id, ArchiveCascade::ARCHIVED_BY_USER_META );

		$by_id = array_column( $this->listing( Documents::STATUS_ARCHIVED ), null, 'id' );

		$this->assertArrayHasKey( 'archived_by', $by_id[ $page_id ] );
		$this->assertNull( $by_id[ $page_id ]['archived_by'] );
	}

	public function test_unarchive_forgets_who_archived_the_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id = $this->create_page();
		$child_id  = $this->create_page( array( 'post_parent' => $parent_id ) );
		$this->archive( $parent_id );

		$this->unarchive( $parent_id );

		$this->assertSame( '', get_post_meta( $parent_id, ArchiveCascade::ARCHIVED_BY_USER_META, true ) );
		$this->assertSame( '', get_post_meta( $child_id, ArchiveCascade::ARCHIVED_BY_USER_META, true ) );
	}

	public function test_empty_trash_deletes_every_trashed_document_and_leaves_active_ones(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_id     = $this->create_page();
		$child_id      = $this->create_page( array( 'post_parent' => $parent_id ) );
		$sibling_id    = $this->create_page();
		$collection_id = $this->create_full_page_collection( 'emptied' );
		$row_id        = $this->create_row( $collection_id );
		$lone_row_id   = $this->create_row( $collection_id );
		$active_id     = $this->create_page();

		// Trashed on its own before its collection, so it is a root with no
		// marker and the collection's delete removes it first.
		wp_trash_post( $lone_row_id );
		wp_trash_post( $sibling_id );
		wp_trash_post( $parent_id );
		wp_trash_post( $collection_id );

		$response = $this->empty_trash();

		$this->assertSame( 200, $response->get_status() );
		$deleted = $response->get_data()['deleted'];
		foreach ( array( $parent_id, $child_id, $sibling_id, $collection_id, $row_id, $lone_row_id ) as $id ) {
			$this->assertContains( $id, $deleted );
			$this->assertNull( get_post( $id ) );
		}
		$this->assertCount( 6, $deleted, 'Each deleted document is reported once.' );
		$this->assertSame( 'publish', get_post_status( $active_id ) );
	}

	public function test_empty_trash_skips_documents_the_user_cannot_delete(): void {
		$admin_id  = $this->create_user( 'administrator' );
		$author_id = $this->create_user( 'author' );

		$others_id = $this->create_page( array( 'post_author' => $admin_id ) );
		$own_id    = $this->create_page( array( 'post_author' => $author_id ) );
		wp_trash_post( $others_id );
		wp_trash_post( $own_id );

		wp_set_current_user( $author_id );
		$response = $this->empty_trash();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $own_id ), $response->get_data()['deleted'] );
		$this->assertSame( 'trash', get_post_status( $others_id ) );
	}

	public function test_empty_trash_deletes_own_documents_cascaded_under_someone_elses_root(): void {
		$editor_id = $this->create_user( 'editor' );
		$author_id = $this->create_user( 'author' );

		$editors_parent = $this->create_page( array( 'post_author' => $editor_id ) );
		$authors_child  = $this->create_page(
			array(
				'post_author' => $author_id,
				'post_parent' => $editors_parent,
			)
		);
		wp_set_current_user( $editor_id );
		wp_trash_post( $editors_parent );
		$this->assertSame( 'trash', get_post_status( $authors_child ) );

		// The author's trash listing shows the child as a root, because the
		// editor's page is not theirs, so emptying the trash must delete it.
		wp_set_current_user( $author_id );
		$response = $this->empty_trash();

		$this->assertSame( array( $authors_child ), $response->get_data()['deleted'] );
		$this->assertSame( 'trash', get_post_status( $editors_parent ) );
	}

	public function test_empty_trash_requires_delete_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$this->assertSame( 403, $this->empty_trash()->get_status() );
	}

	public function test_freeze_records_who_froze_the_document_and_unfreeze_clears_it(): void {
		$user_id = $this->create_user( 'editor' );
		wp_set_current_user( $user_id );
		$post_id = $this->create_page();

		$response = $this->freeze( $post_id );

		$this->assertSame( 200, $response->get_status() );
		$frozen = $response->get_data()['post'][ DocumentFreeze::REST_FIELD ];
		$this->assertSame( $user_id, $frozen['frozen_by']['id'] );
		$this->assertNotSame( '', $frozen['frozen_at'] );
		$this->assertTrue( DocumentFreeze::is_frozen( $post_id ) );

		$response = $this->unfreeze( $post_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['post'][ DocumentFreeze::REST_FIELD ] );
		$this->assertFalse( DocumentFreeze::is_frozen( $post_id ) );
		$this->assertSame( '', get_post_meta( $post_id, DocumentFreeze::FROZEN_BY_USER_META, true ) );
	}

	public function test_freeze_requires_permission_to_edit_the_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = $this->create_page();
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$this->assertSame( 403, $this->freeze( $post_id )->get_status() );
		$this->assertSame( 403, $this->unfreeze( $post_id )->get_status() );
		$this->assertFalse( DocumentFreeze::is_frozen( $post_id ) );
		$this->assertSame( 404, $this->freeze( 999999 )->get_status() );
	}

	public function test_freeze_rejects_archived_and_trashed_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$archived_id = $this->create_page();
		$this->archive( $archived_id );
		$trashed_id = $this->create_page();
		wp_trash_post( $trashed_id );

		$archived = $this->freeze( $archived_id );
		$trashed  = $this->freeze( $trashed_id );

		$this->assertSame( 409, $archived->get_status() );
		$this->assertSame( 'cortext_document_archived', $archived->get_data()['code'] );
		$this->assertSame( 409, $trashed->get_status() );
		$this->assertSame( 'cortext_document_in_trash', $trashed->get_data()['code'] );
		$this->assertFalse( DocumentFreeze::is_frozen( $archived_id ) );
		$this->assertFalse( DocumentFreeze::is_frozen( $trashed_id ) );
	}

	public function test_core_rest_rejects_writes_to_frozen_documents_until_unfrozen(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_full_page_collection( 'frozen-row-traits' );
		$post_id       = $this->create_page(
			array(
				'post_title'   => 'Original title',
				'post_content' => 'Original content',
			)
		);
		$icon          = '{"type":"emoji","value":"A"}';
		update_post_meta( $post_id, DocumentIdentity::META_KEY, $icon );
		$this->freeze( $post_id );

		$edit = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$edit->set_param( 'title', 'Changed title' );
		$edit->set_param( 'content', 'Changed content' );
		$meta = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$meta->set_param( 'meta', array( DocumentIdentity::META_KEY => '{"type":"emoji","value":"B"}' ) );
		$trait = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$trait->set_param( TraitTaxonomy::TAXONOMY, array( TraitTaxonomy::term_id_for_trait( $collection_id ) ) );
		$autosave = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $post_id . '/autosaves' );
		$autosave->set_param( 'content', 'Autosaved content' );

		foreach ( array( $edit, $meta, $trait, $autosave ) as $request ) {
			$response = rest_do_request( $request );
			$this->assertSame( 409, $response->get_status() );
			$this->assertSame( 'cortext_document_frozen', $response->get_data()['code'] );
		}
		$this->assertSame( 'Original title', get_post( $post_id )->post_title );
		$this->assertSame( 'Original content', get_post( $post_id )->post_content );
		$this->assertSame( $icon, get_post_meta( $post_id, DocumentIdentity::META_KEY, true ) );
		$this->assertSame(
			array(),
			wp_get_object_terms( $post_id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) )
		);

		$this->unfreeze( $post_id );
		$edit = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$edit->set_param( 'title', 'Edited after unlock' );

		$this->assertSame( 200, rest_do_request( $edit )->get_status() );
		$this->assertSame( 'Edited after unlock', get_post( $post_id )->post_title );
		$this->assertSame( 'Original content', get_post( $post_id )->post_content );
	}

	public function test_frozen_document_can_still_be_moved(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id = $this->create_page();
		$post_id   = $this->create_page();
		$this->freeze( $post_id );

		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $post_id );
		$request->set_param( 'parent', $parent_id );
		$request->set_param( 'menu_order', 3 );

		$this->assertSame( 200, rest_do_request( $request )->get_status() );
		$this->assertSame( $parent_id, (int) get_post( $post_id )->post_parent );
		$this->assertSame( 3, (int) get_post( $post_id )->menu_order );
		$this->assertTrue( DocumentFreeze::is_frozen( $post_id ) );
	}

	public function test_archive_trash_and_restore_keep_a_document_frozen_and_published(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = $this->create_page( array( 'post_status' => 'publish' ) );
		$this->freeze( $post_id );
		$this->assertSame( 'publish', get_post_status( $post_id ) );

		$this->assertSame( 200, $this->archive( $post_id )->get_status() );
		$this->assertSame( 200, $this->unarchive( $post_id )->get_status() );

		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertTrue( DocumentFreeze::is_frozen( $post_id ) );

		$trash = new WP_REST_Request( 'DELETE', '/wp/v2/crtxt_documents/' . $post_id );
		$this->assertSame( 200, rest_do_request( $trash )->get_status() );
		$this->assertSame( 200, $this->restore( $post_id )->get_status() );

		$this->assertTrue( DocumentFreeze::is_frozen( $post_id ) );
	}

	public function test_rows_in_a_frozen_collection_stay_editable(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_full_page_collection( 'frozen-collection' );
		$this->freeze( $collection_id );
		$collection    = get_post( $collection_id );

		$create = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$create->set_param( 'title', 'New row' );
		$create->set_param( 'status', 'publish' );
		$create->set_param( TraitTaxonomy::TAXONOMY, array( TraitTaxonomy::term_id_for_trait( $collection_id ) ) );
		$created = rest_do_request( $create );
		$this->assertSame( 201, $created->get_status() );
		$row_id = (int) $created->get_data()['id'];

		$edit = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $row_id );
		$edit->set_param( 'title', 'Edited row' );
		$this->assertSame( 200, rest_do_request( $edit )->get_status() );

		$leave = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $row_id );
		$leave->set_param( TraitTaxonomy::TAXONOMY, array() );
		$this->assertSame( 200, rest_do_request( $leave )->get_status() );
		$this->assertSame(
			array(),
			wp_get_object_terms( $row_id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) )
		);

		$trash = new WP_REST_Request( 'DELETE', '/wp/v2/crtxt_documents/' . $row_id );
		$this->assertSame( 200, rest_do_request( $trash )->get_status() );

		$rename = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $collection_id );
		$rename->set_param( 'title', 'Renamed collection' );
		$this->assertSame( 409, rest_do_request( $rename )->get_status() );
		$this->assertSame( $collection->post_title, get_post( $collection_id )->post_title );
		$this->assertSame( $collection->post_modified_gmt, get_post( $collection_id )->post_modified_gmt );
	}

	public function test_duplicating_a_frozen_document_makes_an_unlocked_copy(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = $this->create_page();
		$this->freeze( $post_id );

		$request  = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $post_id . '/duplicate' );
		$response = rest_do_request( $request );

		$this->assertSame( 201, $response->get_status() );
		$copy_id = (int) $response->get_data()['id'];
		$this->assertGreaterThan( 0, $copy_id );
		$this->assertFalse( DocumentFreeze::is_frozen( $copy_id ) );
	}

	private function freeze( int $id ) {
		return rest_do_request( new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $id . '/freeze' ) );
	}

	private function unfreeze( int $id ) {
		return rest_do_request( new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $id . '/unfreeze' ) );
	}

	private function listing( string $status ): array {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/documents' );
		$request->set_param( 'status', $status );
		return rest_do_request( $request )->get_data()['documents'];
	}

	private function empty_trash() {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/empty-trash' );
		return rest_do_request( $request );
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
