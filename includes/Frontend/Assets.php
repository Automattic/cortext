<?php
/**
 * Enqueues styles for public-facing Cortext pages.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Frontend;

use Cortext\PostType\Page;

final class Assets {

	public function register(): void {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
	}

	public function enqueue(): void {
		if ( ! is_singular( Page::POST_TYPE ) ) {
			return;
		}

		// Core block styles (paragraphs, headings, images, lists, etc.).
		wp_enqueue_style( 'wp-block-library' );

		$asset_path = CORTEXT_PATH . 'build/frontend.asset.php';
		$version    = file_exists( $asset_path )
			? ( require $asset_path )['version'] ?? CORTEXT_VERSION
			: CORTEXT_VERSION;

		wp_enqueue_style(
			'cortext-frontend',
			CORTEXT_URL . 'build/frontend.css',
			array( 'wp-block-library', 'wp-components' ),
			$version
		);
	}
}
