<?php
/**
 * Server-side registration for the `cortext/document-properties` block.
 *
 * The render callback returns an empty string for now: the public-page
 * pipeline for rows is tracked in tech-debt #42 and will fill this in
 * once row CPTs become publicly reachable. The block is registered now
 * so the editor-side block exists in `post_content` and the eventual
 * public render slots in without further JS plumbing.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

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
	 * Frontend render placeholder. Returns an empty string until the row
	 * public-render follow-up fills it in.
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
