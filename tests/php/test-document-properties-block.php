<?php
/**
 * Tests for seeding the title and properties blocks on every new document.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Documents;
use Cortext\Editor\DocumentPropertiesBlock;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WorDBless\Posts;

final class Test_Document_Properties_Block extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private ArchiveCascade $archive_cascade;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		( new Field() )->register_post_type();

		remove_all_actions( 'transition_post_status' );
		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_actions( 'before_delete_post' );
		remove_all_filters( 'wp_untrash_post_status' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		// WorDBless saves posts from its own priority 10 `wp_insert_post_data`
		// filter, before the filters under test run, and keeps the content
		// slashed. Save the final data unslashed instead, as the database does.
		remove_filter( 'wp_insert_post_data', array( Posts::init(), 'insert_post' ), 10 );
		add_filter( 'wp_insert_post_data', array( $this, 'store_final_post_data' ), PHP_INT_MAX, 3 );

		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );

		$this->archive_cascade = new ArchiveCascade();
		$this->archive_cascade->register_status();
		$this->archive_cascade->register_meta();
		$this->archive_cascade->register();
		( new TrashCascade() )->register();
		( new DocumentIdentity() )->register();
	}

	public function tear_down(): void {
		remove_filter( 'wp_insert_post_data', array( $this, 'store_final_post_data' ), PHP_INT_MAX );
		add_filter( 'wp_insert_post_data', array( Posts::init(), 'insert_post' ), 10, 3 );
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_new_documents_get_title_then_properties(): void {
		$this->assertHeaderIsTitleThenProperties( $this->create_page() );
		$this->assertHeaderIsTitleThenProperties( $this->create_collection() );
		$this->assertHeaderIsTitleThenProperties( $this->create_row( $this->create_collection() ) );
	}

	public function test_body_blocks_stay_after_the_header(): void {
		$body    = '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';
		$page_id = $this->create_page( $body );

		$this->assertSame(
			DocumentIdentity::header_blocks_markup() . DocumentIdentity::properties_block_markup() . $body,
			get_post_field( 'post_content', $page_id, 'raw' )
		);
	}

	public function test_content_around_the_title_is_kept_byte_for_byte(): void {
		$this->act_as_unfiltered_html_user();
		$title = '<!-- wp:core/post-title {"level":1,"lock":{"move":true,"remove":true}} /-->';
		$body  = "\n\n" . '<!-- wp:group {"style":{},"ratio":1.0,"note":"a\\/b<c"} --><div class="wp-block-group"></div><!-- /wp:group -->';

		$page_id = $this->create_page( $title . $body );

		$this->assertSame(
			$title . DocumentIdentity::properties_block_markup() . $body,
			get_post_field( 'post_content', $page_id, 'raw' )
		);
	}

	public function test_properties_go_after_a_title_with_a_closing_comment(): void {
		$this->act_as_unfiltered_html_user();
		$title = '<!-- wp:post-title {"level":1} --><!-- /wp:post-title -->';
		$body  = '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$page_id = $this->create_page( $title . $body );

		$this->assertSame(
			$title . DocumentIdentity::properties_block_markup() . $body,
			get_post_field( 'post_content', $page_id, 'raw' )
		);
	}

	public function test_content_that_already_has_both_blocks_is_left_untouched(): void {
		$content = DocumentIdentity::header_blocks_markup()
			. '<!-- wp:cortext/document-properties {"lock":{"move":true,"remove":true}} /-->'
			. "\n\n" . '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$this->assertSame( $content, get_post_field( 'post_content', $this->create_page( $content ), 'raw' ) );
	}

	public function test_content_with_properties_but_no_title_gets_the_title_first(): void {
		$content = DocumentIdentity::properties_block_markup() . '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$this->assertSame(
			DocumentIdentity::header_blocks_markup() . $content,
			get_post_field( 'post_content', $this->create_page( $content ), 'raw' )
		);
	}

	public function test_updates_are_left_untouched(): void {
		$page_id = $this->create_page();
		$body    = '<!-- wp:paragraph --><p>Rewritten</p><!-- /wp:paragraph -->';

		wp_update_post(
			wp_slash(
				array(
					'ID'           => $page_id,
					'post_content' => $body,
				)
			)
		);

		$this->assertSame( $body, get_post_field( 'post_content', $page_id, 'raw' ) );
	}

	public function test_joining_and_leaving_collections_never_rewrites_the_content(): void {
		$first   = $this->create_collection();
		$second  = $this->create_collection();
		$page_id = $this->create_page();
		$before  = get_post_field( 'post_content', $page_id, 'raw' );
		$updates = 0;
		$count   = static function () use ( &$updates ): void {
			++$updates;
		};
		add_action( 'pre_post_update', $count );

		$this->join( $page_id, $first );
		$this->join( $page_id, $second, true );
		wp_set_object_terms( $page_id, array(), TraitTaxonomy::TAXONOMY, false );

		remove_action( 'pre_post_update', $count );
		$this->assertSame( 0, $updates );
		$this->assertSame( $before, get_post_field( 'post_content', $page_id, 'raw' ) );
	}

	public function test_saving_a_new_row_writes_properties_in_one_save(): void {
		$collection_id = $this->create_collection();
		$updates       = 0;
		$count_updates = static function () use ( &$updates ): void {
			++$updates;
		};
		add_action( 'pre_post_update', $count_updates );

		$row_id = ( new Documents() )->save(
			array(
				'title' => 'Imported row',
				'trait' => $collection_id,
			)
		);

		remove_action( 'pre_post_update', $count_updates );
		$this->assertIsInt( $row_id );
		$this->assertSame( 0, $updates );
		$this->assertHeaderIsTitleThenProperties( $row_id );
	}

	public function test_archiving_and_trashing_leave_the_content_alone(): void {
		$archived_row = $this->create_row( $this->create_collection() );
		$trashed_row  = $this->create_row( $this->create_collection() );
		$archived     = get_post_field( 'post_content', $archived_row, 'raw' );
		$trashed      = get_post_field( 'post_content', $trashed_row, 'raw' );

		$this->archive_cascade->archive( $archived_row );
		wp_trash_post( $trashed_row );

		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $archived_row ) );
		$this->assertSame( 'trash', get_post_status( $trashed_row ) );
		$this->assertSame( $archived, get_post_field( 'post_content', $archived_row, 'raw' ) );
		$this->assertSame( $trashed, get_post_field( 'post_content', $trashed_row, 'raw' ) );
	}

	/**
	 * Saves the post data every other filter produced, unslashed.
	 *
	 * @param array $data                Slashed post data.
	 * @param array $postarr             Sanitized post data.
	 * @param array $unsanitized_postarr Original post data.
	 */
	public function store_final_post_data( array $data, array $postarr, array $unsanitized_postarr ): array {
		$stored     = Posts::init()->insert_post( wp_unslash( $data ), $postarr, $unsanitized_postarr );
		$data['ID'] = $stored['ID'];
		return $data;
	}

	/**
	 * Logs in an administrator so kses does not rewrite block markup on save.
	 */
	private function act_as_unfiltered_html_user(): void {
		$user_id = (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_read_only_', false ),
				'user_pass'  => 'password',
				'role'       => 'administrator',
			)
		);
		wp_set_current_user( $user_id );
		$this->assertTrue( current_user_can( 'unfiltered_html' ) );
	}

	private function assertHeaderIsTitleThenProperties( int $post_id ): void {
		$blocks = array_values(
			array_filter(
				parse_blocks( (string) get_post_field( 'post_content', $post_id, 'raw' ) ),
				static fn( array $block ): bool => null !== $block['blockName']
			)
		);
		$lock   = array(
			'move'   => true,
			'remove' => true,
		);

		$this->assertSame( 'core/post-title', $blocks[0]['blockName'] ?? null );
		$this->assertSame( DocumentPropertiesBlock::BLOCK_NAME, $blocks[1]['blockName'] ?? null );
		$this->assertSame( $lock, $blocks[1]['attrs']['lock'] ?? null );
		$this->assertSame(
			1,
			substr_count( (string) get_post_field( 'post_content', $post_id, 'raw' ), '<!-- wp:cortext/document-properties' )
		);
	}

	private function create_page( ?string $content = null ): int {
		$postarr = array(
			'post_type'   => Document::POST_TYPE,
			'post_status' => 'publish',
			'post_title'  => 'Page ' . wp_generate_uuid4(),
		);
		if ( null !== $content ) {
			$postarr['post_content'] = $content;
		}
		$id = (int) wp_insert_post( wp_slash( $postarr ) );
		$this->assertGreaterThan( 0, $id );
		return $id;
	}

	private function create_collection( bool $with_field = true ): int {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection ' . wp_generate_uuid4(),
			)
		);
		$this->assertGreaterThan( 0, $collection_id );

		if ( ! $with_field ) {
			( new TraitTaxonomy() )->ensure_mirror_term( $collection_id );
			return $collection_id;
		}

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Status',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );

		return $collection_id;
	}

	private function create_row( int $collection_id, ?string $content = null ): int {
		$postarr = array(
			'post_type'   => Document::POST_TYPE,
			'post_status' => 'publish',
			'post_title'  => 'Row ' . wp_generate_uuid4(),
		);
		if ( null !== $content ) {
			$postarr['post_content'] = $content;
		}
		$row_id = (int) wp_insert_post( wp_slash( $postarr ) );
		$this->assertGreaterThan( 0, $row_id );

		$this->join( $row_id, $collection_id );

		return $row_id;
	}

	private function join( int $document_id, int $collection_id, bool $append = false ): void {
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $document_id, array( $term_id ), TraitTaxonomy::TAXONOMY, $append );
	}
}
