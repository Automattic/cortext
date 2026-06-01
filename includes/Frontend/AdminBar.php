<?php
/**
 * Hides the WordPress admin bar on public Cortext pages.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Frontend;

use Cortext\PostType\Document;

final class AdminBar {

	public function register(): void {
		add_filter( 'show_admin_bar', array( $this, 'hide_on_public_document_pages' ) );
	}

	public function hide_on_public_document_pages( bool $show ): bool {
		if ( is_singular( Document::POST_TYPE ) ) {
			return false;
		}

		return $show;
	}
}
