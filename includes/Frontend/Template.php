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
		// Inline collections share the public CPT but should only render
		// through their owner page. Force a 404 before template selection so
		// the singular collection URL never exposes them.
		add_action( 'template_redirect', array( $this, 'block_inline_singular' ) );
	}

	public function block_inline_singular(): void {
		if ( ! is_singular( Collection::POST_TYPE ) ) {
			return;
		}
		if ( ! Collection::is_inline( (int) get_queried_object_id() ) ) {
			return;
		}
		global $wp_query;
		$wp_query->set_404();
		status_header( 404 );
		nocache_headers();
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
