<?php
/**
 * Server-side registration and rendering for the cortext/data-view block.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Block;

defined( 'ABSPATH' ) || exit;

use Cortext\Frontend\Assets;
use Cortext\PostType\Document;
use Cortext\Rest\CollectionsController;
use WP_Block;

final class DataView {

	public const BLOCK_NAME = 'cortext/data-view';

	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	public function register_block(): void {
		$block_path = CORTEXT_PATH . 'build/blocks/data-view';
		if ( ! is_readable( $block_path . '/block.json' ) ) {
			$block_path = CORTEXT_PATH . 'src/blocks/data-view';
		}

		register_block_type(
			$block_path,
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
	 * @param array         $attributes Block attributes.
	 * @param string        $content    Inner block content (unused).
	 * @param WP_Block|null $block      Block instance, for the post context.
	 * @return string HTML output.
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundBeforeLastUsed
	public function render( array $attributes, string $content, ?WP_Block $block = null ): string {
		$collection_id = $attributes['collectionId'] ?? 0;
		if ( ! $collection_id ) {
			return '';
		}

		$collection = get_post( $collection_id );
		if ( ! $collection || ! Document::is_collection_post( $collection ) ) {
			return '';
		}

		if ( 'publish' !== $collection->post_status ) {
			return '';
		}

		Assets::enqueue_frontend_runtime();

		// Escape <, >, and & so a `view` attribute containing `</script>` can't
		// break out of the inline JSON island below.
		$init_data = wp_json_encode(
			array(
				'collectionId' => $collection_id,
				'view'         => $this->public_view( $attributes, $block ),
			),
			JSON_HEX_TAG | JSON_HEX_AMP
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

	/**
	 * The view a visitor sees: the active named view. The collection's owner
	 * block keeps its views in collection meta; other blocks keep them in
	 * their attributes. Blocks saved before named views fall back to their
	 * single `view` attribute.
	 *
	 * @param array         $attributes Block attributes.
	 * @param WP_Block|null $block      Block instance, for the post context.
	 * @return array
	 */
	private function public_view( array $attributes, ?WP_Block $block ): array {
		$collection_id = (int) $attributes['collectionId'];
		$post_id       = (int) ( $block->context['postId'] ?? 0 );
		$controller    = new CollectionsController();

		$view = $collection_id === $post_id
			? $controller->stored_active_view( $collection_id )
			: $controller->active_view_from_config( $attributes );

		return $view ?? $attributes['view'] ?? array();
	}
}
