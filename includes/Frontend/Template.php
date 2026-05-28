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
			return CORTEXT_PATH . 'templates/single-crtxt_document.php';
		}
		return $template;
	}
}
