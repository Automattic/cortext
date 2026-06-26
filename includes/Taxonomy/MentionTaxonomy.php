<?php
/**
 * Keeps a private taxonomy mirror of inline document mentions.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Taxonomy;

defined( 'ABSPATH' ) || exit;

use Cortext\Mention\Mention;
use Cortext\PostType\Document;
use WP_HTML_Tag_Processor;
use WP_Post;

final class MentionTaxonomy {

	public const TAXONOMY = 'crtxt_mention';

	public function register(): void {
		add_action( 'init', array( $this, 'register_taxonomy' ) );
		add_action( 'save_post_' . Document::POST_TYPE, array( $this, 'sync_mentions_on_save' ), 10, 3 );
		add_action( 'before_delete_post', array( $this, 'sync_term_on_delete' ), 10, 2 );
	}

	public function register_taxonomy(): void {
		register_taxonomy(
			self::TAXONOMY,
			array( Document::POST_TYPE ),
			array(
				'labels'             => array(
					'name'          => __( 'Mentions', 'cortext' ),
					'singular_name' => __( 'Mention', 'cortext' ),
				),
				'public'             => false,
				'publicly_queryable' => false,
				'hierarchical'       => false,
				'show_ui'            => false,
				'show_in_menu'       => false,
				'show_in_nav_menus'  => false,
				'show_in_rest'       => false,
				'show_admin_column'  => false,
				'show_tagcloud'      => false,
				'rewrite'            => false,
			)
		);
	}

	public static function term_slug_for_target( int $target_id ): string {
		return (string) $target_id;
	}

	public static function term_name_for_target( int $target_id ): string {
		return "Mention {$target_id}";
	}

	public static function term_id_for_target( int $target_id ): int {
		$term = get_term_by( 'slug', self::term_slug_for_target( $target_id ), self::TAXONOMY );
		return ( $term && ! is_wp_error( $term ) ) ? (int) $term->term_id : 0;
	}

	public static function target_id_from_slug( string $slug ): int {
		return ctype_digit( $slug ) ? (int) $slug : 0;
	}

	public function ensure_mirror_term( int $target_id ): int {
		$existing = self::term_id_for_target( $target_id );
		if ( $existing > 0 ) {
			return $existing;
		}

		$result = wp_insert_term(
			self::term_name_for_target( $target_id ),
			self::TAXONOMY,
			array( 'slug' => self::term_slug_for_target( $target_id ) )
		);
		if ( is_wp_error( $result ) ) {
			// Another save may have created the mirror term after the lookup
			// above. WP puts the existing id in `term_exists`; otherwise, look
			// it up by slug.
			$existing_id = (int) $result->get_error_data();
			return $existing_id > 0 ? $existing_id : self::term_id_for_target( $target_id );
		}
		return self::term_id_for_target( $target_id );
	}

	/**
	 * Finds the target document ids mentioned in post content.
	 *
	 * @param string $content Post content.
	 * @return int[]
	 */
	public static function extract_target_ids( string $content ): array {
		if ( ! str_contains( $content, Mention::ATTRIBUTE ) ) {
			return array();
		}

		$ids = array();
		if ( class_exists( WP_HTML_Tag_Processor::class ) ) {
			$processor = new WP_HTML_Tag_Processor( $content );
			while ( $processor->next_tag( array( 'tag_name' => 'a' ) ) ) {
				$value = $processor->get_attribute( Mention::ATTRIBUTE );
				if ( is_string( $value ) && ctype_digit( $value ) ) {
					$id = (int) $value;
					if ( $id > 0 ) {
						$ids[ $id ] = true;
					}
				}
			}
		} elseif ( preg_match_all( Mention::ID_PATTERN, $content, $matches ) ) {
			foreach ( $matches[2] as $raw_id ) {
				$id = (int) $raw_id;
				if ( $id > 0 ) {
					$ids[ $id ] = true;
				}
			}
		}

		return array_keys( $ids );
	}

	/**
	 * Counts how many times a target is mentioned in content.
	 *
	 * @param string $content   Post content.
	 * @param int    $target_id Target document id.
	 * @return int
	 */
	public static function count_target_mentions( string $content, int $target_id ): int {
		if ( $target_id <= 0 || ! str_contains( $content, Mention::ATTRIBUTE ) ) {
			return 0;
		}
		$pattern = '/' . preg_quote( Mention::ATTRIBUTE, '/' ) . '=(["\'])' . $target_id . '\1/';
		return (int) preg_match_all( $pattern, $content );
	}

	/**
	 * Updates mention terms when a document is saved.
	 *
	 * @param int     $post_id Document id.
	 * @param WP_Post $post    Saved document.
	 * @param bool    $update  Whether this is an existing post being updated.
	 */
	public function sync_mentions_on_save( int $post_id, WP_Post $post, bool $update ): void {
		unset( $update );

		if ( wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) ) {
			return;
		}
		if ( Document::POST_TYPE !== $post->post_type ) {
			return;
		}

		$this->sync_post( $post );
	}

	public function sync_term_on_delete( int $post_id, ?WP_Post $post = null ): void {
		if ( ! $post instanceof WP_Post ) {
			$post = get_post( $post_id );
		}
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return;
		}

		$term = get_term_by( 'slug', self::term_slug_for_target( $post_id ), self::TAXONOMY );
		if ( $term && ! is_wp_error( $term ) ) {
			wp_delete_term( (int) $term->term_id, self::TAXONOMY );
		}
	}

	/**
	 * Rebuilds the mention index for existing Cortext documents.
	 *
	 * @return array{documents:int,mentions:int}
	 */
	public function backfill(): array {
		$ids      = get_posts(
			array(
				'post_type'           => Document::POST_TYPE,
				'post_status'         => get_post_stati( array(), 'names' ),
				'posts_per_page'      => -1,
				'fields'              => 'ids',
				'ignore_sticky_posts' => true,
				'no_found_rows'       => true,
			)
		);
		$mentions = 0;
		foreach ( array_map( 'intval', $ids ) as $post_id ) {
			$post = get_post( $post_id );
			if ( $post instanceof WP_Post ) {
				$mentions += $this->sync_post( $post );
			}
		}

		return array(
			'documents' => count( $ids ),
			'mentions'  => $mentions,
		);
	}

	private function sync_post( WP_Post $post ): int {
		$target_ids = self::extract_target_ids( wp_unslash( (string) $post->post_content ) );
		$term_ids   = array();
		foreach ( $target_ids as $target_id ) {
			$target = get_post( $target_id );
			if ( ! $target instanceof WP_Post || Document::POST_TYPE !== $target->post_type ) {
				continue;
			}
			$term_id = $this->ensure_mirror_term( $target_id );
			if ( $term_id > 0 ) {
				$term_ids[] = $term_id;
			}
		}

		wp_set_object_terms(
			(int) $post->ID,
			array_values( array_unique( $term_ids ) ),
			self::TAXONOMY,
			false
		);

		return count( $term_ids );
	}
}
