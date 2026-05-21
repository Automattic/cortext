<?php
/**
 * Dynamically registers one CPT per published collection.
 *
 * Each `crtxt_collection` post produces a `crtxt_{slug}` post type
 * whose entries are the rows of that collection. Field-level post meta
 * is registered for each attached `crtxt_field`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

use Cortext\Fields\FieldTypeRegistry;
use Cortext\Relations;
use WP_Post;

final class CollectionEntries {

	/**
	 * Prefix for dynamically registered entry CPTs.
	 *
	 * WordPress enforces a 20-character limit on post type slugs, so dynamic
	 * row CPTs use the shared `crtxt_` prefix and leave 14 characters for the
	 * collection slug.
	 */
	public const CPT_PREFIX      = 'crtxt_';
	public const MAX_CPT_LEN     = 20;
	private const RESERVED_SLUGS = array(
		'collection',
		'collections',
		'field',
		'fields',
		'page',
		'pages',
	);

	/**
	 * Field IDs whose paired reverse deletion is already in progress.
	 *
	 * @var array<int,true>
	 */
	private static array $deleting_relation_fields = array();

	/**
	 * Maps dynamic entry post types to their source collection IDs.
	 *
	 * @var array<string,int>
	 */
	private static array $entry_collection_ids = array();

	/**
	 * Entry CPTs that already have the insert-order hook.
	 *
	 * @var array<string,true>
	 */
	private static array $menu_order_hooks = array();

	public static function is_reserved_slug( string $slug ): bool {
		return in_array( $slug, self::RESERVED_SLUGS, true );
	}

	public function register(): void {
		add_action( 'init', array( $this, 'register_all' ), 20 );
		add_action( 'save_post', array( $this, 'record_modified_by' ), 10, 2 );
		add_action( 'before_delete_post', array( $this, 'cleanup_after_field_delete' ), 10, 2 );
		add_action( 'before_delete_post', array( $this, 'cleanup_after_entry_delete' ), 10, 2 );
	}

	/**
	 * Returns the dynamic entry CPTs currently registered.
	 *
	 * Excludes the Cortext utility CPTs (`crtxt_collection`, `crtxt_field`)
	 * and any post types that don't share the entry CPT prefix.
	 *
	 * @return array<int,string>
	 */
	public static function get_entry_post_types(): array {
		$entry_post_types = array();
		foreach ( get_post_types() as $post_type ) {
			if (
				str_starts_with( $post_type, self::CPT_PREFIX ) &&
				Collection::POST_TYPE !== $post_type &&
				Field::POST_TYPE !== $post_type
			) {
				$entry_post_types[] = $post_type;
			}
		}
		return $entry_post_types;
	}

	/**
	 * Removes a field's traces from the database when its post is deleted.
	 *
	 * Two cleanups, scoped to Cortext data only:
	 *
	 * 1. Drops `field-<id>` postmeta rows from every entry.
	 * 2. Removes the field's string ID from any collection's `meta.fields`
	 *    list, preserving the order of the remaining IDs.
	 *
	 * Runs on every deletion path (REST, wp-admin, WP-CLI).
	 *
	 * @param int          $post_id Post being deleted.
	 * @param WP_Post|null $post    Post object, or null in pathological calls.
	 */
	public function cleanup_after_field_delete( int $post_id, ?WP_Post $post = null ): void {
		$post_type = $post instanceof WP_Post ? $post->post_type : get_post_type( $post_id );
		if ( Field::POST_TYPE !== $post_type ) {
			return;
		}

		$this->delete_dependent_rollups_for_field( $post_id );

		$reverse_id = (int) get_post_meta( $post_id, 'relation_reverse_field_id', true );
		if ( $reverse_id > 0 && empty( self::$deleting_relation_fields[ $reverse_id ] ) ) {
			$reverse = get_post( $reverse_id );
			if ( $reverse instanceof WP_Post && Field::POST_TYPE === $reverse->post_type ) {
				$owner_collection_id         = (int) get_post_meta( $reverse_id, 'related_collection_id', true );
				$reverse_owner_collection_id = (int) get_post_meta( $post_id, 'related_collection_id', true );
				if ( $owner_collection_id > 0 ) {
					delete_post_meta( $owner_collection_id, 'fields', (string) $post_id );
				}
				if ( $reverse_owner_collection_id > 0 ) {
					delete_post_meta( $reverse_owner_collection_id, 'fields', (string) $reverse_id );
				}

				$this->delete_dependent_rollups_in_collection( $post_id, $owner_collection_id );
				$this->delete_dependent_rollups_in_collection( $reverse_id, $reverse_owner_collection_id );

				self::$deleting_relation_fields[ $post_id ] = true;
				wp_delete_post( $reverse_id, true );
				unset( self::$deleting_relation_fields[ $post_id ] );
			}
		}

		// Drop the field's `field-<id>` meta. `delete_post_meta_by_key`
		// is global (clears the key from every post in the database),
		// not strictly scoped to Cortext entry CPTs. We rely on the
		// key being naturally unique: `<id>` is a globally unique post
		// ID for a `crtxt_field` post, so any postmeta row keyed
		// `field-<that-id>` belongs to a Cortext entry by construction.
		// A scoped SQL JOIN would tighten the scope on paper but
		// WorDBless (the test mock — see tech-debt.md#9) can't simulate
		// it; tracked as tech-debt.md#21.
		delete_post_meta_by_key( "field-{$post_id}" );

		// Defensive: remove the field's string ID from any collection's
		// `meta.fields` list. Query by exact meta row and then filter the
		// owners by post type so cache cleanup still goes through
		// delete_post_meta().
		global $wpdb;

		$field_id_str = (string) $post_id;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- cleanup by exact field list value.
		$collections_with_field = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s",
				'fields',
				$field_id_str
			)
		);

		foreach ( array_unique( array_map( 'intval', $collections_with_field ) ) as $collection_id ) {
			if ( Collection::POST_TYPE !== get_post_type( $collection_id ) ) {
				continue;
			}
			delete_post_meta( $collection_id, 'fields', $field_id_str );
		}
	}

	/**
	 * Deletes rollup fields in one collection that depend on a deleted field.
	 *
	 * @param int $field_id      Field post ID being deleted.
	 * @param int $collection_id Collection whose fields should be scanned.
	 */
	private function delete_dependent_rollups_in_collection( int $field_id, int $collection_id ): void {
		if ( $collection_id < 1 ) {
			return;
		}

		$field_id_str = (string) $field_id;
		foreach ( array_map( 'intval', get_post_meta( $collection_id, 'fields', false ) ) as $rollup_id ) {
			if (
				$rollup_id !== $field_id &&
				Field::POST_TYPE === get_post_type( $rollup_id ) &&
				'rollup' === (string) get_post_meta( $rollup_id, 'type', true ) &&
				(
					(string) get_post_meta( $rollup_id, 'rollup_relation_field_id', true ) === $field_id_str ||
					(string) get_post_meta( $rollup_id, 'rollup_target_field_id', true ) === $field_id_str
				)
			) {
				delete_post_meta( $collection_id, 'fields', (string) $rollup_id );
				wp_delete_post( $rollup_id, true );
			}
		}
	}

	/**
	 * Deletes rollup fields that depend on a deleted relation or target field.
	 *
	 * @param int $field_id Field post ID being deleted.
	 */
	private function delete_dependent_rollups_for_field( int $field_id ): void {
		global $wpdb;

		$field_id_str   = (string) $field_id;
		$rollup_ids     = array();
		$collection_ids = array_values( self::$entry_collection_ids );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- cleanup by exact field list value.
		$attached_collection_ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s",
				'fields',
				$field_id_str
			)
		);
		$collection_ids          = array_merge(
			$collection_ids,
			$attached_collection_ids
		);

		foreach ( array( 'rollup_relation_field_id', 'rollup_target_field_id' ) as $meta_key ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- cleanup by exact rollup dependency meta.
			$dependent_ids = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s",
					$meta_key,
					$field_id_str
				)
			);
			$rollup_ids    = array_merge(
				$rollup_ids,
				$dependent_ids
			);
		}

		$fields = get_posts(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				'numberposts' => -1,
				'fields'      => 'ids',
			)
		);
		foreach ( array_map( 'intval', $fields ) as $candidate_id ) {
			if (
				$candidate_id !== $field_id &&
				'rollup' === (string) get_post_meta( $candidate_id, 'type', true ) &&
				(
					(string) get_post_meta( $candidate_id, 'rollup_relation_field_id', true ) === $field_id_str ||
					(string) get_post_meta( $candidate_id, 'rollup_target_field_id', true ) === $field_id_str
				)
			) {
				$rollup_ids[] = $candidate_id;
			}
		}

		foreach ( array_unique( array_map( 'intval', $collection_ids ) ) as $collection_id ) {
			if ( Collection::POST_TYPE !== get_post_type( $collection_id ) ) {
				continue;
			}
			foreach ( array_map( 'intval', get_post_meta( $collection_id, 'fields', false ) ) as $rollup_id ) {
				if (
					$rollup_id !== $field_id &&
					Field::POST_TYPE === get_post_type( $rollup_id ) &&
					'rollup' === (string) get_post_meta( $rollup_id, 'type', true ) &&
					(
						(string) get_post_meta( $rollup_id, 'rollup_relation_field_id', true ) === $field_id_str ||
						(string) get_post_meta( $rollup_id, 'rollup_target_field_id', true ) === $field_id_str
					)
				) {
					$rollup_ids[] = $rollup_id;
				}
			}
		}

		foreach ( array_unique( array_map( 'intval', $rollup_ids ) ) as $rollup_id ) {
			if (
				$rollup_id === $field_id ||
				Field::POST_TYPE !== get_post_type( $rollup_id ) ||
				'rollup' !== (string) get_post_meta( $rollup_id, 'type', true )
			) {
				continue;
			}

			$rollup_id_str = (string) $rollup_id;
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- cleanup by exact field list value.
			$owner_collection_ids = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s",
					'fields',
					$rollup_id_str
				)
			);
			$owner_collection_ids = array_merge( $owner_collection_ids, $collection_ids );
			foreach ( array_unique( array_map( 'intval', $owner_collection_ids ) ) as $collection_id ) {
				if ( Collection::POST_TYPE === get_post_type( $collection_id ) ) {
					delete_post_meta( $collection_id, 'fields', $rollup_id_str );
				}
			}
			wp_delete_post( $rollup_id, true );
		}
	}

	public function cleanup_after_entry_delete( int $post_id, ?WP_Post $post = null ): void {
		$post_type = $post instanceof WP_Post ? $post->post_type : get_post_type( $post_id );
		if ( ! is_string( $post_type ) || ! str_starts_with( $post_type, self::CPT_PREFIX ) ) {
			return;
		}
		if ( in_array( $post_type, array( Collection::POST_TYPE, Field::POST_TYPE ), true ) ) {
			return;
		}

		$collection_id = $this->collection_id_for_entry_post_type( $post_type );
		$field_ids     = $collection_id > 0
			? array_map( 'intval', get_post_meta( $collection_id, 'fields', false ) )
			: array();

		Relations::remove_deleted_row_references( $post_id, $field_ids );
	}

	/**
	 * Collection IDs whose entry post types are already registered in this
	 * request. The type-change endpoints use this for a cheap field→collection
	 * lookup before falling back to postmeta.
	 *
	 * @return int[]
	 */
	public static function known_collection_ids(): array {
		return array_values( self::$entry_collection_ids );
	}

	private function collection_id_for_entry_post_type( string $post_type ): int {
		if ( isset( self::$entry_collection_ids[ $post_type ] ) ) {
			return self::$entry_collection_ids[ $post_type ];
		}

		$slug = substr( $post_type, strlen( self::CPT_PREFIX ) );
		if ( '' === $slug ) {
			return 0;
		}

		$collections = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_status'    => array( 'draft', 'pending', 'private', 'publish' ),
				'posts_per_page' => -1,
			)
		);
		foreach ( $collections as $collection ) {
			if ( (string) get_post_meta( $collection->ID, 'slug', true ) === $slug ) {
				return (int) $collection->ID;
			}
		}

		return 0;
	}

	/**
	 * Records the current user as the last editor of an entry.
	 *
	 * WordPress core stores `post_modified` (timestamp) but not who edited.
	 * The plugin records `_modified_by` post meta on every entry save so the
	 * "Last edited by" system column has a value to read. Skipped when no
	 * user is signed in (CLI imports, cron, seeds, unauthenticated REST)
	 * so background writes don't clobber the last real editor with `0`.
	 *
	 * @param int     $post_id Post ID being saved.
	 * @param WP_Post $post    Post object being saved.
	 */
	public function record_modified_by( int $post_id, WP_Post $post ): void {
		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}

		if ( strpos( $post->post_type, self::CPT_PREFIX ) !== 0 ) {
			return;
		}

		if ( Collection::POST_TYPE === $post->post_type || Field::POST_TYPE === $post->post_type ) {
			return;
		}

		$user_id = get_current_user_id();
		if ( $user_id < 1 ) {
			return;
		}

		update_post_meta( $post_id, '_modified_by', $user_id );
	}

	public function register_all(): void {
		$collections = get_posts(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => array( 'draft', 'private', 'publish' ),
				'numberposts' => -1,
			)
		);

		foreach ( $collections as $collection ) {
			$this->register_for_collection( $collection );
		}
	}

	public function register_for_collection( WP_Post $collection ): void {
		$slug = get_post_meta( $collection->ID, 'slug', true );
		if ( ! $slug ) {
			return;
		}

		if ( self::is_reserved_slug( $slug ) ) {
			_doing_it_wrong(
				__METHOD__,
				esc_html(
					sprintf(
						/* translators: %s: collection slug */
						__( 'Collection slug "%s" is reserved and was not registered.', 'cortext' ),
						$slug
					)
				),
				'0.0.1'
			);
			return;
		}

		if ( strlen( self::CPT_PREFIX . $slug ) > self::MAX_CPT_LEN ) {
			_doing_it_wrong(
				__METHOD__,
				esc_html(
					sprintf(
						/* translators: 1: collection slug, 2: maximum allowed length */
						__( 'Collection slug "%1$s" exceeds the %2$d-character limit and was not registered.', 'cortext' ),
						$slug,
						self::MAX_CPT_LEN - strlen( self::CPT_PREFIX )
					)
				),
				'0.0.1'
			);
			return;
		}

		$post_type                                = self::CPT_PREFIX . $slug;
		self::$entry_collection_ids[ $post_type ] = (int) $collection->ID;

		// Register the post type and the shared meta keys once. Field meta
		// must register on every call so collections that happen to share
		// a slug (e.g. duplicate seed entries) all contribute their field
		// keys to the shared CPT instead of silently dropping at REST.
		if ( ! post_type_exists( $post_type ) ) {
			DocumentTypeRegistrar::register(
				$post_type,
				array(
					'labels'             => array(
						'name'          => $collection->post_title,
						'singular_name' => $collection->post_title,
					),
					'public'             => false,
					'publicly_queryable' => false,
					'show_ui'            => true,
					'show_in_menu'       => false,
					'show_in_rest'       => true,
					'rest_base'          => $post_type,
					'has_archive'        => false,
					'hierarchical'       => false,
					// `thumbnail` exposes featured_media so document covers
					// work for rows; `revisions` lets RevisionThrottle cap
					// row history the same way it caps page history.
					'supports'           => array( 'title', 'editor', 'custom-fields', 'thumbnail', 'revisions' ),
					'capability_type'    => 'post',
					'map_meta_cap'       => true,
					'can_export'         => true,
					'delete_with_user'   => false,
				)
			);
		}

		$this->register_field_meta( $post_type, $collection->ID );

		if ( empty( self::$menu_order_hooks[ $post_type ] ) ) {
			add_action( "save_post_{$post_type}", array( $this, 'assign_menu_order_on_insert' ), 10, 3 );
			self::$menu_order_hooks[ $post_type ] = true;
		}
	}

	public function assign_menu_order_on_insert( int $post_id, WP_Post $post, bool $update ): void {
		if ( $update || wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}

		if ( ! str_starts_with( $post->post_type, self::CPT_PREFIX ) ) {
			return;
		}

		if ( Collection::POST_TYPE === $post->post_type || Field::POST_TYPE === $post->post_type ) {
			return;
		}

		$current = get_post( $post_id );
		if ( ! $current instanceof WP_Post || 0 !== (int) $current->menu_order ) {
			return;
		}

		$max_order = $this->max_menu_order_for_entry_post_type( $post->post_type, $post_id );

		$this->update_entry_menu_order( $post_id, $max_order + 100 );
	}

	private function max_menu_order_for_entry_post_type( string $post_type, int $exclude_post_id ): int {
		if ( $this->is_wordbless_active() ) {
			$max_order = 0;
			foreach ( \WorDBless\Posts::init()->posts as $existing ) {
				if (
					$post_type === $existing->post_type &&
					(int) $existing->ID !== $exclude_post_id &&
					in_array( $existing->post_status, array( 'draft', 'private', 'publish' ), true )
				) {
					$max_order = max( $max_order, (int) $existing->menu_order );
				}
			}
			return $max_order;
		}

		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Reads one aggregate during insert without loading every row post.
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE(MAX(menu_order), 0)
				FROM {$wpdb->posts}
				WHERE post_type = %s
				AND post_status IN ('draft', 'private', 'publish')
				AND ID != %d",
				$post_type,
				$exclude_post_id
			)
		);
	}

	private function update_entry_menu_order( int $post_id, int $menu_order ): void {
		if ( $this->is_wordbless_active() ) {
			wp_update_post(
				array(
					'ID'         => $post_id,
					'menu_order' => $menu_order,
				)
			);
			return;
		}

		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct menu_order write during insert; avoids revision churn.
		$wpdb->update(
			$wpdb->posts,
			array( 'menu_order' => $menu_order ),
			array( 'ID' => $post_id ),
			array( '%d' ),
			array( '%d' )
		);
		clean_post_cache( $post_id );
	}

	private function is_wordbless_active(): bool {
		return defined( 'WP_REPAIRING' ) && WP_REPAIRING && class_exists( '\WorDBless\Posts' );
	}

	private function register_field_meta( string $post_type, int $collection_id ): void {
		$field_ids = get_post_meta( $collection_id, 'fields', false );

		foreach ( $field_ids as $field_id ) {
			$field = get_post( (int) $field_id );
			if ( ! $field ) {
				continue;
			}

			$field_type  = get_post_meta( $field->ID, 'type', true );
			$is_multiple = 'multiselect' === $field_type ||
				( 'relation' === $field_type && Relations::relation_is_multiple( (int) $field->ID ) );

			register_post_meta(
				$post_type,
				"field-{$field->ID}",
				array(
					'type'         => self::wp_meta_type_for( $field_type ),
					'single'       => ! $is_multiple,
					'show_in_rest' => true,
				)
			);
		}
	}

	public static function wp_meta_type_for( string $cortext_type ): string {
		return FieldTypeRegistry::wp_meta_type( $cortext_type );
	}
}
