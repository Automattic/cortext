<?php
/**
 * "Cortext media": attachments uploaded from inside Cortext.
 *
 * When an attachment is created with a Cortext document as its parent (the
 * editor and the cover/icon picker both upload to the active document), it
 * gets a private `cortext_media` term. The term records where the file came
 * from, so it is set once at upload and never recomputed. It stays set if the
 * attachment is later detached, reused in another document, or its original
 * document is trashed.
 *
 * The term scopes the two media pickers:
 *   - the inserter's Media tab (REST `/wp/v2/media`), via the `cortext_origin`
 *     param this class maps to a tax_query;
 *   - the wp.media modal for covers and icons, via the taxonomy `query_var`,
 *     which survives core's `query-attachments` whitelist.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Media;

use Cortext\PostType\Document;
use WP_Post;
use WP_REST_Request;

final class CortextMedia {

	public const TAXONOMY = 'cortext_media';
	public const TERM     = 'cortext';

	private const REST_PARAM = 'cortext_origin';

	public function register(): void {
		add_action( 'init', array( $this, 'register_taxonomy' ) );
		add_action( 'add_attachment', array( $this, 'tag_if_from_cortext' ) );
		add_filter( 'rest_attachment_query', array( $this, 'scope_inserter_query' ), 10, 2 );
		add_filter( 'rest_attachment_collection_params', array( $this, 'expose_param' ) );
	}

	/**
	 * Private taxonomy on attachments. `query_var` is what lets the wp.media
	 * modal scope its library: core whitelists attachment taxonomy query vars
	 * in `wp_ajax_query_attachments`, so `library: { cortext_media }` survives
	 * to the WP_Query.
	 */
	public function register_taxonomy(): void {
		register_taxonomy(
			self::TAXONOMY,
			'attachment',
			array(
				'public'            => false,
				'show_ui'           => false,
				'show_in_menu'      => false,
				'show_in_nav_menus' => false,
				'show_admin_column' => false,
				'show_in_rest'      => false,
				'hierarchical'      => false,
				'rewrite'           => false,
				'query_var'         => self::TAXONOMY,
			)
		);
	}

	/**
	 * Marks the origin term when a new attachment is parented to a Cortext
	 * document. Runs on every upload site-wide but bails cheaply (two cached
	 * reads) for anything not parented to a `crtxt_document`.
	 *
	 * @param int $attachment_id The new attachment's ID.
	 */
	public function tag_if_from_cortext( int $attachment_id ): void {
		$attachment = get_post( $attachment_id );
		if ( ! $attachment instanceof WP_Post ) {
			return;
		}

		$parent_id = (int) $attachment->post_parent;
		if ( $parent_id > 0 && Document::POST_TYPE === get_post_type( $parent_id ) ) {
			$this->tag( $attachment_id );
		}
	}

	/**
	 * Marks media that predates upload-time tagging: attachments parented to a
	 * document, document covers (featured images), and image icons. Idempotent,
	 * so it is safe to run repeatedly.
	 *
	 * @return array{documents:int,tagged:int}
	 */
	public function backfill(): array {
		$document_ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => array( 'publish', 'future', 'draft', 'pending', 'private', 'trash' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);

		$attachment_ids = array();
		foreach ( $document_ids as $document_id ) {
			$document_id = (int) $document_id;

			$children = get_posts(
				array(
					'post_type'      => 'attachment',
					'post_parent'    => $document_id,
					'post_status'    => 'inherit',
					'posts_per_page' => -1,
					'fields'         => 'ids',
				)
			);
			foreach ( $children as $child_id ) {
				$attachment_ids[ (int) $child_id ] = true;
			}

			$cover_id = (int) get_post_thumbnail_id( $document_id );
			if ( $cover_id > 0 ) {
				$attachment_ids[ $cover_id ] = true;
			}

			$icon_id = $this->icon_attachment_id( $document_id );
			if ( $icon_id > 0 ) {
				$attachment_ids[ $icon_id ] = true;
			}
		}

		$tagged = 0;
		foreach ( array_keys( $attachment_ids ) as $attachment_id ) {
			if ( 'attachment' === get_post_type( $attachment_id ) ) {
				$this->tag( $attachment_id );
				++$tagged;
			}
		}

		return array(
			'documents' => count( $document_ids ),
			'tagged'    => $tagged,
		);
	}

	/**
	 * Marks an attachment as Cortext media.
	 *
	 * @param int $attachment_id Attachment post ID.
	 */
	public function tag( int $attachment_id ): void {
		if ( 'attachment' !== get_post_type( $attachment_id ) ) {
			return;
		}

		wp_set_object_terms( $attachment_id, self::TERM, self::TAXONOMY );
	}

	/**
	 * Returns the attachment id from a document's image icon, or 0 when the
	 * icon is an emoji, a built-in icon, or empty. The image icon is stored as
	 * JSON: `{"type":"image","id":123}`.
	 *
	 * @param int $document_id Document post id.
	 * @return int
	 */
	private function icon_attachment_id( int $document_id ): int {
		$raw = (string) get_post_meta( $document_id, 'cortext_document_icon', true );
		if ( '' === $raw ) {
			return 0;
		}

		$decoded = json_decode( $raw, true );
		if ( is_array( $decoded ) && 'image' === ( $decoded['type'] ?? '' ) ) {
			return (int) ( $decoded['id'] ?? 0 );
		}

		return 0;
	}

	/**
	 * Limits the attachment REST collection to Cortext media when the inserter
	 * asks for it. Mapped to a tax_query (not the taxonomy query var) so the
	 * boolean param name never collides with the term lookup.
	 *
	 * @param array<string,mixed> $args    WP_Query args built for the request.
	 * @param WP_REST_Request     $request The REST request.
	 * @return array<string,mixed>
	 */
	public function scope_inserter_query( array $args, WP_REST_Request $request ): array {
		$requested = $request->get_param( self::REST_PARAM );
		if ( null === $requested || ! rest_sanitize_boolean( $requested ) ) {
			return $args;
		}

		$tax_query   = isset( $args['tax_query'] ) && is_array( $args['tax_query'] ) ? $args['tax_query'] : array();
		$tax_query[] = array(
			'taxonomy' => self::TAXONOMY,
			'field'    => 'slug',
			'terms'    => array( self::TERM ),
		);

		$args['tax_query'] = $tax_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
		return $args;
	}

	/**
	 * Declares the inserter param so REST schema introspection lists and
	 * accepts it.
	 *
	 * @param array<string,array<string,mixed>> $params Collection params.
	 * @return array<string,array<string,mixed>>
	 */
	public function expose_param( array $params ): array {
		$params[ self::REST_PARAM ] = array(
			'description' => __( 'Limit the result set to media uploaded from Cortext.', 'cortext' ),
			'type'        => 'boolean',
			'default'     => false,
		);
		return $params;
	}
}
