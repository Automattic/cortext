<?php
/**
 * Tests for Cortext\Media\CortextMedia.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Media\CortextMedia;
use Cortext\PostType\Document;
use WorDBless\BaseTestCase;
use WP_REST_Request;

final class Test_Cortext_Media extends BaseTestCase {

	use InMemoryTermStore;
	use InMemoryPostsQuery;

	private CortextMedia $media;

	public function set_up(): void {
		parent::set_up();
		( new Document() )->register_post_type();
		$this->media = new CortextMedia();
		$this->media->register_taxonomy();
		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		parent::tear_down();
	}

	public function test_registers_taxonomy_on_attachments(): void {
		$this->assertTrue( taxonomy_exists( CortextMedia::TAXONOMY ) );
		$this->assertTrue( is_object_in_taxonomy( 'attachment', CortextMedia::TAXONOMY ) );
	}

	public function test_tags_attachment_uploaded_into_a_document(): void {
		$attachment = $this->make_attachment( $this->make_document() );

		$this->media->tag_if_from_cortext( $attachment );

		$this->assertTrue( has_term( CortextMedia::TERM, CortextMedia::TAXONOMY, $attachment ) );
	}

	public function test_marks_attachment_explicitly_as_cortext_media(): void {
		$attachment = $this->make_attachment( 0 );

		$this->media->tag( $attachment );

		$this->assertTrue( has_term( CortextMedia::TERM, CortextMedia::TAXONOMY, $attachment ) );
	}

	public function test_does_not_tag_attachment_without_a_cortext_parent(): void {
		$orphan  = $this->make_attachment( 0 );
		$regular = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_title'  => 'Regular',
				'post_status' => 'publish',
			)
		);
		$foreign = $this->make_attachment( $regular );

		$this->media->tag_if_from_cortext( $orphan );
		$this->media->tag_if_from_cortext( $foreign );

		$this->assertFalse( has_term( CortextMedia::TERM, CortextMedia::TAXONOMY, $orphan ) );
		$this->assertFalse( has_term( CortextMedia::TERM, CortextMedia::TAXONOMY, $foreign ) );
	}

	public function test_inserter_param_adds_a_cortext_media_tax_query(): void {
		$request = new WP_REST_Request();
		$request->set_param( 'cortext_origin', '1' );

		$args = $this->media->scope_inserter_query( array(), $request );

		$this->assertArrayHasKey( 'tax_query', $args );
		$this->assertSame( CortextMedia::TAXONOMY, $args['tax_query'][0]['taxonomy'] );
		$this->assertSame( array( CortextMedia::TERM ), $args['tax_query'][0]['terms'] );
	}

	public function test_inserter_param_absent_leaves_query_unscoped(): void {
		$args = $this->media->scope_inserter_query( array(), new WP_REST_Request() );

		$this->assertArrayNotHasKey( 'tax_query', $args );
	}

	public function test_exposes_cortext_origin_param(): void {
		$params = $this->media->expose_param( array() );

		$this->assertArrayHasKey( 'cortext_origin', $params );
		$this->assertSame( 'boolean', $params['cortext_origin']['type'] );
	}

	public function test_backfill_tags_parented_cover_and_icon_media(): void {
		$document = $this->make_document();

		$inline = $this->make_attachment( $document );

		$cover = $this->make_attachment( 0 );
		update_post_meta( $document, '_thumbnail_id', $cover );

		$icon = $this->make_attachment( 0 );
		update_post_meta(
			$document,
			'cortext_document_icon',
			wp_json_encode(
				array(
					'type' => 'image',
					'id'   => $icon,
				)
			)
		);

		$foreign = $this->make_attachment( 0 );

		$result = $this->media->backfill();

		$this->assertTrue( has_term( CortextMedia::TERM, CortextMedia::TAXONOMY, $inline ) );
		$this->assertTrue( has_term( CortextMedia::TERM, CortextMedia::TAXONOMY, $cover ) );
		$this->assertTrue( has_term( CortextMedia::TERM, CortextMedia::TAXONOMY, $icon ) );
		$this->assertFalse( has_term( CortextMedia::TERM, CortextMedia::TAXONOMY, $foreign ) );
		$this->assertSame( 3, $result['tagged'] );
	}

	private function make_document(): int {
		return (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_title'  => 'Doc',
				'post_status' => 'publish',
			)
		);
	}

	private function make_attachment( int $parent_id ): int {
		return (int) wp_insert_post(
			array(
				'post_type'      => 'attachment',
				'post_parent'    => $parent_id,
				'post_status'    => 'inherit',
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'Image',
			)
		);
	}
}
