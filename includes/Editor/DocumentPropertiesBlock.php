<?php
/**
 * Server-side registration for the `cortext/document-properties` block.
 *
 * The render callback is intentionally empty for now. tech-debt.md#td-row-properties-public-render tracks
 * the public row markup. Register the block now so rows already store it in
 * `post_content`; the server render can come later without changing editor
 * wiring.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

defined( 'ABSPATH' ) || exit;

final class DocumentPropertiesBlock {

	public const BLOCK_NAME = 'cortext/document-properties';

	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	public function register_block(): void {
		register_block_type(
			self::BLOCK_NAME,
			array(
				'api_version'     => 3,
				'title'           => __( 'Document properties', 'cortext' ),
				'category'        => 'widgets',
				'icon'            => 'list-view',
				'uses_context'    => array( 'postId', 'postType' ),
				'supports'        => array(
					'html'     => false,
					'reusable' => false,
					'multiple' => false,
					'inserter' => false,
				),
				'render_callback' => array( $this, 'render' ),
			)
		);
	}

	/**
	 * Frontend render placeholder. Rows keep this block in `post_content`;
	 * tech-debt.md#td-row-properties-public-render tracks the public markup.
	 *
	 * @param array  $attributes Block attributes (unused).
	 * @param string $content    Inner HTML (none; block is dynamic).
	 * @param object $block      Parsed block instance, carrying context.
	 */
	public function render( $attributes, $content, $block ): string {
		unset( $attributes, $content, $block );
		return '';
	}
}
