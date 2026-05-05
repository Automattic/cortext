<?php
/**
 * Server-side registration and frontend render for the
 * `cortext/page-cover` block.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

final class PageCoverBlock {

	public const BLOCK_NAME = 'cortext/page-cover';

	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	public function register_block(): void {
		register_block_type(
			self::BLOCK_NAME,
			array(
				'api_version'     => 3,
				'title'           => __( 'Page cover', 'cortext' ),
				'category'        => 'widgets',
				'icon'            => 'format-image',
				'uses_context'    => array( 'postId', 'postType' ),
				'supports'        => array(
					'html'     => false,
					'reusable' => false,
					'multiple' => false,
					'inserter' => false,
					'align'    => array( 'full' ),
				),
				'attributes'      => array(
					'align' => array(
						'type'    => 'string',
						'default' => 'full',
					),
				),
				'render_callback' => array( $this, 'render' ),
			)
		);
	}

	/**
	 * Frontend render: emits the post's featured image inside the same
	 * wrapper class the editor uses, so editor and frontend styles stay
	 * in sync. Returns an empty string when there's no featured image
	 * or no post context, so themes don't have to guard.
	 *
	 * @param array  $attributes Block attributes.
	 * @param string $content    Inner HTML (none — block is dynamic).
	 * @param object $block      Parsed block instance, carrying context.
	 */
	public function render( $attributes, $content, $block ): string {
		$post_id = isset( $block->context['postId'] ) ? (int) $block->context['postId'] : 0;
		if ( $post_id <= 0 || ! has_post_thumbnail( $post_id ) ) {
			return '';
		}

		$image = get_the_post_thumbnail(
			$post_id,
			'large',
			array( 'class' => 'cortext-page-cover-block__image' )
		);
		if ( '' === $image ) {
			return '';
		}

		$align_class = isset( $attributes['align'] ) && 'full' === $attributes['align']
			? 'alignfull'
			: '';
		$wrapper     = trim( 'cortext-page-cover-block ' . $align_class );

		return sprintf(
			'<figure class="%s">%s</figure>',
			esc_attr( $wrapper ),
			$image
		);
	}
}
