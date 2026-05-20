<?php
/**
 * Tests for Cortext\Documents.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Documents;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\Page;
use Cortext\PostType\PageTrashCascade;
use WorDBless\BaseTestCase;

final class Test_Documents extends BaseTestCase {

	use InMemoryPostsQuery;

	private Documents $documents;

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Page() )->register_post_type();
		( new DocumentIdentity() )->register();
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();

		$this->install_in_memory_posts_query();

		$this->documents = new Documents();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_get_document_post_types_includes_pages_rows_and_collections(): void {
		$this->create_collection( 'projects', 'Projects' );

		$post_types = $this->documents->get_document_post_types();

		$this->assertContains( Page::POST_TYPE, $post_types );
		$this->assertContains( 'crtxt_projects', $post_types );
		$this->assertContains(
			Collection::POST_TYPE,
			$post_types,
			'Collections share the document lifecycle as of the documents refactor.'
		);
		$this->assertNotContains( Field::POST_TYPE, $post_types );
	}

	public function test_find_returns_page_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$icon    = wp_json_encode(
			array(
				'type' => 'wp',
				'name' => 'home',
			)
		);
		$page_id = $this->create_page(
			array(
				'post_title' => 'About us',
				'post_name'  => 'about-us',
				'meta_input' => array(
					DocumentIdentity::META_KEY => $icon,
				),
			)
		);

		$document = $this->documents->find( $page_id );

		$this->assertNotNull( $document );
		$this->assertSame( Documents::KIND_PAGE, $document['kind'] );
		$this->assertSame( $page_id, $document['id'] );
		$this->assertSame( 'About us', $document['title'] );
		$this->assertSame( "page/about-us-{$page_id}", $document['path'] );
		$this->assertSame( $icon, $document['icon'] );
		$this->assertArrayNotHasKey( 'collection', $document );
		$this->assertArrayNotHasKey( 'excerpt', $document );
	}

	public function test_find_returns_row_document_with_collection_summary(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$row_id        = $this->create_row( 'crtxt_projects', 'Ship the thing' );

		$document = $this->documents->find( $row_id );

		$this->assertNotNull( $document );
		$this->assertSame( Documents::KIND_ROW, $document['kind'] );
		$this->assertSame( $row_id, $document['id'] );
		$this->assertSame( 'Ship the thing', $document['title'] );
		$this->assertSame( "ship-the-thing-{$row_id}", $document['path'] );
		$this->assertSame( $collection_id, $document['collection']['id'] );
		$this->assertSame( 'Projects', $document['collection']['title'] );
		$this->assertSame( "collection/projects-{$collection_id}", $document['collection']['path'] );
		$this->assertArrayNotHasKey( 'icon', $document );
	}

	public function test_find_returns_full_page_collection_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'tasks', 'Tasks' );

		$document = $this->documents->find( $collection_id );

		$this->assertNotNull( $document );
		$this->assertSame( Documents::KIND_COLLECTION, $document['kind'] );
		$this->assertSame( $collection_id, $document['id'] );
		$this->assertSame( 'Tasks', $document['title'] );
		$this->assertSame( "collection/tasks-{$collection_id}", $document['path'] );
		$this->assertArrayNotHasKey(
			'owner',
			$document,
			'Full-page collections do not carry an owner; they are reachable on their own.'
		);
	}

	public function test_find_returns_inline_collection_with_owner_page(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$owner_id  = $this->create_page(
			array(
				'post_title' => 'Quarterly review',
				'post_name'  => 'quarterly-review',
			)
		);
		$inline_id = (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Action items',
				'meta_input'  => array(
					'slug'                            => 'action-items',
					Collection::MODE_META_KEY         => Collection::MODE_INLINE,
					Collection::INLINE_OWNER_META_KEY => $owner_id,
				),
			)
		);

		$document = $this->documents->find( $inline_id );

		$this->assertNotNull( $document );
		$this->assertSame( Documents::KIND_COLLECTION, $document['kind'] );
		$this->assertSame( $inline_id, $document['id'] );
		$this->assertSame( 'Action items', $document['title'] );
		$this->assertArrayHasKey(
			'owner',
			$document,
			'Inline collections surface their owner page so command palette and trash can show breadcrumb context.'
		);
		$this->assertSame( $owner_id, $document['owner']['id'] );
		$this->assertSame( 'Quarterly review', $document['owner']['title'] );
		// Inline collections have no workspace route of their own;
		// clicking one in search/trash should land on the owner page,
		// not bounce to Not Found through EntityRoute's inline guard.
		$this->assertSame(
			"page/quarterly-review-{$owner_id}",
			$document['path']
		);
	}

	public function test_list_can_filter_to_collections_only(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id       = $this->create_page( array( 'post_title' => 'Welcome' ) );
		$collection_id = $this->create_collection( 'tasks', 'Tasks' );
		$row_id        = $this->create_row( 'crtxt_tasks', 'First task' );

		$collections_only = $this->documents->list( array( 'kind' => Documents::KIND_COLLECTION ) );

		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $collections_only['documents'] );
		$this->assertContains( $collection_id, $ids );
		$this->assertNotContains( $page_id, $ids );
		$this->assertNotContains( $row_id, $ids );
	}

	public function test_find_row_without_slug_falls_back_to_bare_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$this->create_collection( 'projects', 'Projects' );
		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => 'crtxt_projects',
				'post_status' => 'private',
				'post_title'  => '',
				'post_name'   => '',
			)
		);

		$document = $this->documents->find( $row_id );

		$this->assertNotNull( $document );
		$this->assertSame( (string) $row_id, $document['path'] );
	}

	public function test_find_returns_null_for_non_document_post_type(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Regular post',
			)
		);

		$this->assertNull( $this->documents->find( $post_id ) );
	}

	public function test_find_returns_null_for_unknown_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$this->assertNull( $this->documents->find( 999999 ) );
	}

	public function test_find_excludes_trashed_documents_by_default(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();
		wp_trash_post( $page_id );

		$this->assertNull( $this->documents->find( $page_id ) );

		$document = $this->documents->find( $page_id, array( 'allow_trash' => true ) );
		$this->assertNotNull( $document );
	}

	public function test_find_returns_null_when_user_cannot_edit(): void {
		$owner_id = $this->create_user( 'administrator' );
		wp_set_current_user( $owner_id );
		$page_id = $this->create_page(
			array(
				'post_author' => $owner_id,
				'post_status' => 'private',
			)
		);

		wp_set_current_user( $this->create_user( 'contributor' ) );

		$this->assertNull( $this->documents->find( $page_id ) );
	}

	public function test_find_can_include_excerpt(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page(
			array(
				'post_content' => "<!-- wp:paragraph -->\n<p>The quick brown fox jumps over the lazy dog.</p>\n<!-- /wp:paragraph -->",
			)
		);

		$document = $this->documents->find( $page_id, array( 'include_excerpt' => true ) );

		$this->assertNotNull( $document );
		$this->assertArrayHasKey( 'excerpt', $document );
		$this->assertStringContainsString( 'quick brown fox', $document['excerpt'] );
		$this->assertStringNotContainsString( '<p>', $document['excerpt'] );
		$this->assertStringNotContainsString( 'wp:paragraph', $document['excerpt'] );
	}

	public function test_list_returns_pages_and_rows_mixed(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$this->create_collection( 'projects', 'Projects' );
		$page_id = $this->create_page( array( 'post_title' => 'Welcome' ) );
		$row_id  = $this->create_row( 'crtxt_projects', 'Launch plan' );

		$result = $this->documents->list();

		$this->assertGreaterThanOrEqual( 2, $result['total'] );
		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertContains( $page_id, $ids );
		$this->assertContains( $row_id, $ids );
	}

	public function test_list_filters_by_kind(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$this->create_collection( 'projects', 'Projects' );
		$page_id = $this->create_page( array( 'post_title' => 'Welcome' ) );
		$row_id  = $this->create_row( 'crtxt_projects', 'Launch plan' );

		$pages_only = $this->documents->list( array( 'kind' => Documents::KIND_PAGE ) );
		$rows_only  = $this->documents->list( array( 'kind' => Documents::KIND_ROW ) );

		$page_ids = array_map( static fn ( array $doc ): int => $doc['id'], $pages_only['documents'] );
		$row_ids  = array_map( static fn ( array $doc ): int => $doc['id'], $rows_only['documents'] );

		$this->assertContains( $page_id, $page_ids );
		$this->assertNotContains( $row_id, $page_ids );
		$this->assertContains( $row_id, $row_ids );
		$this->assertNotContains( $page_id, $row_ids );
	}

	public function test_list_matches_search_against_title_and_content(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$matching_title_id   = $this->create_page( array( 'post_title' => 'Quarterly report' ) );
		$matching_content_id = $this->create_page(
			array(
				'post_title'   => 'Notes',
				'post_content' => 'Quarterly review notes for the team.',
			)
		);
		$unrelated_id        = $this->create_page( array( 'post_title' => 'Unrelated' ) );

		$result = $this->documents->list( array( 'search' => 'quarterly' ) );

		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertContains( $matching_title_id, $ids );
		$this->assertContains( $matching_content_id, $ids );
		$this->assertNotContains( $unrelated_id, $ids );
	}

	public function test_list_paginates(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		for ( $i = 0; $i < 5; $i++ ) {
			$this->create_page( array( 'post_title' => "Page {$i}" ) );
		}

		$page_one = $this->documents->list( array( 'per_page' => 2 ) );
		$page_two = $this->documents->list(
			array(
				'per_page' => 2,
				'page'     => 2,
			)
		);

		$this->assertCount( 2, $page_one['documents'] );
		$this->assertCount( 2, $page_two['documents'] );
		$this->assertGreaterThanOrEqual( 5, $page_one['total'] );

		$ids_one = array_map( static fn ( array $doc ): int => $doc['id'], $page_one['documents'] );
		$ids_two = array_map( static fn ( array $doc ): int => $doc['id'], $page_two['documents'] );
		$this->assertSame( array(), array_intersect( $ids_one, $ids_two ) );
	}

	public function test_list_paginates_after_permission_filtering(): void {
		$owner_id  = $this->create_user( 'administrator' );
		$viewer_id = $this->create_user( 'contributor' );

		wp_set_current_user( $owner_id );
		$this->create_page(
			array(
				'post_author'       => $owner_id,
				'post_title'        => 'Other newest',
				'post_modified'     => '2025-01-05 00:00:00',
				'post_modified_gmt' => '2025-01-05 00:00:00',
			)
		);
		$this->create_page(
			array(
				'post_author'       => $owner_id,
				'post_title'        => 'Other newer',
				'post_modified'     => '2025-01-04 00:00:00',
				'post_modified_gmt' => '2025-01-04 00:00:00',
			)
		);

		$editable_ids = array(
			$this->create_page(
				array(
					'post_author'       => $viewer_id,
					'post_title'        => 'Mine one',
					'post_modified'     => '2025-01-03 00:00:00',
					'post_modified_gmt' => '2025-01-03 00:00:00',
				)
			),
			$this->create_page(
				array(
					'post_author'       => $viewer_id,
					'post_title'        => 'Mine two',
					'post_modified'     => '2025-01-02 00:00:00',
					'post_modified_gmt' => '2025-01-02 00:00:00',
				)
			),
			$this->create_page(
				array(
					'post_author'       => $viewer_id,
					'post_title'        => 'Mine three',
					'post_modified'     => '2025-01-01 00:00:00',
					'post_modified_gmt' => '2025-01-01 00:00:00',
				)
			),
		);

		wp_set_current_user( $viewer_id );

		$result = $this->documents->list( array( 'per_page' => 2 ) );

		$this->assertSame( 3, $result['total'] );
		$this->assertCount( 2, $result['documents'] );
		$this->assertSame(
			array_slice( $editable_ids, 0, 2 ),
			array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] )
		);
	}

	public function test_list_resolves_collection_once_per_row_post_type(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$this->create_collection( 'cachedalbums', 'Cached albums' );
		$this->create_row( 'crtxt_cachedalbums', 'First' );
		$this->create_row( 'crtxt_cachedalbums', 'Second' );

		$collection_lookups = 0;
		$count_lookups      = static function ( $pre, \WP_Query $query ) use ( &$collection_lookups ) {
			$vars = $query->query_vars;
			if (
				Collection::POST_TYPE === ( $vars['post_type'] ?? '' ) &&
				'slug' === ( $vars['meta_key'] ?? '' ) &&
				'cachedalbums' === ( $vars['meta_value'] ?? '' )
			) {
				++$collection_lookups;
			}
			return $pre;
		};
		add_filter( 'posts_pre_query', $count_lookups, 9, 2 );

		$this->documents->list( array( 'kind' => Documents::KIND_ROW ) );

		remove_filter( 'posts_pre_query', $count_lookups, 9 );

		$this->assertSame( 1, $collection_lookups );
	}

	public function test_list_with_status_trash_returns_trashed_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$live    = $this->create_page( array( 'post_title' => 'Live' ) );
		$trashed = $this->create_page( array( 'post_title' => 'Going away' ) );
		wp_trash_post( $trashed );

		$result = $this->documents->list( array( 'status' => Documents::STATUS_TRASH ) );

		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertContains( $trashed, $ids );
		$this->assertNotContains( $live, $ids );

		$by_id = array_column( $result['documents'], null, 'id' );
		$this->assertArrayHasKey( 'meta', $by_id[ $trashed ] );
		$this->assertArrayHasKey( PageTrashCascade::META_KEY, $by_id[ $trashed ]['meta'] );
	}

	public function test_list_excludes_trashed_documents(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$live_id    = $this->create_page( array( 'post_title' => 'Live page' ) );
		$trashed_id = $this->create_page( array( 'post_title' => 'Will trash' ) );
		wp_trash_post( $trashed_id );

		$result = $this->documents->list();

		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertContains( $live_id, $ids );
		$this->assertNotContains( $trashed_id, $ids );
	}

	public function test_list_search_matches_row_by_text_field(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$status_field  = $this->create_collection_field( $collection_id, 'Status', 'text' );

		$matching_id  = $this->create_row( 'crtxt_projects', 'First row' );
		$unrelated_id = $this->create_row( 'crtxt_projects', 'Second row' );
		update_post_meta( $matching_id, "field-{$status_field}", 'shipping today' );
		update_post_meta( $unrelated_id, "field-{$status_field}", 'parked' );

		$result = $this->documents->list( array( 'search' => 'shipping' ) );

		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertContains( $matching_id, $ids );
		$this->assertNotContains( $unrelated_id, $ids );
	}

	public function test_list_search_matches_row_by_email_and_url_fields(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'contacts', 'Contacts' );
		$email_field   = $this->create_collection_field( $collection_id, 'Email', 'email' );
		$url_field     = $this->create_collection_field( $collection_id, 'Site', 'url' );

		$email_match_id = $this->create_row( 'crtxt_contacts', 'Alice' );
		$url_match_id   = $this->create_row( 'crtxt_contacts', 'Bob' );
		$unrelated_id   = $this->create_row( 'crtxt_contacts', 'Carol' );
		update_post_meta( $email_match_id, "field-{$email_field}", 'alice@example.org' );
		update_post_meta( $url_match_id, "field-{$url_field}", 'https://acme.test/blog' );

		$by_email = $this->documents->list( array( 'search' => 'example.org' ) );
		$by_url   = $this->documents->list( array( 'search' => 'acme.test' ) );

		$email_ids = array_map( static fn ( array $doc ): int => $doc['id'], $by_email['documents'] );
		$url_ids   = array_map( static fn ( array $doc ): int => $doc['id'], $by_url['documents'] );

		$this->assertContains( $email_match_id, $email_ids );
		$this->assertNotContains( $unrelated_id, $email_ids );
		$this->assertContains( $url_match_id, $url_ids );
		$this->assertNotContains( $unrelated_id, $url_ids );
	}

	public function test_list_search_ignores_non_text_field_values(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$count_field   = $this->create_collection_field( $collection_id, 'Count', 'number' );
		$pick_field    = $this->create_collection_field( $collection_id, 'Pick', 'select' );

		$number_row_id = $this->create_row( 'crtxt_projects', 'Numbers' );
		$select_row_id = $this->create_row( 'crtxt_projects', 'Selects' );
		update_post_meta( $number_row_id, "field-{$count_field}", '12345' );
		update_post_meta( $select_row_id, "field-{$pick_field}", 'shipping' );

		$result = $this->documents->list( array( 'search' => '12345' ) );
		$ids    = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertNotContains( $number_row_id, $ids );

		$result = $this->documents->list( array( 'search' => 'shipping' ) );
		$ids    = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertNotContains( $select_row_id, $ids );
	}

	public function test_list_search_ranks_title_matches_above_body_matches(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		// Older page with the term in its title.
		$title_match = $this->create_page(
			array(
				'post_title'        => 'Quarterly report',
				'post_modified'     => '2025-01-01 00:00:00',
				'post_modified_gmt' => '2025-01-01 00:00:00',
			)
		);
		// Newer page whose title misses the term but body matches.
		$body_match = $this->create_page(
			array(
				'post_title'        => 'Notes',
				'post_content'      => 'Quarterly review notes for the team.',
				'post_modified'     => '2025-06-01 00:00:00',
				'post_modified_gmt' => '2025-06-01 00:00:00',
			)
		);

		$result = $this->documents->list( array( 'search' => 'quarterly' ) );
		$ids    = array_map(
			static fn ( array $doc ): int => $doc['id'],
			$result['documents']
		);

		$title_pos = array_search( $title_match, $ids, true );
		$body_pos  = array_search( $body_match, $ids, true );

		$this->assertNotFalse( $title_pos );
		$this->assertNotFalse( $body_pos );
		$this->assertLessThan(
			$body_pos,
			$title_pos,
			'Title match should rank above body-only match even when the body-match document is newer.'
		);
	}

	public function test_list_search_ranks_title_prefix_above_title_substring(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		// Page whose title CONTAINS the term but does not start with it,
		// and that has been modified more recently.
		$substring_match = $this->create_page(
			array(
				'post_title'        => 'Meeting notes',
				'post_modified'     => '2025-06-01 00:00:00',
				'post_modified_gmt' => '2025-06-01 00:00:00',
			)
		);
		// Page whose title STARTS with the term, older.
		$prefix_match = $this->create_page(
			array(
				'post_title'        => 'Terry Pratchett',
				'post_modified'     => '2025-01-01 00:00:00',
				'post_modified_gmt' => '2025-01-01 00:00:00',
			)
		);

		$result = $this->documents->list( array( 'search' => 'te' ) );
		$ids    = array_map(
			static fn ( array $doc ): int => $doc['id'],
			$result['documents']
		);

		$prefix_pos    = array_search( $prefix_match, $ids, true );
		$substring_pos = array_search( $substring_match, $ids, true );

		$this->assertNotFalse( $prefix_pos );
		$this->assertNotFalse( $substring_pos );
		$this->assertLessThan(
			$substring_pos,
			$prefix_pos,
			'Title prefix match should rank above title substring match regardless of modified date.'
		);
	}

	public function test_list_search_returns_pages_and_rows_in_one_pass(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$status_field  = $this->create_collection_field( $collection_id, 'Status', 'text' );

		$page_id = $this->create_page(
			array(
				'post_title'   => 'Notes',
				'post_content' => 'Discussing the alpha launch this week.',
			)
		);
		$row_id  = $this->create_row( 'crtxt_projects', 'Mobile rollout' );
		update_post_meta( $row_id, "field-{$status_field}", 'alpha pilot' );

		$result = $this->documents->list( array( 'search' => 'alpha' ) );

		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertContains( $page_id, $ids );
		$this->assertContains( $row_id, $ids );
	}

	public function test_list_search_requires_all_terms_to_match_somewhere(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$status_field  = $this->create_collection_field( $collection_id, 'Status', 'text' );

		$row_one = $this->create_row( 'crtxt_projects', 'Apollo' );
		update_post_meta( $row_one, "field-{$status_field}", 'pilot' );

		$row_two = $this->create_row( 'crtxt_projects', 'Apollo' );
		update_post_meta( $row_two, "field-{$status_field}", 'frozen' );

		$result = $this->documents->list( array( 'search' => 'apollo pilot' ) );
		$ids    = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );

		$this->assertContains( $row_one, $ids );
		$this->assertNotContains( $row_two, $ids );
	}

	public function test_list_trash_still_finds_row_by_title(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$this->create_collection( 'projects', 'Projects' );
		$kept_row_id    = $this->create_row( 'crtxt_projects', 'Keeper' );
		$trashed_row_id = $this->create_row( 'crtxt_projects', 'Spaceship' );
		wp_trash_post( $trashed_row_id );

		$result = $this->documents->list(
			array(
				'status' => Documents::STATUS_TRASH,
				'search' => 'spaceship',
			)
		);

		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertContains( $trashed_row_id, $ids );
		$this->assertNotContains( $kept_row_id, $ids );
	}

	public function test_format_document_returns_null_for_non_document_post_type(): void {
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Regular post',
			)
		);
		$post    = get_post( $post_id );

		$this->assertNull( $this->documents->format_document( $post ) );
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
			'post_type'   => Page::POST_TYPE,
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
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array(
					'slug' => $slug,
				),
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		( new CollectionEntries() )->register_for_collection( get_post( (int) $id ) );

		return (int) $id;
	}

	private function create_row( string $post_type, string $title ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => $post_type,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	private function create_collection_field( int $collection_id, string $title, string $type ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => $type ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'fields', (string) $field_id );

		return $field_id;
	}

	private function unregister_dynamic_collection_post_types(): void {
		foreach ( get_post_types() as $post_type ) {
			if (
				str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) &&
				! in_array( $post_type, array( Page::POST_TYPE, Collection::POST_TYPE, Field::POST_TYPE ), true )
			) {
				unregister_post_type( $post_type );
			}
		}
	}
}
