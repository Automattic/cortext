<?php
/**
 * Tests for Cortext\PostType\PageIdentity.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Page;
use Cortext\PostType\PageIdentity;
use WorDBless\BaseTestCase;

final class Test_Page_Identity extends BaseTestCase {

	public function test_header_blocks_markup_contains_title_only(): void {
		$markup = PageIdentity::header_blocks_markup();

		$this->assertStringContainsString( '<!-- wp:post-title', $markup );
		$this->assertStringNotContainsString( 'cortext/page-header-actions', $markup );
	}

	public function test_prepend_header_blocks_strips_legacy_actions_on_update(): void {
		$identity = new PageIdentity();
		$content  = '<!-- wp:cortext/page-header-actions {"lock":{"move":true,"remove":true}} /--><!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$data = $identity->prepend_header_blocks(
			array(
				'post_type'    => Page::POST_TYPE,
				'post_content' => wp_slash( $content ),
			),
			array( 'ID' => 123 )
		);

		$unslashed = wp_unslash( $data['post_content'] );
		$this->assertStringNotContainsString( 'cortext/page-header-actions', $unslashed );
		$this->assertStringContainsString( '<!-- wp:paragraph -->', $unslashed );
	}

	public function test_prepend_header_blocks_adds_title_without_legacy_actions_on_create(): void {
		$identity = new PageIdentity();
		$content  = '<!-- wp:cortext/page-header-actions {"lock":{"move":true,"remove":true}} /--><!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$data = $identity->prepend_header_blocks(
			array(
				'post_type'    => Page::POST_TYPE,
				'post_content' => wp_slash( $content ),
			),
			array()
		);

		$unslashed = wp_unslash( $data['post_content'] );
		$this->assertStringContainsString( '<!-- wp:post-title', $unslashed );
		$this->assertStringNotContainsString( 'cortext/page-header-actions', $unslashed );
		$this->assertStringContainsString( '<!-- wp:paragraph -->', $unslashed );
	}

	public function test_prepend_header_blocks_does_not_duplicate_existing_serialized_title(): void {
		$identity = new PageIdentity();
		$content  = PageIdentity::header_blocks_markup() . '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

		$data = $identity->prepend_header_blocks(
			array(
				'post_type'    => Page::POST_TYPE,
				'post_content' => wp_slash( $content ),
			),
			array()
		);

		$unslashed = wp_unslash( $data['post_content'] );
		$this->assertSame( 1, substr_count( $unslashed, '<!-- wp:post-title' ) );
	}
}
