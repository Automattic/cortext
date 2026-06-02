<?php
/**
 * Provides a plugin-owned template for public Cortext pages.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Frontend;

use Cortext\PostType\Document;

final class Template {

	public function register(): void {
		add_filter( 'template_include', array( $this, 'override_template' ) );
	}

	public function override_template( string $template ): string {
		// Collection documents render through the same template: they are
		// block editor documents whose locked data-view block renders via
		// DataView::render().
		if ( is_singular( Document::POST_TYPE ) ) {
			add_filter( 'render_block', array( $this, 'suppress_duplicate_title' ), 10, 2 );
			return CORTEXT_PATH . 'templates/single-crtxt_document.php';
		}
		return $template;
	}

	/**
	 * Drops the locked `core/post-title` block from a Cortext document's
	 * public render.
	 *
	 * The template prints `the_title()` as the single authoritative title.
	 * `DocumentIdentity::prepend_header_blocks` keeps a matching
	 * `core/post-title` in `post_content` so the editor canvas can show the
	 * title inline, but `the_content()` would otherwise resolve it to the same
	 * `post_title` and render the title a second time. Cortext documents never
	 * carry a second post-title block (the header boundary blocks inserting one
	 * in the body), so suppressing it here is safe for pages saved with and
	 * without the block. Scoped to the public document render: this filter is
	 * only attached while serving the Cortext template, so it never reaches the
	 * admin or REST. See tech-debt.md#td-public-title-double-render.
	 *
	 * @param string $block_content Rendered block HTML.
	 * @param array  $block         Parsed block, including `blockName`.
	 */
	public function suppress_duplicate_title( string $block_content, array $block ): string {
		if ( 'core/post-title' === ( $block['blockName'] ?? '' ) ) {
			return '';
		}
		return $block_content;
	}
}
