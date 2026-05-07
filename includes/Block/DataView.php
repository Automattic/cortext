<?php
/**
 * Server-side registration and rendering for the cortext/data-view block.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Block;

use Cortext\PostType\Collection;

final class DataView {

	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	public function register_block(): void {
		register_block_type(
			CORTEXT_PATH . 'build/blocks/data-view',
			array(
				'render_callback' => array( $this, 'render' ),
			)
		);
	}

	/**
	 * Renders the data-view block on the public frontend.
	 *
	 * Outputs a container div with the block attributes as inline JSON.
	 * The frontend JS hydrates an interactive DataViews instance into it.
	 *
	 * @param array  $attributes Block attributes.
	 * @param string $content    Inner block content (unused).
	 * @return string HTML output.
	 */
	public function render( array $attributes, string $content ): string {
		$collection_id = $attributes['collectionId'] ?? 0;
		if ( ! $collection_id ) {
			return '';
		}

		$collection = get_post( $collection_id );
		if ( ! $collection || Collection::POST_TYPE !== $collection->post_type ) {
			return '';
		}

		if ( 'publish' !== $collection->post_status ) {
			return '';
		}

		$this->enqueue_assets();

		$init_data = wp_json_encode(
			array(
				'collectionId' => $collection_id,
				'view'         => $attributes['view'] ?? array(),
			)
		);

		$wrapper_attributes = get_block_wrapper_attributes(
			array( 'data-cortext-data-view' => '' )
		);

		return sprintf(
			'<div %s><script type="application/json" class="cortext-dv-init">%s</script></div>',
			$wrapper_attributes,
			$init_data
		);
	}

	private function enqueue_assets(): void {
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
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'cortext-frontend',
			CORTEXT_URL . 'build/frontend.css',
			array( 'wp-block-library', 'wp-components' ),
			$asset['version']
		);
	}
}
