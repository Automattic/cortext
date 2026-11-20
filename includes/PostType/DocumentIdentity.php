<?php
/**
 * Per-document icon (emoji or uploaded image) for any post type that opts into
 * the `cortext-document` capability, plus the server-seeded header blocks:
 * every document is created with the locked title and properties blocks.
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

use Cortext\Editor\DocumentPropertiesBlock;

final class DocumentIdentity {

	/**
	 * Lock shared by the header blocks so they cannot be moved or removed.
	 */
	private const HEADER_LOCK = array(
		'move'   => true,
		'remove' => true,
	);

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
		// Add the locked title and properties blocks on create so the first
		// editor render already has them. Every document carries the
		// properties block, so joining or leaving a collection never has to
		// rewrite the content; outside a collection it renders nothing.
		add_filter( 'wp_insert_post_data', array( $this, 'prepend_header_blocks' ), 10, 2 );
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
				'auth_callback'     => static function () {
					return current_user_can( 'edit_posts' );
				},
				'sanitize_callback' => array( self::class, 'sanitize' ),
			)
		);
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
			'lock'  => self::HEADER_LOCK,
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
	 * Returns the locked `cortext/document-properties` block markup that sits
	 * right after the title on rows.
	 */
	public static function properties_block_markup(): string {
		return serialize_block(
			array(
				'blockName'    => DocumentPropertiesBlock::BLOCK_NAME,
				'attrs'        => array( 'lock' => self::HEADER_LOCK ),
				'innerBlocks'  => array(),
				'innerHTML'    => '',
				'innerContent' => array(),
			)
		);
	}

	/**
	 * Adds the properties block right after the title, leaving the rest of the
	 * content as stored. Content without a title gets both. Writers that skip
	 * `wp_insert_post` or replace a document's content build it with this.
	 *
	 * @param string $content Unslashed post content.
	 */
	public static function with_properties_block( string $content ): string {
		if ( has_block( DocumentPropertiesBlock::BLOCK_NAME, $content ) ) {
			return $content;
		}
		$title_end = self::title_block_end( $content );
		if ( null === $title_end ) {
			return self::header_blocks_markup() . self::properties_block_markup() . $content;
		}
		return substr( $content, 0, $title_end ) . self::properties_block_markup() . substr( $content, $title_end );
	}

	/**
	 * Byte offset right after the first `core/post-title` block in serialized
	 * content, or null when there is none. Splicing at this offset leaves the
	 * rest of the content byte for byte as stored.
	 *
	 * The serializer escapes `--` inside block attributes, so the first `-->`
	 * after the opener always closes the block comment.
	 *
	 * @param string $content Unslashed post content.
	 */
	private static function title_block_end( string $content ): ?int {
		if ( ! preg_match( '#<!--\s+wp:(?:core/)?post-title(?=[\s/]).*?(/)?-->#s', $content, $opener, PREG_OFFSET_CAPTURE ) ) {
			return null;
		}
		$opener_end = $opener[0][1] + strlen( $opener[0][0] );
		if ( ! empty( $opener[1][0] ) ) {
			return $opener_end;
		}
		if ( ! preg_match( '#<!--\s+/wp:(?:core/)?post-title\s+-->#', $content, $closer, PREG_OFFSET_CAPTURE, $opener_end ) ) {
			return null;
		}
		return $closer[0][1] + strlen( $closer[0][0] );
	}

	/**
	 * Adds the locked title and properties blocks to new Cortext documents,
	 * keeping whichever of them the content already has. Updates return
	 * unchanged.
	 *
	 * @param array $data    Slashed post data about to be inserted.
	 * @param array $postarr Original input passed to wp_insert_post.
	 */
	public function prepend_header_blocks( array $data, array $postarr ): array {
		$post_type = (string) ( $data['post_type'] ?? '' );
		if ( '' === $post_type || ! post_type_supports( $post_type, 'cortext-document' ) ) {
			return $data;
		}

		// Only seed on create; updates always carry an `ID`.
		if ( ! empty( $postarr['ID'] ) ) {
			return $data;
		}

		$content = wp_unslash( (string) ( $data['post_content'] ?? '' ) );
		$next    = self::with_properties_block( $content );
		if ( null === self::title_block_end( $next ) ) {
			$next = self::header_blocks_markup() . $next;
		}
		if ( $next !== $content ) {
			$data['post_content'] = wp_slash( $next );
		}

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
