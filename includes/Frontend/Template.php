<?php
/**
 * Provides a plugin-owned template for public Cortext pages.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Frontend;

use Cortext\PostType\Collection;
use Cortext\PostType\Page;

final class Template {

	public function register(): void {
		add_filter( 'template_include', array( $this, 'override_template' ) );
	}

	public function override_template( string $template ): string {
		// Full-page collections use the page template too: they are block
		// editor documents, and their locked data-view block renders through
		// DataView::render().
		if (
			is_singular( Page::POST_TYPE ) ||
			is_singular( Collection::POST_TYPE )
		) {
			return CORTEXT_PATH . 'templates/single-crtxt_page.php';
		}
		return $template;
	}
}
