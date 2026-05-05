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
				return wp_json_encode(
					array(
						'type'  => 'emoji',
						'value' => $emoji,
					)
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
		}

		return '';
	}
}
