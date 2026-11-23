<?php
/**
 * Tests for the icon and cover header block helpers.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\DocumentIdentity;
use WorDBless\BaseTestCase;

final class Test_Document_Identity_Blocks extends BaseTestCase {

	private const BODY = '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->';

	public function test_icon_and_cover_markup_match_what_the_editor_saves(): void {
		$this->assertSame(
			'<!-- wp:cortext/document-icon {"lock":{"move":true,"remove":true}} /-->',
			DocumentIdentity::icon_block_markup()
		);
		$this->assertSame(
			'<!-- wp:cortext/document-cover {"lock":{"move":true,"remove":true}} /-->',
			DocumentIdentity::cover_block_markup()
		);
	}

	public function test_orders_cover_icon_title_properties_then_body(): void {
		$content = DocumentIdentity::with_identity_blocks( self::BODY, true, true );

		$this->assertSame(
			array( 'cortext/document-cover', 'cortext/document-icon', 'core/post-title', 'cortext/document-properties', 'core/paragraph' ),
			$this->block_names( $content )
		);
		$this->assertStringEndsWith( self::BODY, $content );
	}

	public function test_adds_only_the_blocks_asked_for(): void {
		$this->assertSame(
			array( 'cortext/document-icon', 'core/post-title', 'cortext/document-properties', 'core/paragraph' ),
			$this->block_names( DocumentIdentity::with_identity_blocks( self::BODY, true, false ) )
		);
		$this->assertSame(
			array( 'cortext/document-cover', 'core/post-title', 'cortext/document-properties', 'core/paragraph' ),
			$this->block_names( DocumentIdentity::with_identity_blocks( self::BODY, false, true ) )
		);
		$this->assertSame(
			DocumentIdentity::with_properties_block( self::BODY ),
			DocumentIdentity::with_identity_blocks( self::BODY, false, false )
		);
	}

	public function test_adds_the_title_to_content_that_only_has_the_properties_block(): void {
		$content = DocumentIdentity::properties_block_markup() . self::BODY;

		$this->assertSame(
			array( 'cortext/document-icon', 'core/post-title', 'cortext/document-properties', 'core/paragraph' ),
			$this->block_names( DocumentIdentity::with_identity_blocks( $content, true, false ) )
		);
	}

	public function test_is_idempotent(): void {
		$once = DocumentIdentity::with_identity_blocks( self::BODY, true, true );

		$this->assertSame( $once, DocumentIdentity::with_identity_blocks( $once, true, true ) );
	}

	public function test_adds_the_missing_block_next_to_existing_ones(): void {
		$with_cover = DocumentIdentity::with_identity_blocks( self::BODY, false, true );
		$this->assertSame(
			DocumentIdentity::with_identity_blocks( self::BODY, true, true ),
			DocumentIdentity::with_identity_blocks( $with_cover, true, true )
		);

		$with_icon = DocumentIdentity::with_identity_blocks( self::BODY, true, false );
		$this->assertSame(
			DocumentIdentity::with_identity_blocks( self::BODY, true, true ),
			DocumentIdentity::with_identity_blocks( $with_icon, true, true )
		);
	}

	public function test_keeps_the_content_the_editor_saved(): void {
		$saved = "<!-- wp:cortext/document-cover {\"lock\":{\"move\":true,\"remove\":true}} /-->\n\n"
			. "<!-- wp:cortext/document-icon {\"lock\":{\"move\":true,\"remove\":true}} /-->\n\n"
			. "<!-- wp:post-title {\"level\":1,\"lock\":{\"move\":true,\"remove\":true}} /-->\n\n"
			. "<!-- wp:cortext/document-properties {\"lock\":{\"move\":true,\"remove\":true}} /-->\n\n"
			. self::BODY;

		$this->assertSame( $saved, DocumentIdentity::with_identity_blocks( $saved, true, true ) );
	}

	public function test_splices_the_icon_without_touching_the_rest(): void {
		$title   = '<!-- wp:post-title {"level":1} /-->';
		$content = $title . DocumentIdentity::properties_block_markup() . self::BODY;

		$this->assertSame(
			DocumentIdentity::icon_block_markup() . $content,
			DocumentIdentity::with_identity_blocks( $content, true, false )
		);
	}

	/**
	 * Top-level block names, skipping the whitespace between blocks.
	 *
	 * @param string $content Serialized content.
	 * @return string[]
	 */
	private function block_names( string $content ): array {
		return array_values(
			array_filter(
				array_map(
					static fn( array $block ) => $block['blockName'],
					parse_blocks( $content )
				)
			)
		);
	}
}
