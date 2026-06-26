<?php
/**
 * Per-document icon (emoji or uploaded image) for any post type that opts into
 * the `cortext-document` capability.
 *
 * `Document::register_post_type()` calls `register_for_post_type()` right after
 * `register_post_type()` so the `crtxt_document` type opts in. The helper stays
 * post-type-agnostic so any type that opts into the `cortext-document`
 * capability gets the icon.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

defined( 'ABSPATH' ) || exit;

final class DocumentIdentity {

	/**
	 * Stored as a JSON string. Three shapes:
	 *   - emoji: {"type":"emoji","value":"📘"}
	 *   - image: {"type":"image","id":123}
	 *   - wp: {"type":"wp","name":"home","color":"blue"}
	 * Empty string means no icon (each surface picks its own fallback).
	 *
	 * Single key keeps the registration simple and lets the React shell
	 * branch on `type` at the read site rather than juggling two parallel
	 * meta fields.
	 */
	public const META_KEY = 'cortext_document_icon';

	public function register(): void {
		// Add the locked title block on create so the first editor render
		// already has it.
		add_filter( 'wp_insert_post_data', array( $this, 'prepend_header_blocks' ), 10, 2 );
		add_filter( 'wp_post_revision_meta_keys', array( $this, 'revision_meta_keys' ), 10, 2 );
	}

	/**
	 * Opts a post type into the `cortext-document` capability and registers the
	 * document icon meta on it. `Document::register_post_type()` calls this
	 * right after `register_post_type()`; external callers should leave it
	 * alone.
	 *
	 * @param string $post_type Post type slug.
	 */
	public static function register_for_post_type( string $post_type ): void {
		add_post_type_support( $post_type, 'cortext-document' );
		register_post_meta(
			$post_type,
			self::META_KEY,
			array(
				'type'              => 'string',
				'single'            => true,
				'default'           => '',
				'show_in_rest'      => true,
				'revisions_enabled' => true,
				'auth_callback'     => static function () {
					return current_user_can( 'edit_posts' );
				},
				'sanitize_callback' => array( self::class, 'sanitize' ),
			)
		);
	}

	/**
	 * Revisions need to carry document identity alongside post content.
	 *
	 * Core includes registered revisioned meta such as the icon automatically,
	 * but covers use the protected `_thumbnail_id` key behind `featured_media`.
	 * Add it for Cortext documents so visual history and restore stay aligned.
	 *
	 * @param string[] $keys      Revisioned meta keys.
	 * @param string   $post_type Post type slug.
	 * @return string[]
	 */
	public function revision_meta_keys( array $keys, string $post_type ): array {
		if ( ! post_type_supports( $post_type, 'cortext-document' ) ) {
			return $keys;
		}

		$keys[] = self::META_KEY;
		$keys[] = '_thumbnail_id';

		return array_values( array_unique( $keys ) );
	}

	/**
	 * Returns the canonical locked title block markup that should sit
	 * at the top of every cortext document. Used by the seeder for direct
	 * inserts and by the wp_insert_post_data filter below.
	 *
	 * Note: prepending `core/post-title` to `post_content` makes the
	 * public template render the title twice (the_title + the block's
	 * own resolution of `post_title`). See tech-debt.md#td-public-title-double-render for the
	 * architectural fix that drops the block from content entirely.
	 */
	public static function header_blocks_markup(): string {
		$attrs = array(
			// Render the title as the page <h1>; the block defaults to <h2>.
			'level' => 1,
			'lock'  => array(
				'move'   => true,
				'remove' => true,
			),
		);

		$blocks = array(
			array(
				'blockName'    => 'core/post-title',
				'attrs'        => $attrs,
				'innerBlocks'  => array(),
				'innerHTML'    => '',
				'innerContent' => array(),
			),
		);

		return serialize_blocks( $blocks );
	}

	/**
	 * Adds the locked title block to new Cortext documents unless the content
	 * already has one. Updates return unchanged.
	 *
	 * @param array $data    Slashed post data about to be inserted.
	 * @param array $postarr Original input passed to wp_insert_post.
	 */
	public function prepend_header_blocks( array $data, array $postarr ): array {
		$post_type = (string) ( $data['post_type'] ?? '' );
		if ( '' === $post_type || ! post_type_supports( $post_type, 'cortext-document' ) ) {
			return $data;
		}

		// Only prepend the title on create; updates always carry an `ID`.
		if ( ! empty( $postarr['ID'] ) ) {
			return $data;
		}

		$content = (string) ( $data['post_content'] ?? '' );
		// Already has the title marker? Leave it alone; the seeder
		// may have added it first, and other paths might too.
		if (
			str_contains( $content, '<!-- wp:post-title' ) ||
			str_contains( $content, '<!-- wp:core/post-title' )
		) {
			return $data;
		}

		$data['post_content'] = wp_slash( self::header_blocks_markup() ) . $content;

		return $data;
	}

	/**
	 * Validates the JSON shape and returns a canonical JSON string. Anything
	 * we don't recognise collapses to '' so a malformed write reverts the
	 * surface to its fallback rather than persisting garbage.
	 *
	 * @param mixed $value Raw meta value coming in from REST or PHP.
	 */
	public static function sanitize( $value ): string {
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
				// the REST path doubles the backslashes. By the time JS
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
