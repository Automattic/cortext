<?php
/**
 * Tests for seeding the properties block on rows entering Trash or Archived.
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

final class Test_Row_Read_Only_Properties extends BaseTestCase {

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
		parent::tear_down();
	}

	public function test_archiving_a_row_adds_properties_after_title(): void {
		$row_id = $this->create_row( $this->create_collection() );

		$this->archive_cascade->archive( $row_id );

		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $row_id ) );
		$this->assertHeaderIsTitleThenProperties( $row_id );
	}

	public function test_trashing_a_row_adds_properties_after_title(): void {
		$row_id = $this->create_row( $this->create_collection() );

		wp_trash_post( $row_id );

		$this->assertSame( 'trash', get_post_status( $row_id ) );
		$this->assertHeaderIsTitleThenProperties( $row_id );
	}

	public function test_body_blocks_stay_after_the_inserted_properties(): void {
		$body   = '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';
		$row_id = $this->create_row( $this->create_collection(), $body );

		$this->archive_cascade->archive( $row_id );

		$this->assertSame(
			DocumentIdentity::header_blocks_markup() . DocumentIdentity::properties_block_markup() . $body,
			get_post_field( 'post_content', $row_id, 'raw' )
		);
	}

	public function test_archiving_a_collection_adds_properties_to_cascaded_rows(): void {
		$collection_id = $this->create_collection();
		$row_ids       = array( $this->create_row( $collection_id ), $this->create_row( $collection_id ) );

		$this->archive_cascade->archive( $collection_id );

		foreach ( $row_ids as $row_id ) {
			$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $row_id ) );
			$this->assertHeaderIsTitleThenProperties( $row_id );
		}
	}

	public function test_trashing_a_collection_adds_properties_to_cascaded_rows(): void {
		$collection_id = $this->create_collection();
		$row_ids       = array( $this->create_row( $collection_id ), $this->create_row( $collection_id ) );

		wp_trash_post( $collection_id );

		foreach ( $row_ids as $row_id ) {
			$this->assertSame( 'trash', get_post_status( $row_id ) );
			$this->assertHeaderIsTitleThenProperties( $row_id );
		}
	}

	public function test_row_that_already_has_properties_is_left_untouched(): void {
		$content      = DocumentIdentity::header_blocks_markup()
			. '<!-- wp:cortext/document-properties {"lock":{"move":true,"remove":true}} /-->'
			. "\n\n" . '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';
		$archived_row = $this->create_row( $this->create_collection(), $content );
		$trashed_row  = $this->create_row( $this->create_collection(), $content );

		$this->archive_cascade->archive( $archived_row );
		wp_trash_post( $trashed_row );

		$this->assertSame( $content, get_post_field( 'post_content', $archived_row, 'raw' ) );
		$this->assertSame( $content, get_post_field( 'post_content', $trashed_row, 'raw' ) );
	}

	public function test_pages_and_collections_are_left_untouched(): void {
		$archived_page       = $this->create_page();
		$trashed_page        = $this->create_page();
		$archived_collection = $this->create_collection();
		$trashed_collection  = $this->create_collection();
		$before              = array();
		foreach ( array( $archived_page, $trashed_page, $archived_collection, $trashed_collection ) as $id ) {
			$before[ $id ] = get_post_field( 'post_content', $id, 'raw' );
		}

		$this->archive_cascade->archive( $archived_page );
		$this->archive_cascade->archive( $archived_collection );
		wp_trash_post( $trashed_page );
		wp_trash_post( $trashed_collection );

		foreach ( $before as $id => $content ) {
			$this->assertSame( $content, get_post_field( 'post_content', $id, 'raw' ) );
		}
	}

	public function test_restoring_does_not_change_content(): void {
		$archived_row = $this->create_row( $this->create_collection() );
		$trashed_row  = $this->create_row( $this->create_collection() );
		$this->archive_cascade->archive( $archived_row );
		wp_trash_post( $trashed_row );
		$archived_content = get_post_field( 'post_content', $archived_row, 'raw' );
		$trashed_content  = get_post_field( 'post_content', $trashed_row, 'raw' );

		$this->archive_cascade->unarchive( $archived_row );
		wp_untrash_post( $trashed_row );

		$this->assertSame( 'publish', get_post_status( $archived_row ) );
		$this->assertNotSame( 'trash', get_post_status( $trashed_row ) );
		$this->assertSame( $archived_content, get_post_field( 'post_content', $archived_row, 'raw' ) );
		$this->assertSame( $trashed_content, get_post_field( 'post_content', $trashed_row, 'raw' ) );
	}

	public function test_row_in_collection_without_fields_still_gets_properties(): void {
		$collection_id = $this->create_collection( false );
		$this->assertSame( array(), Document::collection_field_ids( $collection_id ) );
		$row_id = $this->create_row( $collection_id );

		$this->archive_cascade->archive( $row_id );

		$this->assertHeaderIsTitleThenProperties( $row_id );
	}

	public function test_row_without_title_gets_title_and_properties(): void {
		$body   = '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';
		$row_id = $this->create_row( $this->create_collection() );
		$this->set_raw_content( $row_id, $body );

		wp_trash_post( $row_id );

		$this->assertSame(
			DocumentIdentity::header_blocks_markup() . DocumentIdentity::properties_block_markup() . $body,
			get_post_field( 'post_content', $row_id, 'raw' )
		);
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

	/**
	 * Replaces stored content without running the insert filters.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $content Raw block content.
	 */
	private function set_raw_content( int $post_id, string $content ): void {
		Posts::init()->posts[ $post_id ]->post_content = $content;
		clean_post_cache( $post_id );
	}

	private function create_page(): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Page ' . wp_generate_uuid4(),
			)
		);
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

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );

		return $row_id;
	}
}
