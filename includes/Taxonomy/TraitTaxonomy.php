<?php
/**
 * Registers the `crtxt_trait` taxonomy and keeps a mirror term for every
 * `crtxt_document` that defines a trait (is a collection).
 *
 * Trait is a single concept stored in two complementary forms:
 *
 * - the document (`crtxt_document` post) carries the rich definition: title,
 *   schema (fields list), body, icon, cover, settings;
 * - the term (`crtxt_trait` taxonomy) carries the applied form: documents
 *   are tagged with this term to say "this document has the trait" (= is a
 *   row of the collection).
 *
 * The mirror term is also the collection's identity: a document is a
 * collection precisely when its mirror term exists. Identity lives in the
 * term, not in a meta marker, so an empty collection (only the implicit
 * title, no custom fields) is still a collection.
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

defined( 'ABSPATH' ) || exit;

use Cortext\PostType\Document;
use WP_Post;

final class TraitTaxonomy {

	public const TAXONOMY = 'crtxt_trait';

	/**
	 * Manual order fallback for WorDBless test runs, which do not back
	 * `wp_term_relationships`. Keyed by `"{object_id}:{term_taxonomy_id}"`.
	 *
	 * @var array<string,int>
	 */
	private static array $wordbless_order = array();

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
		// When a document joins a collection (gains a trait term), append it to
		// the end of that collection's manual order. Membership arrives with the
		// term, so `set_object_terms` is the moment to assign the order.
		add_action( 'set_object_terms', array( $this, 'append_new_member_to_order' ), 10, 6 );
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
	 * Resolves the mirror term's `term_taxonomy_id` for a collection, or 0 when
	 * none exists. Manual row order is stored per (row, term_taxonomy_id) in
	 * `wp_term_relationships`, so order reads and writes key off this id, not the
	 * term id.
	 *
	 * @param int $trait_id Trait document id.
	 */
	public static function term_taxonomy_id_for_trait( int $trait_id ): int {
		$slug = self::term_slug_for_trait( $trait_id );
		$term = get_term_by( 'slug', $slug, self::TAXONOMY );
		return ( $term && ! is_wp_error( $term ) ) ? (int) $term->term_taxonomy_id : 0;
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
	 * Document ids of every collection. Each `crtxt_trait` term is a
	 * collection, so the term slugs (which are document ids) are the full list.
	 * `get_terms` is cached by WP, so callers can treat this as a single query.
	 *
	 * @return int[]
	 */
	public static function all_trait_ids(): array {
		$slugs = get_terms(
			array(
				'taxonomy'   => self::TAXONOMY,
				'hide_empty' => false,
				'fields'     => 'slugs',
			)
		);
		if ( is_wp_error( $slugs ) ) {
			return array();
		}
		return array_values(
			array_filter(
				array_map( array( self::class, 'trait_id_from_slug' ), $slugs ),
				static fn( int $id ): bool => $id > 0
			)
		);
	}

	/**
	 * Keeps the mirror term in step when `cortext_fields` gains values. A
	 * document that holds custom fields is a collection, so make sure its term
	 * exists. Empty/missing `cortext_fields` is not a downgrade signal: a
	 * collection with only the implicit title legitimately has no custom
	 * fields, and its term is created on designation (see
	 * `ensure_mirror_term`). Term removal happens only on permanent delete.
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
		$fields = get_post_meta( $post_id, 'cortext_fields', false );
		if ( is_array( $fields ) && count( $fields ) > 0 ) {
			$this->ensure_mirror_term( $post_id );
		}
	}

	/**
	 * Idempotently designates a document a collection by creating its mirror
	 * term (what rows attach to) and seeding its data-view block. The term is
	 * the collection's identity. Safe to call repeatedly. Never deletes here: a
	 * collection's term must survive field edits and trash so its rows stay
	 * attached; cleanup happens in `sync_term_on_delete` (permanent delete
	 * only).
	 *
	 * @param int $document_id Document post id.
	 */
	public function ensure_mirror_term( int $document_id ): void {
		if ( get_post_type( $document_id ) !== Document::POST_TYPE ) {
			return;
		}
		$slug = self::term_slug_for_trait( $document_id );
		if ( ! get_term_by( 'slug', $slug, self::TAXONOMY ) ) {
			wp_insert_term(
				self::term_name_for_trait( $document_id ),
				self::TAXONOMY,
				array( 'slug' => $slug )
			);
		}
		Document::seed_data_view_block( $document_id );
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

	/**
	 * Appends a document that just joined a collection to the end of that
	 * collection's manual order: a freshly created row should land after the
	 * existing rows, not before them.
	 *
	 * Order is scoped per (row, collection) and stored in the `term_order`
	 * column of `wp_term_relationships`, so the same row can hold an independent
	 * position in every collection it belongs to. Only acts when the gained
	 * relationship still carries the default `term_order` of 0, so it never
	 * overrides an order written by the manual-reorder seed or a drag.
	 *
	 * @param int    $object_id Document id that gained terms.
	 * @param array  $terms     Terms passed to wp_set_object_terms (unused).
	 * @param array  $tt_ids    Term taxonomy ids now assigned.
	 * @param string $taxonomy  Taxonomy the terms belong to.
	 * @param bool   $append    Whether the terms were appended (unused).
	 * @param array  $old_tt_ids Term taxonomy ids before the change.
	 */
	public function append_new_member_to_order( int $object_id, array $terms, array $tt_ids, string $taxonomy, bool $append, array $old_tt_ids ): void {
		unset( $terms, $append );
		if ( self::TAXONOMY !== $taxonomy ) {
			return;
		}
		// Only act on terms the document gained in this write; re-saving the same
		// membership must not reshuffle the order.
		$added = array_map( 'intval', array_diff( $tt_ids, $old_tt_ids ) );
		if ( count( $added ) === 0 ) {
			return;
		}
		$post = get_post( $object_id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return;
		}

		foreach ( $added as $term_taxonomy_id ) {
			// A freshly attached relationship starts at term_order 0; leave any
			// non-zero position (seed or drag) untouched.
			if ( 0 !== self::member_order( $object_id, $term_taxonomy_id ) ) {
				continue;
			}
			$max_order = self::max_member_order( $term_taxonomy_id, $object_id );
			self::set_member_order( $object_id, $term_taxonomy_id, $max_order + 100 );
		}
	}

	/**
	 * Reads a member's manual order within one collection, i.e. the `term_order`
	 * of the (row, trait term) relationship. Returns 0 when the relationship has
	 * no explicit order yet.
	 *
	 * @param int $object_id        Row document id.
	 * @param int $term_taxonomy_id Collection mirror term's term_taxonomy_id.
	 */
	public static function member_order( int $object_id, int $term_taxonomy_id ): int {
		if ( self::is_wordbless_active() ) {
			return self::$wordbless_order[ "{$object_id}:{$term_taxonomy_id}" ] ?? 0;
		}

		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Single relationship read scoped by primary-key columns.
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT term_order FROM {$wpdb->term_relationships} WHERE object_id = %d AND term_taxonomy_id = %d",
				$object_id,
				$term_taxonomy_id
			)
		);
	}

	/**
	 * Writes a member's manual order within one collection into the `term_order`
	 * column of its (row, trait term) relationship.
	 *
	 * @param int $object_id        Row document id.
	 * @param int $term_taxonomy_id Collection mirror term's term_taxonomy_id.
	 * @param int $order            Order value to store.
	 */
	public static function set_member_order( int $object_id, int $term_taxonomy_id, int $order ): bool {
		if ( self::is_wordbless_active() ) {
			self::$wordbless_order[ "{$object_id}:{$term_taxonomy_id}" ] = $order;
			return true;
		}

		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Single relationship write scoped by primary-key columns.
		$updated = $wpdb->update(
			$wpdb->term_relationships,
			array( 'term_order' => $order ),
			array(
				'object_id'        => $object_id,
				'term_taxonomy_id' => $term_taxonomy_id,
			),
			array( '%d' ),
			array( '%d', '%d' )
		);
		return false !== $updated;
	}

	/**
	 * Highest `term_order` among the rows already in a collection, found through
	 * the collection's shared trait term taxonomy id.
	 *
	 * @param int $term_taxonomy_id Trait term taxonomy id.
	 * @param int $exclude_post_id  Document to exclude (the one being added).
	 */
	public static function max_member_order( int $term_taxonomy_id, int $exclude_post_id ): int {
		if ( self::is_wordbless_active() ) {
			$max = 0;
			foreach ( self::$wordbless_order as $key => $order ) {
				$parts = explode( ':', (string) $key );
				if ( 2 !== count( $parts ) ) {
					continue;
				}
				$object_id = (int) $parts[0];
				$tt_id     = (int) $parts[1];
				if ( $tt_id === $term_taxonomy_id && $object_id !== $exclude_post_id ) {
					$max = max( $max, (int) $order );
				}
			}
			return $max;
		}

		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- One aggregate read during insert; loading every member relationship would be far heavier.
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE(MAX(tr.term_order), 0)
				FROM {$wpdb->term_relationships} tr
				INNER JOIN {$wpdb->posts} p ON p.ID = tr.object_id
				WHERE tr.term_taxonomy_id = %d
				AND p.post_status IN ('draft', 'private', 'publish')
				AND p.ID != %d",
				$term_taxonomy_id,
				$exclude_post_id
			)
		);
	}

	/**
	 * Clears the WorDBless manual-order fallback between test cases. No effect
	 * outside WorDBless, where order lives in `wp_term_relationships`.
	 */
	public static function reset_wordbless_order(): void {
		self::$wordbless_order = array();
	}

	private static function is_wordbless_active(): bool {
		return defined( 'WP_REPAIRING' ) && WP_REPAIRING && class_exists( '\WorDBless\Posts' );
	}
}
