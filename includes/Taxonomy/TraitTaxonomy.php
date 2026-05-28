<?php
/**
 * Registers the `crtxt_trait` taxonomy and keeps a mirror term for every
 * `crtxt_document` that defines a schema (has `cortext_fields` meta).
 *
 * Trait is a single concept stored in two complementary forms:
 *
 * - the document (`crtxt_document` post with `cortext_fields` meta) carries
 *   the rich definition: title, schema (fields list), body, icon, cover,
 *   settings;
 * - the term (`crtxt_trait` taxonomy) carries the applied form: documents
 *   are tagged with this term to say "this document has the trait" (= is a
 *   row of the collection).
 *
 * Both share the slug `crtxt_trait` because they refer to the same trait.
 * They do not collide because the document REST base is `crtxt_documents`
 * (plural) and the taxonomy REST base is `crtxt_trait` (singular).
 *
 * A "collection" is the emergent grouping of documents that share a trait
 * term. It has no first-class storage entity; it is the result of querying
 * `crtxt_document` filtered by trait membership. See
 * `docs/explorations/universal-document-model.md` ("Vocabulary: trait vs
 * collection") for the full distinction.
 *
 * The mirror term's slug is the deterministic document id (`{doc_id}`), so
 * renaming a collection does not require a sync.
 *
 * The class name `TraitTaxonomy` is a workaround: `trait` is a PHP reserved
 * keyword. The taxonomy slug stays `crtxt_trait`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Taxonomy;

use Cortext\PostType\Document;
use WP_Post;

final class TraitTaxonomy {

	public const TAXONOMY = 'crtxt_trait';

	public function register(): void {
		add_action( 'init', array( $this, 'register_taxonomy' ) );
		// A document becomes a collection when its `cortext_fields` meta has
		// at least one value. The mirror term is created/removed reactively
		// when that meta changes. Trashing still keeps the term so restores
		// keep their rows attached; permanent delete drops the term.
		add_action( 'added_post_meta', array( $this, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $this, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $this, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $this, 'sync_term_on_delete' ), 10, 2 );
	}

	public function register_taxonomy(): void {
		register_taxonomy(
			self::TAXONOMY,
			array( Document::POST_TYPE ),
			array(
				'labels'             => array(
					'name'          => __( 'Collections', 'cortext' ),
					'singular_name' => __( 'Collection', 'cortext' ),
				),
				'public'             => false,
				'publicly_queryable' => false,
				'hierarchical'       => false,
				'show_ui'            => false,
				'show_in_menu'       => false,
				'show_in_nav_menus'  => false,
				'show_in_rest'       => true,
				'rest_base'          => 'crtxt_trait',
				'show_admin_column'  => false,
				'show_tagcloud'      => false,
				'rewrite'            => false,
			)
		);
	}

	/**
	 * Returns the deterministic slug for a collection's mirror term.
	 *
	 * @param int $trait_id Trait document id.
	 */
	public static function term_slug_for_trait( int $trait_id ): string {
		return (string) $trait_id;
	}

	/**
	 * Returns the term name for a collection's mirror term. Names are stable
	 * and never sync from the document's `post_title`.
	 *
	 * @param int $trait_id Trait document id.
	 */
	public static function term_name_for_trait( int $trait_id ): string {
		return "Trait {$trait_id}";
	}

	/**
	 * Resolves the mirror term id for a collection, or 0 when none exists.
	 *
	 * @param int $trait_id Trait document id.
	 */
	public static function term_id_for_trait( int $trait_id ): int {
		$slug = self::term_slug_for_trait( $trait_id );
		$term = get_term_by( 'slug', $slug, self::TAXONOMY );
		return ( $term && ! is_wp_error( $term ) ) ? (int) $term->term_id : 0;
	}

	/**
	 * Resolves the collection document id from a term id.
	 *
	 * @param int $term_id Term id.
	 */
	public static function trait_id_for_term( int $term_id ): int {
		$term = get_term( $term_id, self::TAXONOMY );
		if ( ! $term || is_wp_error( $term ) ) {
			return 0;
		}
		return self::trait_id_from_slug( (string) $term->slug );
	}

	/**
	 * Extracts the collection document id from a term slug. Returns 0 when
	 * the slug does not match the expected numeric shape.
	 *
	 * @param string $slug Term slug, expected `<digits>`.
	 */
	public static function trait_id_from_slug( string $slug ): int {
		return ctype_digit( $slug ) ? (int) $slug : 0;
	}

	/**
	 * Ensures the mirror term state matches the document's collection status.
	 * Triggered whenever `cortext_fields` meta on a `crtxt_document` changes.
	 *
	 * @param int|array $meta_id    Meta id (or ids for delete).
	 * @param int       $post_id    Post id whose meta changed.
	 * @param string    $meta_key   Meta key that changed.
	 * @param mixed     $meta_value New meta value (unused; we read state from DB).
	 */
	public function sync_term_on_meta_change( $meta_id, $post_id, $meta_key, $meta_value ): void {
		unset( $meta_id, $meta_value );
		if ( 'cortext_fields' !== (string) $meta_key ) {
			return;
		}
		$post_id = (int) $post_id;
		if ( get_post_type( $post_id ) !== Document::POST_TYPE ) {
			return;
		}
		$this->ensure_mirror_term_state( $post_id );
	}

	/**
	 * Idempotently creates the mirror term when the document has the
	 * `cortext_fields` meta. Never deletes here: meta can be wiped and
	 * re-added in the same request (e.g. when reordering fields), and
	 * `wp_delete_term` would cascade-delete all row→collection relationships.
	 * Term cleanup happens in `sync_term_on_delete` (permanent delete only).
	 *
	 * @param int $document_id Document post id.
	 */
	public function ensure_mirror_term_state( int $document_id ): void {
		if ( ! Document::is_collection( $document_id ) ) {
			return;
		}
		$slug = self::term_slug_for_trait( $document_id );
		if ( get_term_by( 'slug', $slug, self::TAXONOMY ) ) {
			return;
		}
		wp_insert_term(
			self::term_name_for_trait( $document_id ),
			self::TAXONOMY,
			array( 'slug' => $slug )
		);
	}

	/**
	 * Removes the mirror term when a collection document is permanently
	 * deleted. Trash keeps the term so a later restore reattaches rows.
	 *
	 * @param int          $post_id Post id being deleted.
	 * @param WP_Post|null $post    Post object, or null when WP cannot resolve it.
	 */
	public function sync_term_on_delete( int $post_id, ?WP_Post $post = null ): void {
		if ( ! $post instanceof WP_Post ) {
			$post = get_post( $post_id );
		}
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return;
		}
		$term = get_term_by( 'slug', self::term_slug_for_trait( $post_id ), self::TAXONOMY );
		if ( $term && ! is_wp_error( $term ) ) {
			wp_delete_term( (int) $term->term_id, self::TAXONOMY );
		}
	}
}
