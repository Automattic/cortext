<?php
/**
 * Refreshes Cortext mention anchors on public renders.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Frontend;

defined( 'ABSPATH' ) || exit;

use Cortext\Mention\Mention;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Post;

final class MentionRenderer {

	private const ICON_COLORS = array(
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
		add_filter( 'the_content', array( $this, 'refresh_mentions' ), 12 );
	}

	public function refresh_mentions( string $content ): string {
		if ( ! str_contains( $content, Mention::ATTRIBUTE ) ) {
			return $content;
		}

		$ids = $this->extract_ids( $content );
		if ( count( $ids ) > 0 && function_exists( '_prime_post_caches' ) ) {
			_prime_post_caches( $ids, true, true );
		}

		// The rewritten title and icon depend on the current viewer's read
		// access (see can_render_target). Output is therefore per-user; a
		// full-page cache that stores a privileged render and serves it to
		// anonymous visitors could expose private mention titles.
		//
		// Matches Cortext-generated mention anchors only. The inner `.*?` and
		// `[^>]*` assume well-formed anchors with no `>` inside attribute
		// values, which holds for markup this plugin emits.
		$pattern = '#<a\b(?=[^>]*\b' . Mention::ATTRIBUTE . '=(["\'])(?P<id>\d+)\1)[^>]*>(?P<inner>.*?)</a>#is';
		$next    = preg_replace_callback(
			$pattern,
			array( $this, 'replace_anchor' ),
			$content
		);

		return is_string( $next ) ? $next : $content;
	}

	/**
	 * Extracts distinct target ids from mention anchors.
	 *
	 * @param string $content Rendered HTML content.
	 * @return int[]
	 */
	private function extract_ids( string $content ): array {
		if ( ! preg_match_all( Mention::ID_PATTERN, $content, $matches ) ) {
			return array();
		}

		$ids = array_map( 'intval', $matches[2] );
		$ids = array_filter(
			$ids,
			static fn( int $id ): bool => $id > 0
		);
		return array_values( array_unique( $ids ) );
	}

	/**
	 * Replaces one mention anchor with fresh target markup.
	 *
	 * @param array<string,string> $matches Regex matches.
	 */
	private function replace_anchor( array $matches ): string {
		$id       = (int) ( $matches['id'] ?? 0 );
		$snapshot = wp_strip_all_tags( (string) ( $matches['inner'] ?? '' ) );
		$post     = get_post( $id );

		if ( ! $this->can_render_target( $post, $id ) ) {
			return sprintf(
				'<span class="cortext-mention cortext-mention--missing">%s</span>',
				esc_html( $snapshot )
			);
		}

		$title = get_the_title( $post );
		if ( '' === trim( $title ) ) {
			$title = __( '(untitled)', 'cortext' );
		}

		return sprintf(
			'<a class="cortext-mention" data-crtxt-mention="%1$d"%2$s data-crtxt-path="%3$s" href="%4$s">%5$s</a>',
			$id,
			$this->icon_attributes( $post ),
			esc_attr( $this->path_for( $post ) ),
			esc_url( get_permalink( $post ) ),
			esc_html( $title )
		);
	}

	private function path_for( WP_Post $post ): string {
		$slug = trim( (string) $post->post_name );
		return '' === $slug ? (string) $post->ID : "{$slug}-{$post->ID}";
	}

	private function icon_attributes( WP_Post $post ): string {
		$raw     = $this->icon_meta_for( $post );
		$decoded = json_decode( $raw, true );

		if ( is_array( $decoded ) ) {
			if ( 'emoji' === ( $decoded['type'] ?? '' ) && is_string( $decoded['value'] ?? null ) && '' !== $decoded['value'] ) {
				return sprintf(
					' data-crtxt-icon-emoji="%s"',
					esc_attr( (string) $decoded['value'] )
				);
			}

			if ( 'image' === ( $decoded['type'] ?? '' ) ) {
				$image_id = (int) ( $decoded['id'] ?? 0 );
				$url      = '';
				if ( $image_id > 0 ) {
					$url = wp_get_attachment_image_url( $image_id, 'thumbnail' );
					if ( ! $url ) {
						$url = wp_get_attachment_url( $image_id );
					}
				}
				if ( $url ) {
					return sprintf(
						' data-crtxt-icon-image="true" style="--cortext-mention-icon-image: url(\'%s\');"',
						esc_url( $url )
					);
				}
			}

			if ( 'wp' === ( $decoded['type'] ?? '' ) && is_string( $decoded['name'] ?? null ) && '' !== $decoded['name'] ) {
				$color = is_string( $decoded['color'] ?? null ) ? (string) $decoded['color'] : '';
				$style = isset( self::ICON_COLORS[ $color ] )
					? ' style="--cortext-mention-icon-color: ' . esc_attr( self::ICON_COLORS[ $color ] ) . ';"'
					: '';
				return sprintf(
					' data-crtxt-icon-wp="%1$s"%2$s',
					esc_attr( (string) $decoded['name'] ),
					$style
				);
			}
		}

		return '';
	}

	private function icon_meta_for( WP_Post $post ): string {
		$icon = (string) get_post_meta( $post->ID, DocumentIdentity::META_KEY, true );
		if ( '' !== $icon ) {
			return $icon;
		}
		if ( Document::is_collection_post( $post ) ) {
			return (string) wp_json_encode(
				array(
					'type' => 'wp',
					'name' => 'collection',
				)
			);
		}

		$terms = wp_get_object_terms( $post->ID, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) );
		if ( is_array( $terms ) && count( $terms ) > 0 ) {
			return (string) wp_json_encode(
				array(
					'type' => 'wp',
					'name' => 'listItem',
				)
			);
		}

		return '';
	}

	private function can_render_target( ?WP_Post $post, int $id ): bool {
		if ( ! $post instanceof WP_Post ) {
			return false;
		}
		if ( 'trash' === $post->post_status ) {
			return false;
		}
		if ( ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return false;
		}
		return current_user_can( 'read_post', $id );
	}
}
