<?php
/**
 * Tests for Cortext\PostType\DocumentIdentity.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use WorDBless\BaseTestCase;

final class Test_Document_Identity extends BaseTestCase {

	protected function setUp(): void {
		parent::setUp();
		// The prepender now gates on post_type_supports('cortext-document'),
		// so the test post type needs the trait wired up before each case.
		DocumentIdentity::register_for_post_type( Document::POST_TYPE );
	}

	public function test_header_blocks_markup_contains_title_only(): void {
		$markup = DocumentIdentity::header_blocks_markup();

		$this->assertStringContainsString( '<!-- wp:post-title', $markup );
		$this->assertSame( 1, substr_count( $markup, '<!-- wp:post-title' ) );
	}

	public function test_prepend_header_blocks_leaves_updates_untouched(): void {
		$identity = new DocumentIdentity();
		$content  = '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$data = $identity->prepend_header_blocks(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_content' => wp_slash( $content ),
			),
			array( 'ID' => 123 )
		);

		$unslashed = wp_unslash( $data['post_content'] );
		$this->assertSame( $content, $unslashed );
	}

	public function test_prepend_header_blocks_adds_title_on_create(): void {
		$identity = new DocumentIdentity();
		$content  = '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$data = $identity->prepend_header_blocks(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_content' => wp_slash( $content ),
			),
			array()
		);

		$unslashed = wp_unslash( $data['post_content'] );
		$this->assertStringContainsString( '<!-- wp:post-title', $unslashed );
		$this->assertStringContainsString( '<!-- wp:paragraph -->', $unslashed );
	}

	public function test_prepend_header_blocks_does_not_duplicate_existing_serialized_title(): void {
		$identity = new DocumentIdentity();
		$content  = DocumentIdentity::header_blocks_markup() . '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$data = $identity->prepend_header_blocks(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_content' => wp_slash( $content ),
			),
			array()
		);

		$unslashed = wp_unslash( $data['post_content'] );
		$this->assertSame( 1, substr_count( $unslashed, '<!-- wp:post-title' ) );
	}

	public function test_prepend_header_blocks_skips_post_types_without_document_support(): void {
		$identity = new DocumentIdentity();
		$content  = '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$data = $identity->prepend_header_blocks(
			array(
				'post_type'    => 'post',
				'post_content' => wp_slash( $content ),
			),
			array()
		);

		$unslashed = wp_unslash( $data['post_content'] );
		$this->assertStringNotContainsString( '<!-- wp:post-title', $unslashed );
	}
}
