<?php
/**
 * Tests for Cortext\Documents.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Documents;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;

final class Test_Documents extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private Documents $documents;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new DocumentIdentity() )->register();
		$trait_taxonomy = new TraitTaxonomy();
		$trait_taxonomy->register_taxonomy();
		// Wire the meta listeners directly; `TraitTaxonomy::register()`
		// would queue them on `init`, which has already fired in the
		// test harness.
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$this->documents = new Documents();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_get_document_post_types_includes_pages_rows_and_collections(): void {
		$this->create_collection( 'projects', 'Projects' );

		$post_types = $this->documents->get_document_post_types();

		$this->assertContains( Document::POST_TYPE, $post_types );
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
		$this->assertSame( $page_id, $document['id'] );
		$this->assertSame( 'About us', $document['title'] );
		$this->assertSame( "about-us-{$page_id}", $document['path'] );
		$this->assertSame( $icon, $document['icon'] );
		$this->assertArrayNotHasKey( 'collection', $document );
		$this->assertArrayNotHasKey( 'excerpt', $document );
	}

	public function test_find_returns_row_document_with_collection_summary(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$row_id        = $this->create_row( $collection_id, 'Ship the thing' );

		$document = $this->documents->find( $row_id );

		$this->assertNotNull( $document );
		$this->assertSame( $row_id, $document['id'] );
		$this->assertSame( 'Ship the thing', $document['title'] );
		$this->assertSame( "ship-the-thing-{$row_id}", $document['path'] );
		$this->assertSame( $collection_id, $document['collection']['id'] );
		$this->assertSame( 'Projects', $document['collection']['title'] );
		$this->assertSame( "projects-{$collection_id}", $document['collection']['path'] );
		$this->assertArrayNotHasKey( 'icon', $document );
	}

	public function test_find_returns_row_icon_when_set(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$icon = wp_json_encode(
			array(
				'type' => 'wp',
				'name' => 'people',
			)
		);
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$row_id        = $this->create_row( $collection_id, 'Ada Lovelace' );
		update_post_meta( $row_id, DocumentIdentity::META_KEY, $icon );

		$document = $this->documents->find( $row_id );

		$this->assertSame( $icon, $document['icon'] );
	}

	public function test_find_returns_full_page_collection_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'tasks', 'Tasks' );

		$document = $this->documents->find( $collection_id );

		$this->assertNotNull( $document );
		$this->assertSame( $collection_id, $document['id'] );
		$this->assertSame( 'Tasks', $document['title'] );
		$this->assertSame( "tasks-{$collection_id}", $document['path'] );
		$this->assertArrayNotHasKey(
			'owner',
			$document,
			'Collections do not carry an owner in the universal-document model.'
		);
	}

	public function test_find_row_without_slug_falls_back_to_bare_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$row_id        = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => '',
				'post_name'   => '',
			)
		);
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

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
		$collection_id = $this->create_collection( 'projects', 'Projects' );
		$page_id       = $this->create_page( array( 'post_title' => 'Welcome' ) );
		$row_id        = $this->create_row( $collection_id, 'Launch plan' );

		$result = $this->documents->list();

		$this->assertGreaterThanOrEqual( 2, $result['total'] );
		$ids = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );
		$this->assertContains( $page_id, $ids );
		$this->assertContains( $row_id, $ids );
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

	public function test_list_attaches_parent_collection_to_each_row(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'cachedalbums', 'Cached albums' );
		$this->create_row( $collection_id, 'First' );
		$this->create_row( $collection_id, 'Second' );

		$documents = new Documents();
		$result    = $documents->list();

		$rows = array_values(
			array_filter(
				$result['documents'],
				static fn ( array $doc ): bool => isset( $doc['collection'] )
			)
		);
		$this->assertCount( 2, $rows );
		foreach ( $rows as $document ) {
			$this->assertSame( $collection_id, $document['collection']['id'] );
		}
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
		$this->assertArrayHasKey( TrashCascade::PARENT_MARKER_META, $by_id[ $trashed ]['meta'] );
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

		$matching_id  = $this->create_row( $collection_id, 'First row' );
		$unrelated_id = $this->create_row( $collection_id, 'Second row' );
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

		$email_match_id = $this->create_row( $collection_id, 'Alice' );
		$url_match_id   = $this->create_row( $collection_id, 'Bob' );
		$unrelated_id   = $this->create_row( $collection_id, 'Carol' );
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

		$number_row_id = $this->create_row( $collection_id, 'Numbers' );
		$select_row_id = $this->create_row( $collection_id, 'Selects' );
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
		$row_id  = $this->create_row( $collection_id, 'Mobile rollout' );
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

		$row_one = $this->create_row( $collection_id, 'Apollo' );
		update_post_meta( $row_one, "field-{$status_field}", 'pilot' );

		$row_two = $this->create_row( $collection_id, 'Apollo' );
		update_post_meta( $row_two, "field-{$status_field}", 'frozen' );

		$result = $this->documents->list( array( 'search' => 'apollo pilot' ) );
		$ids    = array_map( static fn ( array $doc ): int => $doc['id'], $result['documents'] );

		$this->assertContains( $row_one, $ids );
		$this->assertNotContains( $row_two, $ids );
	}

	public function test_list_trash_still_finds_row_by_title(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id  = $this->create_collection( 'projects', 'Projects' );
		$kept_row_id    = $this->create_row( $collection_id, 'Keeper' );
		$trashed_row_id = $this->create_row( $collection_id, 'Spaceship' );
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

	public function test_format_document_with_trash_meta_exposes_collection_and_row_shape(): void {
		// The sidebar Trash panel reads `cortext_fields` and `crtxt_trait`
		// from the formatted payload to distinguish collections from rows.
		// Page documents come back with empty arrays; collections expose
		// their field ids; rows expose their trait term id.
		$page_id = (int) wp_insert_post(
			array(
				'post_type'   => \Cortext\PostType\Document::POST_TYPE,
				'post_status' => 'trash',
				'post_title'  => 'A trashed page',
			)
		);

		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => \Cortext\PostType\Document::POST_TYPE,
				'post_status' => 'trash',
				'post_title'  => 'A trashed collection',
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', '42' );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => \Cortext\PostType\Document::POST_TYPE,
				'post_status' => 'trash',
				'post_title'  => 'A trashed row',
			)
		);
		$term_id = \Cortext\Taxonomy\TraitTaxonomy::term_id_for_trait( $collection_id );
		wp_set_object_terms( $row_id, array( $term_id ), \Cortext\Taxonomy\TraitTaxonomy::TAXONOMY );

		$page = $this->documents->format_document(
			get_post( $page_id ),
			array( 'include_trash_meta' => true )
		);
		$collection = $this->documents->format_document(
			get_post( $collection_id ),
			array( 'include_trash_meta' => true )
		);
		$row = $this->documents->format_document(
			get_post( $row_id ),
			array( 'include_trash_meta' => true )
		);

		$this->assertSame( array(), $page['meta']['cortext_fields'] );
		$this->assertSame( array(), $page['crtxt_trait'] );

		$this->assertSame( array( 42 ), $collection['meta']['cortext_fields'] );
		$this->assertSame( array(), $collection['crtxt_trait'] );

		$this->assertSame( array(), $row['meta']['cortext_fields'] );
		$this->assertSame( array( $term_id ), $row['crtxt_trait'] );
	}

	public function test_save_creates_page_when_no_fields_or_collection(): void {
		$id = $this->documents->save(
			array(
				'title'  => 'About',
				'status' => 'private',
			)
		);

		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		$this->assertSame( 'About', get_post( $id )->post_title );
		$this->assertSame( 'private', get_post( $id )->post_status );
		$this->assertFalse( Document::is_collection( $id ) );
		$this->assertSame( array(), wp_get_object_terms( $id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) ) );
	}

	public function test_save_creates_collection_from_fields(): void {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Author',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);

		$collection_id = $this->documents->save(
			array(
				'title'  => 'Books',
				'fields' => array( $field_id ),
			)
		);

		$this->assertIsInt( $collection_id );
		$this->assertTrue( Document::is_collection( $collection_id ) );
		$this->assertSame(
			array( (string) $field_id ),
			get_post_meta( $collection_id, 'cortext_fields', false )
		);
		// The mirror term is created by the meta sync hook.
		$this->assertGreaterThan( 0, TraitTaxonomy::term_id_for_trait( $collection_id ) );
	}

	public function test_save_creates_row_when_collection_passed(): void {
		$collection_id = $this->create_collection( 'books', 'Books' );

		$row_id = $this->documents->save(
			array(
				'title'      => 'The Left Hand of Darkness',
				'collection' => $collection_id,
			)
		);

		$this->assertIsInt( $row_id );
		$row = get_post( $row_id );
		$this->assertNotNull( $this->documents->find_trait_for_document( $row ) );
		$this->assertSame(
			$collection_id,
			(int) $this->documents->find_trait_for_document( $row )->ID
		);
	}

	public function test_save_returns_error_for_unknown_collection(): void {
		$result = $this->documents->save(
			array(
				'title'      => 'Orphan row',
				'collection' => 999_999,
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'cortext_collection_not_found', $result->get_error_code() );
	}

	public function test_save_returns_error_for_unknown_id_on_update(): void {
		$result = $this->documents->save(
			array(
				'id'    => 999_999,
				'title' => 'Ghost',
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'cortext_document_not_found', $result->get_error_code() );
	}

	public function test_save_updates_existing_document(): void {
		$collection_id = $this->create_collection( 'books', 'Books' );
		$row_id        = $this->create_row( $collection_id, 'Old title' );

		$result = $this->documents->save(
			array(
				'id'    => $row_id,
				'title' => 'New title',
				// Unregistered meta key acts as a breadcrumb (mirrors the
				// pattern used by the Notion importer).
				'meta'  => array( 'cortext_notion_page_id' => 'abc-123' ),
			)
		);

		$this->assertSame( $row_id, $result );
		$this->assertSame( 'New title', get_post( $row_id )->post_title );
		$this->assertSame( 'abc-123', get_post_meta( $row_id, 'cortext_notion_page_id', true ) );
	}

	public function test_save_replaces_collection_fields_on_update(): void {
		$collection_id = $this->create_collection( 'books', 'Books' );
		$first_field   = (int) get_post_meta( $collection_id, 'cortext_fields', false )[0];
		$second_field  = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Year',
				'meta_input'  => array( 'type' => 'number' ),
			)
		);

		$this->documents->save(
			array(
				'id'     => $collection_id,
				'fields' => array( $second_field ),
			)
		);

		$this->assertSame(
			array( (string) $second_field ),
			get_post_meta( $collection_id, 'cortext_fields', false )
		);
		unset( $first_field );
	}

	public function test_save_removes_collection_membership_when_collection_zero(): void {
		$collection_id = $this->create_collection( 'books', 'Books' );
		$row_id        = $this->create_row( $collection_id, 'Stays as row' );

		$this->documents->save(
			array(
				'id'         => $row_id,
				'collection' => 0,
			)
		);

		// Fresh service avoids the `trait_cache` populated during the row
		// creation path; we want the assertion to read live taxonomy state.
		$fresh = new Documents();
		$this->assertNull( $fresh->find_trait_for_document( get_post( $row_id ) ) );
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

	/**
	 * Creates a collection document with one default field so the
	 * `cortext_fields` meta is non-empty and the universal-model helpers
	 * treat the post as a collection.
	 *
	 * @param string $slug  Cosmetic legacy slug used as `post_name`.
	 * @param string $title Collection title.
	 */
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
		add_post_meta( $id, 'cortext_fields', (string) $field_id );

		return (int) $id;
	}

	private function create_row( int $collection_id, string $title ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( (int) $id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

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
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		return $field_id;
	}
}
