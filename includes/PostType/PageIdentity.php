<?php
/**
 * Per-page icon (emoji or uploaded image) for `crtxt_page`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

final class PageIdentity {

	/**
	 * Stored as a JSON string. Two shapes:
	 *   - emoji: {"type":"emoji","value":"📘"}
	 *   - image: {"type":"image","id":123}
	 * Empty string means no icon (each surface picks its own fallback).
	 *
	 * Single key keeps the registration simple and lets the React shell
	 * branch on `type` at the read site rather than juggling two parallel
	 * meta fields.
	 */
	public const META_KEY = 'cortext_page_icon';

	public function register(): void {
		add_action( 'init', array( $this, 'register_meta' ) );
		// Bake the locked header blocks into post_content on create so
		// they exist from the very first render. Without this the React
		// shell ends up auto-inserting them after the editor mounts,
		// which Gutenberg treats as freshly-inserted blocks and animates
		// in — visible on first open as a slide/fade.
		add_filter( 'wp_insert_post_data', array( $this, 'prepend_header_blocks' ), 10, 2 );
	}

	/**
	 * Returns the canonical locked-header block markup that should sit
	 * at the top of every `crtxt_page`. Used by the seeder for direct
	 * inserts and by the wp_insert_post_data filter below.
	 */
	public static function header_blocks_markup(): string {
		$lock = array(
			'lock' => array(
				'move'   => true,
				'remove' => true,
			),
		);

		$blocks = array(
			array(
				'blockName'    => 'cortext/page-header-actions',
				'attrs'        => $lock,
				'innerBlocks'  => array(),
				'innerHTML'    => '',
				'innerContent' => array(),
			),
			array(
				'blockName'    => 'core/post-title',
				'attrs'        => $lock,
				'innerBlocks'  => array(),
				'innerHTML'    => '',
				'innerContent' => array(),
			),
		);

		return serialize_blocks( $blocks );
	}

	/**
	 * Prepends the locked header blocks to post_content when a new
	 * `crtxt_page` is created, unless they're already present. Skips
	 * updates so we don't double-prepend on re-saves.
	 *
	 * @param array $data    Slashed post data about to be inserted.
	 * @param array $postarr Original input passed to wp_insert_post.
	 */
	public function prepend_header_blocks( array $data, array $postarr ): array {
		if ( Page::POST_TYPE !== ( $data['post_type'] ?? '' ) ) {
			return $data;
		}
		// Only fire on create; updates always carry an `ID`.
		if ( ! empty( $postarr['ID'] ) ) {
			return $data;
		}

		$content = (string) ( $data['post_content'] ?? '' );
		// Already has the header markers? Leave it alone — the seeder
		// pre-prepends them, and other paths might too.
		if (
			str_contains( $content, '<!-- wp:cortext/page-header-actions' ) ||
			str_contains( $content, '<!-- wp:core/post-title' )
		) {
			return $data;
		}

		$data['post_content'] = wp_slash( self::header_blocks_markup() ) . $content;

		return $data;
	}

	public function register_meta(): void {
		register_post_meta(
			Page::POST_TYPE,
			self::META_KEY,
			array(
				'type'              => 'string',
				'single'            => true,
				'default'           => '',
				'show_in_rest'      => true,
				'auth_callback'     => static function () {
					return current_user_can( 'edit_posts' );
				},
				'sanitize_callback' => array( $this, 'sanitize' ),
			)
		);
	}

	/**
	 * Validates the JSON shape and returns a canonical JSON string. Anything
	 * we don't recognise collapses to '' so a malformed write reverts the
	 * surface to its fallback rather than persisting garbage.
	 *
	 * @param mixed $value Raw meta value coming in from REST or PHP.
	 */
	public function sanitize( $value ): string {
		if ( ! is_string( $value ) || '' === $value ) {
			return '';
		}

		$decoded = json_decode( $value, true );
		if ( ! is_array( $decoded ) || empty( $decoded['type'] ) ) {
			return '';
		}

		switch ( $decoded['type'] ) {
			case 'emoji':
				$emoji = isset( $decoded['value'] ) ? (string) $decoded['value'] : '';
				// Accept any non-empty short string; emoji clusters can be
				// multiple code points (skin tone modifiers, ZWJ sequences).
				// Cap to 16 chars to keep meta storage bounded.
				if ( '' === $emoji || mb_strlen( $emoji ) > 16 ) {
					return '';
				}
				// JSON_UNESCAPED_UNICODE keeps emoji as literal characters
				// in the stored value. Without it, wp_json_encode emits
				// `\uXXXX` surrogate-pair escapes, and any wp_slash along
				// the REST path doubles the backslashes — by the time JS
				// parses the meta the escapes never reconstitute and the
				// emoji renders as raw text.
				return wp_json_encode(
					array(
						'type'  => 'emoji',
						'value' => $emoji,
					),
					JSON_UNESCAPED_UNICODE
				);

			case 'image':
				$id = isset( $decoded['id'] ) ? (int) $decoded['id'] : 0;
				if ( $id <= 0 ) {
					return '';
				}
				return wp_json_encode(
					array(
						'type' => 'image',
						'id'   => $id,
					)
				);

			case 'wp':
				$name = isset( $decoded['name'] ) ? (string) $decoded['name'] : '';
				// `@wordpress/icons` exports use camelCase or single-word
				// names. Restrict to letters/digits to keep meta clean.
				if ( '' === $name || ! preg_match( '/^[a-zA-Z][a-zA-Z0-9]*$/', $name ) ) {
					return '';
				}
				$payload = array(
					'type' => 'wp',
					'name' => $name,
				);
				// Optional color, restricted to the named palette the
				// React picker exposes. `default` is treated as absent.
				$allowed_colors = array(
					'gray',
					'brown',
					'orange',
					'yellow',
					'green',
					'blue',
					'purple',
					'pink',
					'red',
				);
				$color          = isset( $decoded['color'] ) ? (string) $decoded['color'] : '';
				if ( '' !== $color && in_array( $color, $allowed_colors, true ) ) {
					$payload['color'] = $color;
				}
				return wp_json_encode( $payload );
		}

		return '';
	}
}
