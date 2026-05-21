<?php
/**
 * Finds and lists Cortext documents.
 *
 * "Document" is the union of post types that opt into the `cortext-document`
 * trait: pages (`crtxt_page`), collections (`crtxt_collection`), and rows
 * (`crtxt_<slug>`). Code that needs all Cortext documents should use this
 * service instead of rebuilding the post-type list.
 *
 * Per-kind specifics (path, owner relation, icon presence) live in
 * `Cortext\Documents\DocumentKind` implementations, resolved through the
 * `KindRegistry` this service constructs by default.
 *
 * This service only reads; writes still go through `wp/v2` and the collection
 * row controllers.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\Documents\CollectionKind;
use Cortext\Documents\DocumentKind;
use Cortext\Documents\KindRegistry;
use Cortext\Documents\PageKind;
use Cortext\Documents\RowKind;
use Cortext\Fields\FieldTypeRegistry;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\CollectionTrashCascade;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\PageTrashCascade;
use Cortext\Rest\RowsFilterQuery;
use WP_Post;
use WP_Query;

final class Documents {

	public const KIND_PAGE       = 'page';
	public const KIND_ROW        = 'row';
	public const KIND_COLLECTION = 'collection';

	public const STATUS_TRASH = 'trash';

	private const DEFAULT_STATUSES = array( 'publish', 'draft', 'private' );
	private const DEFAULT_PER_PAGE = 20;
	private const MAX_PER_PAGE     = 100;

	/**
	 * Caches `row CPT -> parent collection` lookups for this service instance.
	 * A `list()` call with many rows from the same CPT then asks for the
	 * collection once.
	 *
	 * @var array<string,?WP_Post>
	 */
	private array $collection_cache = array();

	private RowsFilterQuery $rows_filter_query;

	private KindRegistry $kinds;

	public function __construct(
		?RowsFilterQuery $rows_filter_query = null,
		?KindRegistry $kinds = null
	) {
		$this->rows_filter_query = $rows_filter_query ?? new RowsFilterQuery();
		$this->kinds             = $kinds ?? $this->build_default_kind_registry();
	}

	/**
	 * Builds the default kind registry. Page and collection kinds are
	 * self-contained; row kind needs the documents service to resolve a row
	 * CPT to its parent collection, so it receives `$this`.
	 */
	private function build_default_kind_registry(): KindRegistry {
		$registry = new KindRegistry();
		$registry->register( new PageKind() );
		$registry->register( new CollectionKind() );
		$registry->register( new RowKind( $this ) );
		return $registry;
	}

	/**
	 * Returns every registered post type that opts into the `cortext-document`
	 * trait. The set is dynamic because row CPTs are registered per published
	 * collection on `init`.
	 *
	 * @return string[]
	 */
	public function get_document_post_types(): array {
		return array_values(
			array_filter(
				get_post_types(),
				static fn( string $post_type ): bool => post_type_supports( $post_type, 'cortext-document' )
			)
		);
	}

	/**
	 * Resolves a document by id. Returns null when the id is unknown, the
	 * post type does not opt into the trait, or the current user cannot edit
	 * the post. Callers treat null as "not found" without exposing whether
	 * the user lacked permission.
	 *
	 * Options:
	 *   - `include_excerpt` (bool, default false): include a derived excerpt.
	 *   - `allow_trash` (bool, default false): include trashed documents.
	 *
	 * @param int                $id   Document post id.
	 * @param array<string,bool> $opts Formatting options.
	 * @return array<string,mixed>|null
	 */
	public function find( int $id, array $opts = array() ): ?array {
		if ( $id < 1 ) {
			return null;
		}

		$post = get_post( $id );
		if ( ! $post instanceof WP_Post ) {
			return null;
		}

		if ( ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return null;
		}

		if ( empty( $opts['allow_trash'] ) && 'trash' === $post->post_status ) {
			return null;
		}

		if ( ! current_user_can( 'edit_post', $post->ID ) ) {
			return null;
		}

		return $this->format_document( $post, $opts );
	}

	/**
	 * Lists documents the current user can edit. Filters and paging mirror the
	 * conventions used by `/cortext/v1/rows`.
	 *
	 * Arguments:
	 *   - `search` (string): split-term match across title, excerpt, content.
	 *   - `kind`   (string): 'page' or 'row' to restrict by document kind.
	 *   - `status` (string|string[]): post status filter. Defaults to
	 *     `publish, draft, private`. Pass `'trash'` to list every trashed
	 *     document, since the Trash sidebar needs the full set.
	 *   - `page`   (int):    1-based page number.
	 *   - `per_page` (int):  page size, clamped to MAX_PER_PAGE.
	 *   - `include_excerpt` (bool): include excerpt in formatted documents.
	 *
	 * @param array<string,mixed> $args
	 * @return array{documents: array<int,array<string,mixed>>, total: int}
	 */
	public function list( array $args = array() ): array {
		$post_types = $this->post_types_for_kind( $args['kind'] ?? '' );
		if ( empty( $post_types ) ) {
			return array(
				'documents' => array(),
				'total'     => 0,
			);
		}

		$statuses = $this->normalize_statuses( $args['status'] ?? null );
		$is_trash = array( self::STATUS_TRASH ) === $statuses;
		$page     = max( 1, (int) ( $args['page'] ?? 1 ) );
		$per_page = min(
			self::MAX_PER_PAGE,
			max( 1, (int) ( $args['per_page'] ?? self::DEFAULT_PER_PAGE ) )
		);
		$search   = isset( $args['search'] ) ? trim( (string) $args['search'] ) : '';

		$query_args = array(
			'post_type'           => $post_types,
			'post_status'         => $statuses,
			'fields'              => 'ids',
			'posts_per_page'      => -1,
			'ignore_sticky_posts' => true,
			'no_found_rows'       => true,
		);

		if ( '' === $search ) {
			// No search: most recently modified first.
			$query_args['orderby'] = 'modified';
			$query_args['order']   = 'DESC';
		} else {
			// With a search term, let `WP_Query` apply its
			// `search_orderby_title` scoring so title hits bubble up before
			// body/meta-only matches. The palette caps results to a small
			// page, so ordering by modified date alone would arbitrarily
			// hide the most relevant document when the recently-edited
			// long tail happens to match.
			$query_args['s'] = $search;
		}

		$search_filter = $this->build_search_filter( $search, $post_types );
		if ( null !== $search_filter ) {
			add_filter( 'posts_search', $search_filter, 10, 2 );
		}

		$orderby_filter = $this->build_search_orderby_filter( $search, $post_types );
		if ( null !== $orderby_filter ) {
			add_filter( 'posts_search_orderby', $orderby_filter, 10, 2 );
		}

		$query = new WP_Query( $query_args );

		if ( null !== $search_filter ) {
			remove_filter( 'posts_search', $search_filter, 10 );
		}
		if ( null !== $orderby_filter ) {
			remove_filter( 'posts_search_orderby', $orderby_filter, 10 );
		}

		$editable_ids = array_values(
			array_filter(
				array_map( 'intval', $query->posts ),
				static fn( int $post_id ): bool => current_user_can( 'edit_post', $post_id )
			)
		);
		$total        = count( $editable_ids );
		$page_ids     = $is_trash
			? $editable_ids
			: array_slice( $editable_ids, ( $page - 1 ) * $per_page, $per_page );

		$opts      = array(
			'include_excerpt'    => ! empty( $args['include_excerpt'] ),
			'include_trash_meta' => $is_trash,
		);
		$documents = array();
		foreach ( $page_ids as $post_id ) {
			$post = get_post( $post_id );
			if ( ! $post instanceof WP_Post ) {
				continue;
			}
			$document = $this->format_document( $post, $opts );
			if ( null !== $document ) {
				$documents[] = $document;
			}
		}

		return array(
			'documents' => $documents,
			'total'     => $total,
		);
	}

	/**
	 * Normalises the status arg. Accepts a string, an array of strings, or
	 * null (default set). Unknown statuses fall back to the default set.
	 *
	 * @param mixed $status Status request value.
	 * @return string[]
	 */
	private function normalize_statuses( $status ): array {
		if ( null === $status || '' === $status ) {
			return self::DEFAULT_STATUSES;
		}

		$candidates = array_values(
			array_filter(
				array_map(
					static fn( $value ): string => is_string( $value ) ? $value : '',
					(array) $status
				),
				static fn( string $value ): bool => '' !== $value
			)
		);
		if ( empty( $candidates ) ) {
			return self::DEFAULT_STATUSES;
		}

		$allowed = array_merge( self::DEFAULT_STATUSES, array( self::STATUS_TRASH ) );
		$valid   = array_values( array_intersect( $candidates, $allowed ) );

		return empty( $valid ) ? self::DEFAULT_STATUSES : $valid;
	}

	/**
	 * Narrows the post-type set based on the requested kind, or returns the
	 * full document set when no kind is requested.
	 *
	 * @param string $kind Document kind id (`page`, `collection`, `row`), or empty for any.
	 * @return string[]
	 */
	private function post_types_for_kind( string $kind ): array {
		$post_types = $this->get_document_post_types();

		if ( '' === $kind ) {
			return $post_types;
		}

		$target = $this->kinds->by_id( $kind );
		if ( null === $target ) {
			return array();
		}

		return array_values(
			array_filter(
				$post_types,
				static fn( string $post_type ): bool => $target->owns_post_type( $post_type )
			)
		);
	}

	/**
	 * Formats one document for the shared response shape. Row documents include
	 * the parent collection summary so callers can render breadcrumbs without a
	 * second lookup. Returns null when the post type is not a Cortext document.
	 *
	 * @param WP_Post            $post Document post.
	 * @param array<string,bool> $opts Formatting flags.
	 * @return array<string,mixed>|null
	 */
	public function format_document( WP_Post $post, array $opts = array() ): ?array {
		$kind = $this->kind_object_for_post_type( $post->post_type );
		if ( null === $kind ) {
			return null;
		}

		$owner_context = $kind->owner_context( $post );

		// A row without its parent collection cannot be opened in the UI.
		if ( 'row' === $kind->id() && null === $owner_context ) {
			return null;
		}

		// Inline collections have no workspace route of their own; the kind
		// context flags that and the owner's path replaces the document's.
		$path = $kind->path_for( $post );
		if ( $owner_context && $owner_context->use_as_document_path ) {
			$owner_kind = $this->kinds->by_post_type( $owner_context->post->post_type );
			if ( null !== $owner_kind ) {
				$path = $owner_kind->path_for( $owner_context->post );
			}
		}

		$document = array(
			'kind'   => $kind->id(),
			'id'     => (int) $post->ID,
			'title'  => $this->post_title( $post ),
			'path'   => $path,
			'parent' => (int) $post->post_parent,
		);

		if ( ! empty( $opts['include_excerpt'] ) ) {
			$document['excerpt'] = $this->build_excerpt( $post );
		}

		$icon = '';
		if ( $kind->has_icon() ) {
			$icon = (string) get_post_meta( $post->ID, DocumentIdentity::META_KEY, true );
			if ( '' !== $icon ) {
				$document['icon'] = $icon;
			}
		}

		if ( $owner_context ) {
			$owner_kind                        = $this->kinds->by_post_type( $owner_context->post->post_type );
			$document[ $owner_context->field ] = array(
				'id'    => (int) $owner_context->post->ID,
				'title' => $this->post_title( $owner_context->post ),
				'path'  => null !== $owner_kind ? $owner_kind->path_for( $owner_context->post ) : '',
			);
		}

		if ( ! empty( $opts['include_trash_meta'] ) ) {
			$document['modified_at'] = $this->format_gmt_date( $post->post_modified_gmt );
			$document['meta']        = array(
				'cortext_document_icon'    => $icon,
				PageTrashCascade::META_KEY => (int) get_post_meta( $post->ID, PageTrashCascade::META_KEY, true ),
			);
			// Inline collections trashed alongside their owner page carry a
			// separate marker. The sidebar uses it to nest them under the
			// page's trash entry instead of listing them as siblings.
			if ( 'collection' === $kind->id() ) {
				$document['meta'][ CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY ] = (int) get_post_meta(
					$post->ID,
					CollectionTrashCascade::TRASHED_BY_OWNER_META_KEY,
					true
				);
			}
		}

		return $document;
	}

	private function format_gmt_date( string $mysql_gmt ): string {
		$timestamp = strtotime( $mysql_gmt . ' UTC' );
		return false === $timestamp ? '' : gmdate( 'c', $timestamp );
	}

	/**
	 * Maps a post type to its document kind id, or null when the post type
	 * is not a Cortext document. Public so trash, breadcrumbs, and similar
	 * code can branch on the same classification.
	 *
	 * @param string $post_type Post type slug.
	 */
	public function kind_for_post_type( string $post_type ): ?string {
		// Only post types that opt into the document trait count here. That
		// keeps `crtxt_field` out of document handling.
		if ( ! post_type_supports( $post_type, 'cortext-document' ) ) {
			return null;
		}
		return $this->kinds->by_post_type( $post_type )?->id();
	}

	/**
	 * Resolves the kind object for a post type, or null when no kind claims
	 * it. Internal helper for format_document and the listing search filter.
	 *
	 * @param string $post_type Post type slug.
	 */
	private function kind_object_for_post_type( string $post_type ): ?DocumentKind {
		if ( ! post_type_supports( $post_type, 'cortext-document' ) ) {
			return null;
		}
		return $this->kinds->by_post_type( $post_type );
	}

	/**
	 * Finds the collection post that owns a row CPT by matching the post-type
	 * suffix to the collection's `slug` meta. Public so callers that already
	 * have a row in hand do not repeat the lookup.
	 *
	 * @param string $post_type Row CPT slug, e.g. `crtxt_projects`.
	 */
	public function find_collection_by_row_post_type( string $post_type ): ?WP_Post {
		if ( array_key_exists( $post_type, $this->collection_cache ) ) {
			return $this->collection_cache[ $post_type ];
		}

		$collection = $this->lookup_collection_by_row_post_type( $post_type );

		$this->collection_cache[ $post_type ] = $collection;

		return $collection;
	}

	private function lookup_collection_by_row_post_type( string $post_type ): ?WP_Post {
		if (
			! str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) ||
			Collection::POST_TYPE === $post_type
		) {
			return null;
		}

		$slug = substr( $post_type, strlen( CollectionEntries::CPT_PREFIX ) );
		if ( '' === $slug ) {
			return null;
		}

		$collections = get_posts(
			array(
				'post_type'      => Collection::POST_TYPE,
				'post_status'    => array( 'draft', 'private', 'publish' ),
				'posts_per_page' => 1,
				'meta_key'       => 'slug', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => $slug,  // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		return $collections[0] ?? null;
	}

	private function post_title( WP_Post $post ): string {
		$title = trim( $post->post_title );
		return '' === $title ? __( '(untitled)', 'cortext' ) : $title;
	}

	/**
	 * Builds a short, plain-text excerpt for search results. Prefers the
	 * explicit `post_excerpt` when set; falls back to a trimmed version of
	 * `post_content` with blocks stripped.
	 *
	 * @param WP_Post $post Document post to summarise.
	 */
	private function build_excerpt( WP_Post $post ): string {
		$explicit = trim( (string) $post->post_excerpt );
		if ( '' !== $explicit ) {
			return wp_strip_all_tags( $explicit );
		}

		$content = (string) $post->post_content;
		if ( '' === trim( $content ) ) {
			return '';
		}

		$rendered = excerpt_remove_blocks( $content );
		$rendered = wp_strip_all_tags( $rendered );
		$rendered = preg_replace( '/\s+/', ' ', $rendered ?? '' );
		$rendered = trim( (string) $rendered );

		return wp_trim_words( $rendered, 30, '…' );
	}

	/**
	 * Returns a `posts_search` filter that lets row documents match text-like
	 * field meta (text, email, url), not only title/content/excerpt. This
	 * replaces WP's search clause, so split-term matching behaves the same way
	 * it does in `/rows`.
	 *
	 * Returns null for an empty search, a page-only query, or row CPTs without
	 * any text-like fields.
	 *
	 * @param string   $search     Trimmed search string.
	 * @param string[] $post_types Post types used by the WP_Query.
	 */
	private function build_search_filter( string $search, array $post_types ): ?callable {
		if ( '' === $search ) {
			return null;
		}

		$row_text_keys_by_cpt = array();
		foreach ( $post_types as $post_type ) {
			$kind = $this->kind_object_for_post_type( $post_type );
			if ( null === $kind || 'row' !== $kind->id() ) {
				continue;
			}
			$collection = $this->find_collection_by_row_post_type( $post_type );
			if ( ! $collection instanceof WP_Post ) {
				continue;
			}

			$schema = $this->rows_filter_query->field_schema_for( (int) $collection->ID );
			$keys   = array();
			foreach ( $schema as $field ) {
				if ( empty( $field['system'] ) && FieldTypeRegistry::is_text_like( (string) $field['type'] ) ) {
					$keys[] = (string) $field['key'];
				}
			}
			if ( count( $keys ) > 0 ) {
				$row_text_keys_by_cpt[ $post_type ] = $keys;
			}
		}

		if ( count( $row_text_keys_by_cpt ) === 0 ) {
			return null;
		}

		$post_type_signature = $post_types;
		sort( $post_type_signature );

		return function (
			string $search_sql,
			WP_Query $wp_query
		) use (
			$search,
			$post_type_signature,
			$row_text_keys_by_cpt
		): string {
			$query_post_types = (array) $wp_query->get( 'post_type' );
			sort( $query_post_types );
			if ( $query_post_types !== $post_type_signature ) {
				return $search_sql;
			}

			return $this->build_documents_search_sql( $search, $row_text_keys_by_cpt );
		};
	}

	/**
	 * Builds the SQL used by the documents endpoint instead of WP_Query's
	 * default search clause. Each search term must match somewhere. Pages use
	 * title/content/excerpt; rows can also use their collection's text-like
	 * field meta values.
	 *
	 * @param string                 $search               Search string.
	 * @param array<string,string[]> $row_text_keys_by_cpt Row CPT to its text-like meta keys.
	 */
	private function build_documents_search_sql( string $search, array $row_text_keys_by_cpt ): string {
		global $wpdb;

		$terms = preg_split( '/\s+/', trim( $search ) );
		$terms = is_array( $terms )
			? array_values(
				array_filter(
					$terms,
					static fn( $term ) => '' !== $term
				)
			)
			: array();

		if ( count( $terms ) === 0 ) {
			return '';
		}

		$term_clauses = array();
		foreach ( $terms as $term ) {
			$like = '%' . $wpdb->esc_like( (string) $term ) . '%';

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$branches = array(
				'( ' . $wpdb->prepare(
					"{$wpdb->posts}.post_title LIKE %s OR {$wpdb->posts}.post_content LIKE %s OR {$wpdb->posts}.post_excerpt LIKE %s",
					$like,
					$like,
					$like
				) . ' )',
			);

			foreach ( $row_text_keys_by_cpt as $cpt => $keys ) {
				$meta_sql = $this->rows_filter_query->meta_search_sql( $keys, $like );
				if ( '' === $meta_sql ) {
					continue;
				}
				$branches[] = '( ' . $wpdb->prepare( "{$wpdb->posts}.post_type = %s", $cpt ) . " AND {$meta_sql} )";
			}
			// phpcs:enable

			$term_clauses[] = '( ' . implode( ' OR ', $branches ) . ' )';
		}

		return ' AND ( ' . implode( ' AND ', $term_clauses ) . ' )';
	}

	/**
	 * Returns a `posts_search_orderby` filter that ranks documents by where
	 * the query lives in them. WP's default `search_orderby_title` for
	 * single-term queries only distinguishes "title contains" vs "title
	 * does not contain", so a recently edited document whose title happens
	 * to include the term as a substring ties with one whose title starts
	 * with it. For a palette the user expects the prefix match first.
	 *
	 * Tiers (ASC):
	 *   1. title starts with the query
	 *   2. title contains the query
	 *   3. excerpt contains the query
	 *   4. content contains the query
	 *   5. everything else (rows that matched only by meta, etc.)
	 *
	 * Returns null for an empty search or when the WP_Query is not the one
	 * `list()` is currently running.
	 *
	 * @param string   $search     Trimmed search string.
	 * @param string[] $post_types Post types used by the WP_Query.
	 */
	private function build_search_orderby_filter( string $search, array $post_types ): ?callable {
		if ( '' === $search ) {
			return null;
		}

		$post_type_signature = $post_types;
		sort( $post_type_signature );

		return function (
			string $search_orderby,
			WP_Query $wp_query
		) use (
			$search,
			$post_type_signature
		): string {
			$query_post_types = (array) $wp_query->get( 'post_type' );
			sort( $query_post_types );
			if ( $query_post_types !== $post_type_signature ) {
				return $search_orderby;
			}

			global $wpdb;
			$like_prefix   = $wpdb->esc_like( $search ) . '%';
			$like_anywhere = '%' . $wpdb->esc_like( $search ) . '%';

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			return $wpdb->prepare(
				"(CASE
					WHEN {$wpdb->posts}.post_title LIKE %s THEN 1
					WHEN {$wpdb->posts}.post_title LIKE %s THEN 2
					WHEN {$wpdb->posts}.post_excerpt LIKE %s THEN 3
					WHEN {$wpdb->posts}.post_content LIKE %s THEN 4
					ELSE 5
				END)",
				$like_prefix,
				$like_anywhere,
				$like_anywhere,
				$like_anywhere
			);
			// phpcs:enable
		};
	}
}
