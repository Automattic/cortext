<?php
/**
 * Tests for Cortext\Rest\DocumentsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Documents;
use Cortext\Formula\Compiler as FormulaCompiler;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentFreeze;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Relations;
use Cortext\Rest\DocumentsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Documents_Controller extends BaseTestCase {

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

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();
		$archive_cascade = new ArchiveCascade();
		$archive_cascade->register_status();
		$archive_cascade->register_meta();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentsController() )->register();
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
		$this->assertArrayHasKey( '/cortext/v1/documents', $routes );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->query();

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_returns_pages_and_rows_with_excerpts(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$page_id       = $this->create_page(
			array(
				'post_title'   => 'Welcome',
				'post_name'    => 'welcome',
				'post_content' => 'The quick brown fox.',
			)
		);
		$row_id        = $this->create_row( $collection_id, 'Launch plan' );

		$response = $this->query();

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertArrayHasKey( 'documents', $data );
		$this->assertArrayHasKey( 'total', $data );

		$by_id = array();
		foreach ( $data['documents'] as $document ) {
			$by_id[ $document['id'] ] = $document;
		}

		$this->assertArrayHasKey( $page_id, $by_id );
		$this->assertSame( 'Welcome', $by_id[ $page_id ]['title'] );
		$this->assertStringContainsString( 'quick brown fox', $by_id[ $page_id ]['excerpt'] );

		$this->assertArrayHasKey( $row_id, $by_id );
		$this->assertSame( 'Projects', $by_id[ $row_id ]['collection']['title'] );
	}

	public function test_matches_search(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$match     = $this->create_page( array( 'post_title' => 'Quarterly report' ) );
		$unrelated = $this->create_page( array( 'post_title' => 'Unrelated' ) );

		$response = $this->query( array( 'search' => 'quarterly' ) );

		$ids = array_column( $response->get_data()['documents'], 'id' );
		$this->assertContains( $match, $ids );
		$this->assertNotContains( $unrelated, $ids );
	}

	public function test_search_leaves_out_archived_and_trashed_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$live     = $this->create_page( array( 'post_title' => 'Roadmap live' ) );
		$archived = $this->create_page(
			array(
				'post_status' => Documents::STATUS_ARCHIVED,
				'post_title'  => 'Roadmap archived',
			)
		);
		$trashed  = $this->create_page( array( 'post_title' => 'Roadmap trashed' ) );
		wp_trash_post( $trashed );

		$ids = array_column( $this->query( array( 'search' => 'roadmap' ) )->get_data()['documents'], 'id' );

		$this->assertContains( $live, $ids );
		$this->assertNotContains( $archived, $ids );
		$this->assertNotContains( $trashed, $ids );
	}

	public function test_status_trash_lists_pages_and_rows_with_trash_metadata(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$collection_id = $this->create_collection( 'albums', 'Albums' );
		$page_id       = $this->create_page(
			array(
				'post_title'  => 'Trashed page',
				'post_parent' => 123,
				'meta_input'  => array(
					DocumentIdentity::META_KEY       => '{"type":"emoji","value":"P"}',
					TrashCascade::PARENT_MARKER_META => '99',
				),
			)
		);
		wp_trash_post( $page_id );

		$row_id = $this->create_row( $collection_id, 'Trashed album' );
		wp_trash_post( $row_id );

		$visible_page = $this->create_page( array( 'post_title' => 'Still here' ) );

		$response = $this->query( array( 'status' => 'trash' ) );

		$this->assertSame( 200, $response->get_status() );
		$by_id = array_column( $response->get_data()['documents'], null, 'id' );

		$this->assertArrayHasKey( $page_id, $by_id );
		$this->assertArrayHasKey( $row_id, $by_id );
		$this->assertArrayNotHasKey( $visible_page, $by_id );

		$page = $by_id[ $page_id ];
		$this->assertSame( 123, $page['parent'] );
		$this->assertSame( 99, $page['meta'][ TrashCascade::PARENT_MARKER_META ] );
		$this->assertSame( '{"type":"emoji","value":"P"}', $page['meta']['cortext_document_icon'] );

		$row = $by_id[ $row_id ];
		$this->assertSame( $collection_id, $row['collection']['id'] );
		$this->assertSame( 'Albums', $row['collection']['title'] );
	}

	public function test_status_trash_surfaces_parent_marker_on_nested_collections(): void {
		// Without this marker in the response, the sidebar can't tell which
		// collection was trashed by which owner page, so the entries would
		// render as roots instead of nesting under their owner page.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$owner_page = $this->create_page( array( 'post_title' => 'Owner' ) );
		$nested_id  = $this->create_collection( 'action-items', 'Action items' );
		// Sit the trashed collection underneath the owner page so the cascade
		// marker has a counterpart in the page tree.
		wp_update_post(
			array(
				'ID'          => $nested_id,
				'post_parent' => $owner_page,
			)
		);
		update_post_meta(
			$nested_id,
			TrashCascade::PARENT_MARKER_META,
			$owner_page
		);
		wp_trash_post( $nested_id );

		$response = $this->query( array( 'status' => 'trash' ) );

		$by_id = array_column( $response->get_data()['documents'], null, 'id' );
		$this->assertArrayHasKey( $nested_id, $by_id );
		$this->assertSame(
			$owner_page,
			$by_id[ $nested_id ]['meta'][ TrashCascade::PARENT_MARKER_META ]
		);
	}

	public function test_status_trash_excerpt_is_excluded(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page( array( 'post_title' => 'Trashed' ) );
		wp_trash_post( $page_id );

		$response = $this->query( array( 'status' => 'trash' ) );

		$by_id = array_column( $response->get_data()['documents'], null, 'id' );
		$this->assertArrayHasKey( $page_id, $by_id );
		// Trash lists carry trash metadata; excerpts are only for live
		// document lists.
		$this->assertArrayHasKey( 'meta', $by_id[ $page_id ] );
		$this->assertArrayNotHasKey( 'excerpt', $by_id[ $page_id ] );
	}

	public function test_archived_listing_is_unpaginated_and_includes_archive_metadata(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$root_id    = $this->create_page(
			array(
				'post_status' => Documents::STATUS_ARCHIVED,
				'post_title'  => 'Archived root',
			)
		);
		$child_id   = $this->create_page(
			array(
				'post_status' => Documents::STATUS_ARCHIVED,
				'post_parent' => $root_id,
				'post_title'  => 'Archived child',
				'meta_input'  => array(
					ArchiveCascade::PARENT_MARKER_META => $root_id,
				),
			)
		);
		$visible_id = $this->create_page( array( 'post_title' => 'Visible page' ) );

		$response = $this->query(
			array(
				'status'   => Documents::STATUS_ARCHIVED,
				'per_page' => 1,
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$data  = $response->get_data();
		$by_id = array_column( $data['documents'], null, 'id' );
		$this->assertSame( 2, $data['total'] );
		$this->assertCount( 2, $data['documents'], 'Archived listings ignore per_page.' );
		$this->assertArrayHasKey( $root_id, $by_id );
		$this->assertArrayHasKey( $child_id, $by_id );
		$this->assertArrayNotHasKey( $visible_id, $by_id );
		$this->assertSame( $root_id, $by_id[ $child_id ]['meta'][ ArchiveCascade::PARENT_MARKER_META ] );
		$this->assertArrayHasKey( ArchiveCascade::COLLECTION_MARKER_META, $by_id[ $child_id ]['meta'] );
		$this->assertArrayHasKey( 'cortext_defines_trait', $by_id[ $child_id ] );
		$this->assertArrayNotHasKey( 'excerpt', $by_id[ $child_id ] );

		$default_ids = array_column( $this->query()->get_data()['documents'], 'id' );
		$this->assertContains( $visible_id, $default_ids );
		$this->assertNotContains( $root_id, $default_ids );
		$this->assertNotContains( $child_id, $default_ids );
	}

	public function test_default_listing_excludes_trashed_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$live    = $this->create_page( array( 'post_title' => 'Live' ) );
		$trashed = $this->create_page( array( 'post_title' => 'Trashed' ) );
		wp_trash_post( $trashed );

		$ids = array_column( $this->query()->get_data()['documents'], 'id' );

		$this->assertContains( $live, $ids );
		$this->assertNotContains( $trashed, $ids );
	}

	public function test_traits_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/cortext/v1/documents/(?P<id>\d+)/traits', $routes );
	}

	public function test_put_traits_adds_membership_and_get_returns_all(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_a = $this->create_collection( 'projects', 'Projects' );
		$collection_b = $this->create_collection( 'people', 'People' );
		$row_id       = $this->create_row( $collection_a, 'Ada' );

		$put = new WP_REST_Request( 'PUT', '/cortext/v1/documents/' . $row_id . '/traits' );
		$put->set_param( 'collection_ids', array( $collection_a, $collection_b ) );
		$put_response = rest_do_request( $put );
		$this->assertSame( 200, $put_response->get_status() );

		$get          = new WP_REST_Request( 'GET', '/cortext/v1/documents/' . $row_id . '/traits' );
		$get_response = rest_do_request( $get );
		$this->assertSame( 200, $get_response->get_status() );

		$ids = array_map(
			static fn( array $collection ): int => $collection['id'],
			$get_response->get_data()['collections']
		);
		sort( $ids );
		$expected = array( $collection_a, $collection_b );
		sort( $expected );
		$this->assertSame( $expected, $ids );
	}

	public function test_put_traits_rejects_empty_set(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_a = $this->create_collection( 'projects', 'Projects' );
		$row_id       = $this->create_row( $collection_a, 'Ada' );

		$put = new WP_REST_Request( 'PUT', '/cortext/v1/documents/' . $row_id . '/traits' );
		$put->set_param( 'collection_ids', array() );
		$response = rest_do_request( $put );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_membership_empty', $response->get_data()['code'] );
	}

	public function test_put_traits_rejects_unknown_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_a = $this->create_collection( 'projects', 'Projects' );
		$row_id       = $this->create_row( $collection_a, 'Ada' );

		$put = new WP_REST_Request( 'PUT', '/cortext/v1/documents/' . $row_id . '/traits' );
		$put->set_param( 'collection_ids', array( $collection_a, 999999 ) );
		$response = rest_do_request( $put );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_trait_not_found', $response->get_data()['code'] );
	}

	public function test_put_traits_rejects_trashed_collection_without_mutating_memberships(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$active_collection  = $this->create_collection( 'projects', 'Projects' );
		$trashed_collection = $this->create_collection( 'archived', 'Archived' );
		$row_id             = $this->create_row( $active_collection, 'Ada' );
		wp_update_post(
			array(
				'ID'          => $trashed_collection,
				'post_status' => 'trash',
			)
		);

		$response = $this->request_traits(
			$row_id,
			array( $active_collection, $trashed_collection )
		);

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_trait_not_found', $response->get_data()['code'] );
		$this->assertSame(
			array( $active_collection ),
			( new \Cortext\Documents() )->membership_ids( $row_id )
		);
	}

	public function test_put_traits_retains_unchanged_trashed_membership_while_editing_active_ones(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$trashed_collection = $this->create_collection( 'archived-retained', 'Archived' );
		$first_active       = $this->create_collection( 'projects-retained', 'Projects' );
		$second_active      = $this->create_collection( 'people-retained', 'People' );
		$row_id             = $this->create_row( $trashed_collection, 'Ada' );
		( new \Cortext\Documents() )->set_memberships(
			$row_id,
			array( $trashed_collection, $first_active )
		);
		wp_update_post(
			array(
				'ID'          => $trashed_collection,
				'post_status' => 'trash',
			)
		);

		$add_response = $this->request_traits(
			$row_id,
			array( $trashed_collection, $first_active, $second_active )
		);
		$this->assertSame( 200, $add_response->get_status() );

		$remove_response = $this->request_traits(
			$row_id,
			array( $trashed_collection, $second_active )
		);
		$this->assertSame( 200, $remove_response->get_status() );

		$ids = ( new \Cortext\Documents() )->membership_ids( $row_id );
		sort( $ids );
		$expected = array( $trashed_collection, $second_active );
		sort( $expected );
		$this->assertSame( $expected, $ids );
	}

	public function test_put_traits_rejects_leaving_only_trashed_memberships(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$active_collection  = $this->create_collection( 'only-active', 'Active' );
		$trashed_collection = $this->create_collection( 'only-trashed', 'Archived' );
		$row_id             = $this->create_row( $active_collection, 'Ada' );
		$this->add_membership( $row_id, $trashed_collection );
		wp_update_post(
			array(
				'ID'          => $trashed_collection,
				'post_status' => 'trash',
			)
		);

		$response = $this->request_traits( $row_id, array( $trashed_collection ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_membership_empty', $response->get_data()['code'] );
		$actual = ( new \Cortext\Documents() )->membership_ids( $row_id );
		sort( $actual );
		$expected = array( $active_collection, $trashed_collection );
		sort( $expected );
		$this->assertSame( $expected, $actual );
	}

	public function test_put_traits_rejects_adding_an_archived_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$live_collection     = $this->create_collection( 'live', 'Live' );
		$archived_collection = $this->create_collection( 'archived', 'Archived' );
		$row_id              = $this->create_row( $live_collection, 'Ada' );
		$this->archive( $archived_collection );

		$response = $this->request_traits( $row_id, array( $live_collection, $archived_collection ) );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'cortext_membership_collection_archived', $response->get_data()['code'] );
		$this->assertSame( array( $live_collection ), ( new \Cortext\Documents() )->membership_ids( $row_id ) );
	}

	public function test_put_traits_rejects_leaving_only_archived_memberships(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$live_collection     = $this->create_collection( 'live', 'Live' );
		$archived_collection = $this->create_collection( 'archived', 'Archived' );
		$row_id              = $this->create_row( $live_collection, 'Ada' );
		$this->add_membership( $row_id, $archived_collection );
		$this->archive( $archived_collection );

		$response = $this->request_traits( $row_id, array( $archived_collection ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_membership_empty', $response->get_data()['code'] );
	}

	/**
	 * Archived and trashed rows are read-only, their traits included.
	 *
	 * @dataProvider retired_row_statuses
	 *
	 * @param string $status        Status the row is retired to.
	 * @param string $expected_code Error code the endpoint returns.
	 */
	public function test_put_traits_rejects_changes_on_a_retired_row( string $status, string $expected_code ): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_a = $this->create_collection( 'a', 'A' );
		$collection_b = $this->create_collection( 'b', 'B' );
		$row_id       = $this->create_row( $collection_a, 'Ada' );
		wp_update_post(
			array(
				'ID'          => $row_id,
				'post_status' => $status,
			)
		);

		$response = $this->request_traits( $row_id, array( $collection_a, $collection_b ) );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( $expected_code, $response->get_data()['code'] );
		$this->assertSame( array( $collection_a ), ( new \Cortext\Documents() )->membership_ids( $row_id ) );
	}

	public static function retired_row_statuses(): array {
		return array(
			'archived' => array( Documents::STATUS_ARCHIVED, 'cortext_document_archived' ),
			'trashed'  => array( 'trash', 'cortext_document_in_trash' ),
		);
	}

	public function test_put_traits_changes_collections_on_a_locked_row(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_a = $this->create_collection( 'locked-a', 'A' );
		$collection_b = $this->create_collection( 'locked-b', 'B' );
		$row_id       = $this->create_row( $collection_a, 'Ada' );
		DocumentFreeze::freeze( $row_id );

		$response = $this->request_traits( $row_id, array( $collection_a, $collection_b ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertEqualsCanonicalizing(
			array( $collection_a, $collection_b ),
			( new \Cortext\Documents() )->membership_ids( $row_id )
		);
	}

	public function test_get_traits_marks_trashed_memberships_inactive(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$active_collection  = $this->create_collection( 'projects-flag', 'Projects' );
		$trashed_collection = $this->create_collection( 'archived-flag', 'Archived' );
		$row_id             = $this->create_row( $active_collection, 'Ada' );
		$this->add_membership( $row_id, $trashed_collection );
		wp_update_post(
			array(
				'ID'          => $trashed_collection,
				'post_status' => 'trash',
			)
		);

		$response = rest_do_request(
			new WP_REST_Request( 'GET', '/cortext/v1/documents/' . $row_id . '/traits' )
		);

		$this->assertSame( 200, $response->get_status() );
		$active_by_id = array();
		foreach ( $response->get_data()['collections'] as $collection ) {
			$active_by_id[ (int) $collection['id'] ] = $collection['active'];
		}
		$this->assertTrue( $active_by_id[ $active_collection ] );
		$this->assertFalse( $active_by_id[ $trashed_collection ] );
	}

	public function test_put_traits_requires_permission_to_add_collection_membership(): void {
		$owner_id = $this->create_user( 'author' );
		wp_set_current_user( $owner_id );
		$protected_collection = $this->create_collection( 'protected', 'Protected' );

		$attacker_id = $this->create_user( 'author' );
		wp_set_current_user( $attacker_id );
		$own_collection = $this->create_collection( 'mine', 'Mine' );
		$row_id         = $this->create_row( $own_collection, 'Ada' );

		$response = $this->request_traits(
			$row_id,
			array( $own_collection, $protected_collection )
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'cortext_membership_collection_forbidden', $response->get_data()['code'] );
		$this->assertSame(
			array( $own_collection ),
			( new \Cortext\Documents() )->membership_ids( $row_id )
		);
	}

	public function test_put_traits_requires_permission_to_remove_collection_membership(): void {
		$owner_id = $this->create_user( 'author' );
		wp_set_current_user( $owner_id );
		$protected_collection = $this->create_collection( 'protected-remove', 'Protected' );

		$attacker_id = $this->create_user( 'author' );
		wp_set_current_user( $attacker_id );
		$own_collection = $this->create_collection( 'mine-remove', 'Mine' );
		$row_id         = $this->create_row( $own_collection, 'Ada' );
		$this->add_membership( $row_id, $protected_collection );

		$response = $this->request_traits( $row_id, array( $own_collection ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'cortext_membership_collection_forbidden', $response->get_data()['code'] );
		$this->assertContains(
			$protected_collection,
			( new \Cortext\Documents() )->membership_ids( $row_id )
		);
	}

	public function test_duplicate_requires_permission_for_every_collection_the_copy_joins(): void {
		$owner_id = $this->create_user( 'author' );
		wp_set_current_user( $owner_id );
		$protected_collection = $this->create_collection( 'protected-duplicate', 'Protected' );

		$attacker_id = $this->create_user( 'author' );
		wp_set_current_user( $attacker_id );
		$own_collection = $this->create_collection( 'mine-duplicate', 'Mine' );
		$row_id         = $this->create_row( $own_collection, 'Shared row' );
		$this->add_membership( $row_id, $protected_collection );

		$response = rest_do_request(
			new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $row_id . '/duplicate' )
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'cortext_duplicate_collection_forbidden', $response->get_data()['code'] );
	}

	public function test_duplicate_leaves_a_retired_collection_behind_without_needing_access(): void {
		$owner_id = $this->create_user( 'author' );
		wp_set_current_user( $owner_id );
		$protected_collection = $this->create_collection( 'protected-duplicate', 'Protected' );
		wp_trash_post( $protected_collection );

		wp_set_current_user( $this->create_user( 'author' ) );
		$own_collection = $this->create_collection( 'mine-duplicate', 'Mine' );
		$row_id         = $this->create_row( $own_collection, 'Shared row' );
		$this->add_membership( $row_id, $protected_collection );

		$response = rest_do_request(
			new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $row_id . '/duplicate' )
		);

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame(
			array( $own_collection ),
			( new \Cortext\Documents() )->membership_ids( (int) $response->get_data()['id'] )
		);
	}

	public function test_traits_endpoint_rejects_collection_target(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_a = $this->create_collection( 'projects', 'Projects' );

		$response = rest_do_request(
			new WP_REST_Request( 'GET', '/cortext/v1/documents/' . $collection_a . '/traits' )
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_membership_unsupported', $response->get_data()['code'] );
	}

	public function test_leaving_collection_detaches_relation_reverse_pointers_and_readd_restores(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$tasks   = $this->create_collection( 'tasks', 'Tasks' );
		$people  = $this->create_collection( 'people', 'People' );
		$source  = $this->attach_relation_field( $tasks, $people );
		$reverse = $this->attach_relation_field( $people, $tasks );
		update_post_meta( $source, 'relation_reverse_field_id', (string) $reverse );
		update_post_meta( $reverse, 'relation_reverse_field_id', (string) $source );

		// A row in both Tasks and People, linked to a person via the Tasks
		// relation field.
		$row = $this->create_row( $tasks, 'Ship it' );
		$this->add_membership( $row, $people );
		$person = $this->create_row( $people, 'Ada' );
		add_post_meta( $row, Relations::meta_key( $source ), (string) $person );
		add_post_meta( $person, Relations::meta_key( $reverse ), (string) $row );

		// Leave Tasks (keep People): the related person should stop pointing back.
		$this->put_traits( $row, array( $people ) );
		$this->assertSame(
			array(),
			get_post_meta( $person, Relations::meta_key( $reverse ), false ),
			'Leaving a collection detaches its relation reverse pointers from related rows.'
		);
		$this->assertSame(
			array( (string) $person ),
			get_post_meta( $row, Relations::meta_key( $source ), false ),
			'The row keeps its forward value so re-adding the collection can restore the link.'
		);
		// Re-add Tasks: the membership comes back and the row's forward value is
		// untouched, so the reconcile path can rebuild the reverse pointer and the
		// index from it (those rebuilds run through `sync_relation_value` /
		// `index_row_field`, covered by their own tests and exercised in the real
		// environment, where the relation target query resolves).
		$this->put_traits( $row, array( $people, $tasks ) );
		$this->assertContains(
			$tasks,
			( new \Cortext\Documents() )->membership_ids( $row ),
			'Re-adding restores the collection membership.'
		);
		$this->assertSame(
			array( (string) $person ),
			get_post_meta( $row, Relations::meta_key( $source ), false ),
			'Re-adding keeps the row forward value intact for the reverse/index rebuild.'
		);
		$this->assertSame(
			array( (string) $row ),
			get_post_meta( $person, Relations::meta_key( $reverse ), false ),
			'Re-adding restores the reverse pointer removed when the row left the collection.'
		);
	}

	public function test_readd_keeps_single_reverse_link_claimed_by_another_row(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$tasks   = $this->create_collection( 'tasks', 'Tasks' );
		$people  = $this->create_collection( 'people', 'People' );
		$source  = $this->attach_relation_field( $tasks, $people );
		$reverse = $this->attach_field(
			$people,
			'relation',
			array(
				'related_collection_id' => (string) $tasks,
				'relation_multiple'     => '0',
			)
		);
		update_post_meta( $source, 'relation_reverse_field_id', (string) $reverse );
		update_post_meta( $reverse, 'relation_reverse_field_id', (string) $source );

		$row = $this->create_row( $tasks, 'Ship it' );
		$this->add_membership( $row, $people );
		$claimed = $this->create_row( $people, 'Ada' );
		$free    = $this->create_row( $people, 'Grace' );
		add_post_meta( $row, Relations::meta_key( $source ), (string) $claimed );
		add_post_meta( $row, Relations::meta_key( $source ), (string) $free );
		add_post_meta( $claimed, Relations::meta_key( $reverse ), (string) $row );
		add_post_meta( $free, Relations::meta_key( $reverse ), (string) $row );

		$this->put_traits( $row, array( $people ) );

		// While the row is out of Tasks, another task takes Ada's only slot.
		$other = $this->create_row( $tasks, 'Write docs' );
		add_post_meta( $other, Relations::meta_key( $source ), (string) $claimed );
		update_post_meta( $claimed, Relations::meta_key( $reverse ), (string) $other );

		$this->put_traits( $row, array( $people, $tasks ) );

		$this->assertSame(
			array( (string) $other ),
			get_post_meta( $claimed, Relations::meta_key( $reverse ), false ),
			'The newer link keeps the single-valued reverse slot.'
		);
		$this->assertSame(
			array( (string) $claimed ),
			get_post_meta( $other, Relations::meta_key( $source ), false ),
			'Re-adding a membership does not rewrite another row\'s relation.'
		);
		$this->assertSame(
			array( (string) $free ),
			get_post_meta( $row, Relations::meta_key( $source ), false ),
			'The re-added row drops the target it lost and keeps the free one.'
		);
		$this->assertSame(
			array( (string) $row ),
			get_post_meta( $free, Relations::meta_key( $reverse ), false ),
			'A free single-valued reverse slot is restored.'
		);
	}

	public function test_put_traits_rejects_page_target(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection = $this->create_collection( 'projects', 'Projects' );
		$page       = $this->create_page();

		$response = $this->request_traits( $page, array( $collection ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_membership_unsupported', $response->get_data()['code'] );
		$this->assertSame( array(), ( new \Cortext\Documents() )->membership_ids( $page ) );
	}

	public function test_leaving_collection_keeps_relation_shared_by_retained_schema(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_a = $this->create_collection( 'shared-relation-a', 'Collection A' );
		$collection_b = $this->create_collection( 'shared-relation-b', 'Collection B' );
		$targets      = $this->create_collection( 'shared-relation-targets', 'Targets' );
		$source       = $this->attach_relation_field( $collection_a, $targets );
		$reverse      = $this->attach_relation_field( $targets, $collection_b );
		add_post_meta( $collection_b, 'cortext_fields', (string) $source );
		update_post_meta( $source, 'relation_reverse_field_id', (string) $reverse );
		update_post_meta( $reverse, 'relation_reverse_field_id', (string) $source );

		$row = $this->create_row( $collection_a, 'Shared row' );
		$this->add_membership( $row, $collection_b );
		$target = $this->create_row( $targets, 'Target row' );
		add_post_meta( $row, Relations::meta_key( $source ), (string) $target );
		add_post_meta( $target, Relations::meta_key( $reverse ), (string) $row );

		$response = $this->request_traits( $row, array( $collection_b ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( (string) $row ),
			get_post_meta( $target, Relations::meta_key( $reverse ), false ),
			'A field still present in a retained schema must keep its reverse pointer.'
		);
	}

	public function test_joining_collection_materializes_formula_from_retained_field_values(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$source_collection  = $this->create_collection( 'source', 'Source' );
		$formula_collection = $this->create_collection( 'invoices', 'Invoices' );
		$amount_field       = $this->attach_field( $formula_collection, 'number' );
		$formula_field      = $this->attach_field( $formula_collection, 'formula' );
		$compiled           = ( new FormulaCompiler() )->compile(
			'field("Number field") * 2',
			$formula_collection,
			$formula_field
		);
		update_post_meta( $formula_field, 'formula_result_type', $compiled['result_type'] );
		update_post_meta( $formula_field, 'formula_ast', wp_json_encode( $compiled['ast'] ) );
		update_post_meta( $formula_field, 'formula_dep_field_ids', wp_json_encode( $compiled['deps'] ) );
		update_post_meta( $formula_field, 'formula_resolved_refs', wp_json_encode( $compiled['refs'] ) );
		update_post_meta( $formula_field, 'formula_is_volatile', ! empty( $compiled['volatile'] ) ? '1' : '0' );

		$row_id = $this->create_row( $source_collection, 'Invoice A' );
		update_post_meta( $row_id, Relations::meta_key( $amount_field ), '10' );
		update_post_meta( $row_id, Relations::meta_key( $formula_field ), '-999' );

		$response = $this->request_traits(
			$row_id,
			array( $source_collection, $formula_collection )
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 20.0, (float) get_post_meta( $row_id, Relations::meta_key( $formula_field ), true ) );
	}

	private function put_traits( int $row_id, array $collection_ids ): void {
		$response = $this->request_traits( $row_id, $collection_ids );
		$this->assertSame( 200, $response->get_status() );
	}

	private function request_traits( int $row_id, array $collection_ids ): \WP_REST_Response {
		$request = new WP_REST_Request(
			'PUT',
			'/cortext/v1/documents/' . $row_id . '/traits'
		);
		$request->set_param( 'collection_ids', $collection_ids );
		return rest_do_request( $request );
	}

	private function attach_field( int $collection_id, string $type, array $meta = array() ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => ucfirst( $type ) . ' field',
				'meta_input'  => array_merge( array( 'type' => $type ), $meta ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		return $field_id;
	}

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

	private function archive( int $post_id ): void {
		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => Documents::STATUS_ARCHIVED,
			)
		);
	}

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

	private function query( array $params = array() ) {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/documents' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
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
			'post_status' => 'private',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		return (int) $id;
	}

	private function create_collection( string $slug, string $title = 'Collection' ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
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

	private function create_row( int $collection_id, string $title ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
		$this->assertGreaterThan( 0, $id );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

		return $id;
	}
}
