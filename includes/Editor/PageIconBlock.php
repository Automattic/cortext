<?php
/**
 * Server-side registration and frontend render for the
 * `cortext/page-icon` block.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

use Cortext\PostType\PageIdentity;

final class PageIconBlock {

	public const BLOCK_NAME = 'cortext/page-icon';

	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	public function register_block(): void {
		register_block_type(
			self::BLOCK_NAME,
			array(
				'api_version'     => 3,
				'title'           => __( 'Page icon', 'cortext' ),
				'category'        => 'widgets',
				'icon'            => 'smiley',
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
	 * Frontend render: emits the emoji span or `<img>` for the page icon
	 * meta. Returns an empty string when the block is rendered outside a
	 * page context or the meta is empty, so themes don't have to guard.
	 *
	 * @param array  $attributes Block attributes (unused — meta is the source of truth).
	 * @param string $content    Inner HTML (none — block is dynamic).
	 * @param object $block      Parsed block instance, carrying context.
	 */
	public function render( $attributes, $content, $block ): string {
		$post_id = isset( $block->context['postId'] ) ? (int) $block->context['postId'] : 0;
		if ( $post_id <= 0 ) {
			return '';
		}

		$raw = (string) get_post_meta( $post_id, PageIdentity::META_KEY, true );
		if ( '' === $raw ) {
			return '';
		}

		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) || empty( $decoded['type'] ) ) {
			return '';
		}

		switch ( $decoded['type'] ) {
			case 'emoji':
				$emoji = isset( $decoded['value'] ) ? (string) $decoded['value'] : '';
				if ( '' === $emoji ) {
					return '';
				}
				return sprintf(
					'<div class="cortext-page-icon-block"><span class="cortext-page-icon cortext-page-icon--emoji" aria-hidden="true">%s</span></div>',
					esc_html( $emoji )
				);

			case 'image':
				$attachment_id = isset( $decoded['id'] ) ? (int) $decoded['id'] : 0;
				if ( $attachment_id <= 0 ) {
					return '';
				}
				$img = wp_get_attachment_image(
					$attachment_id,
					'thumbnail',
					false,
					array( 'class' => 'cortext-page-icon cortext-page-icon--image' )
				);
				if ( '' === $img ) {
					return '';
				}
				return '<div class="cortext-page-icon-block">' . $img . '</div>';

			case 'wp':
				// We don't ship the SVG markup server-side; @wordpress/icons
				// is JS-only. Emit a marker the frontend (or a future hydration
				// step) can fill in. Keeps published markup deterministic
				// even if the icon set isn't loaded.
				$name = isset( $decoded['name'] ) ? (string) $decoded['name'] : '';
				if ( '' === $name ) {
					return '';
				}
				return sprintf(
					'<div class="cortext-page-icon-block"><span class="cortext-page-icon cortext-page-icon--wp" data-icon="%s" aria-hidden="true"></span></div>',
					esc_attr( $name )
				);
		}

		return '';
	}
}
