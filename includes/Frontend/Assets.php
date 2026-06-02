<?php
/**
 * Enqueues styles for public-facing Cortext pages.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Frontend;

use Cortext\PostType\Document;

final class Assets {

	public function register(): void {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
	}

	public function enqueue(): void {
		if ( ! is_singular( Document::POST_TYPE ) ) {
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

	/**
	 * Enqueues the public frontend runtime (script + style) from a block
	 * render callback. The page-level `enqueue()` already adds the style on
	 * singular documents, but the script only ships where a block needs it
	 * (the data-view block, or a WordPress-icon variant that hydrates its
	 * glyph). Safe to call more than once; WordPress dedupes by handle.
	 */
	public static function enqueue_frontend_runtime(): void {
		$asset_path = CORTEXT_PATH . 'build/frontend.asset.php';
		$asset      = file_exists( $asset_path )
			? require $asset_path
			: array(
				'dependencies' => array(),
				'version'      => CORTEXT_VERSION,
			);

		wp_enqueue_script(
			'cortext-frontend',
			CORTEXT_URL . 'build/frontend.js',
			$asset['dependencies'] ?? array(),
			$asset['version'] ?? CORTEXT_VERSION,
			true
		);

		wp_enqueue_style(
			'cortext-frontend',
			CORTEXT_URL . 'build/frontend.css',
			array( 'wp-block-library', 'wp-components' ),
			$asset['version'] ?? CORTEXT_VERSION
		);
	}
}
