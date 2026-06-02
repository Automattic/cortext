<?php
/**
 * Server-side registration and frontend render for the
 * `cortext/document-icon` block.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

use Cortext\Frontend\Assets;
use Cortext\PostType\DocumentIdentity;

final class DocumentIconBlock {

	public const BLOCK_NAME = 'cortext/document-icon';

	/**
	 * Named icon colors to CSS, mirroring `src/components/iconColors.js`. The
	 * `wp` glyph hydrates with `currentColor`, so the span's color flows in.
	 */
	private const ICON_COLOR_CSS = array(
		'gray'   => '#9ca3af',
		'brown'  => '#92400e',
		'orange' => '#f97316',
		'yellow' => '#eab308',
		'green'  => '#22c55e',
		'blue'   => '#3b82f6',
		'purple' => '#a855f7',
		'pink'   => '#ec4899',
		'red'    => '#ef4444',
	);

	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	public function register_block(): void {
		register_block_type(
			self::BLOCK_NAME,
			array(
				'api_version'     => 3,
				'title'           => __( 'Document icon', 'cortext' ),
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
	 * Frontend render: emits the emoji span or `<img>` for the document icon
	 * meta. Returns an empty string when the block is rendered outside a
	 * document context or the meta is empty, so themes don't have to guard.
	 *
	 * @param array  $attributes Block attributes (unused; meta is the source of truth).
	 * @param string $content    Inner HTML (none; block is dynamic).
	 * @param object $block      Parsed block instance, carrying context.
	 */
	public function render( $attributes, $content, $block ): string {
		$post_id = isset( $block->context['postId'] ) ? (int) $block->context['postId'] : 0;
		if ( $post_id <= 0 ) {
			return '';
		}

		$raw = (string) get_post_meta( $post_id, DocumentIdentity::META_KEY, true );
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
					'<div class="cortext-document-icon-block"><span class="cortext-document-icon cortext-document-icon--emoji" aria-hidden="true">%s</span></div>',
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
					array( 'class' => 'cortext-document-icon cortext-document-icon--image' )
				);
				if ( '' === $img ) {
					return '';
				}
				return '<div class="cortext-document-icon-block">' . $img . '</div>';

			case 'wp':
				// @wordpress/icons is JS-only, so the glyph isn't available in
				// PHP. Emit a marker carrying the icon name (and color) and let
				// the frontend runtime hydrate the SVG into it. Enqueue that
				// runtime here so it loads on pages that have no data-view block.
				$name = isset( $decoded['name'] ) ? (string) $decoded['name'] : '';
				if ( '' === $name ) {
					return '';
				}
				Assets::enqueue_frontend_runtime();
				$color = isset( $decoded['color'] ) ? (string) $decoded['color'] : '';
				$style = isset( self::ICON_COLOR_CSS[ $color ] )
					? sprintf( ' style="color:%s"', esc_attr( self::ICON_COLOR_CSS[ $color ] ) )
					: '';
				return sprintf(
					'<div class="cortext-document-icon-block"><span class="cortext-document-icon cortext-document-icon--wp" data-icon="%s"%s aria-hidden="true"></span></div>',
					esc_attr( $name ),
					$style
				);
		}

		return '';
	}
}
