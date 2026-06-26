<?php
/**
 * Tests for Cortext\Taxonomy\MentionTaxonomy.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\Taxonomy\MentionTaxonomy;
use WorDBless\BaseTestCase;

final class Test_Taxonomy_Mention_Taxonomy extends BaseTestCase {

	use InMemoryTermStore;

	private MentionTaxonomy $mentions;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		$this->mentions = new MentionTaxonomy();
		$this->mentions->register_taxonomy();
		$this->install_in_memory_term_store();
		add_action( 'save_post_' . Document::POST_TYPE, array( $this->mentions, 'sync_mentions_on_save' ), 10, 3 );
		add_action( 'before_delete_post', array( $this->mentions, 'sync_term_on_delete' ), 10, 2 );
	}

	public function tear_down(): void {
		remove_action( 'save_post_' . Document::POST_TYPE, array( $this->mentions, 'sync_mentions_on_save' ), 10 );
		remove_action( 'before_delete_post', array( $this->mentions, 'sync_term_on_delete' ), 10 );
		$this->uninstall_in_memory_term_store();
		parent::tear_down();
	}

	public function test_extract_target_ids_finds_each_mentioned_target_once(): void {
		$html = '<p><a data-crtxt-mention="8">A</a><a data-crtxt-mention="8">A again</a><a data-crtxt-mention="9">B</a></p>';

		$this->assertSame( array( 8, 9 ), MentionTaxonomy::extract_target_ids( $html ) );
	}

	public function test_save_tags_source_with_the_target_term(): void {
		$target = $this->create_document( 'Target' );
		$source = $this->create_document(
			'Source',
			$this->mention_markup( $target )
		);

		$slugs = wp_get_object_terms( $source, MentionTaxonomy::TAXONOMY, array( 'fields' => 'slugs' ) );

		$this->assertSame( array( (string) $target ), $slugs );
	}

	public function test_resave_without_mentions_removes_the_target_term(): void {
		$target = $this->create_document( 'Target' );
		$source = $this->create_document(
			'Source',
			$this->mention_markup( $target )
		);

		wp_update_post(
			array(
				'ID'           => $source,
				'post_content' => '<p>No mentions.</p>',
			)
		);

		$slugs = wp_get_object_terms( $source, MentionTaxonomy::TAXONOMY, array( 'fields' => 'slugs' ) );
		$this->assertSame( array(), $slugs );
	}

	public function test_self_mention_is_skipped(): void {
		$source = $this->create_document( 'Self' );
		wp_update_post(
			array(
				'ID'           => $source,
				'post_content' => $this->mention_markup( $source ),
			)
		);

		$this->assertSame( 0, MentionTaxonomy::term_id_for_target( $source ) );
	}

	public function test_target_delete_removes_the_target_term(): void {
		$target = $this->create_document( 'Target' );
		$this->create_document( 'Source', $this->mention_markup( $target ) );
		$this->assertGreaterThan( 0, MentionTaxonomy::term_id_for_target( $target ) );

		wp_delete_post( $target, true );

		$this->assertSame( 0, MentionTaxonomy::term_id_for_target( $target ) );
	}

	private function create_document( string $title, string $content = '' ): int {
		return (int) wp_insert_post(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_status'  => 'publish',
				'post_title'   => $title,
				'post_content' => $content,
			)
		);
	}

	private function mention_markup( int $target ): string {
		return sprintf(
			'<p><a class="cortext-mention" data-crtxt-mention="%d" href="#">Target</a></p>',
			$target
		);
	}
}
