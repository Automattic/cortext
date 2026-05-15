<?php
/**
 * Read/list/search service for Cortext documents.
 *
 * "Document" is the union of post types that opt into the `cortext-document`
 * trait: pages (`crtxt_page`) and collection rows (`crtxt_<slug>`). Anything
 * that needs to enumerate "Cortext things" should go through here instead of
 * hardcoding the list of post types.
 *
 * Scope is read-only; write paths still go through `wp/v2` and the collection
 * row controllers.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Page;
use Cortext\PostType\PageTrashCascade;
use WP_Post;
use WP_Query;

final class Documents {

	public const KIND_PAGE = 'page';
	public const KIND_ROW  = 'row';

	public const STATUS_TRASH = 'trash';

	private const DEFAULT_STATUSES = array( 'publish', 'draft', 'private' );
	private const DEFAULT_PER_PAGE = 20;
	private const MAX_PER_PAGE     = 100;

	/**
	 * Per-instance memo of `row CPT -> parent collection` lookups so a single
	 * `list()` call that returns many rows of the same CPT does not re-query
	 * the collection per row. Cleared on demand by callers that span requests.
	 *
	 * @var array<string,?WP_Post>
	 */
	private array $collection_cache = array();

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
	 * the post. Callers treat null as "not found" without leaking permission
	 * semantics.
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
	 *     `publish, draft, private`. Pass `'trash'` to list trashed documents
	 *     (no pagination; SidebarTrash and similar surfaces need every entry).
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
			// Trashed lists feed the sidebar Trash, which needs every entry up
			// front to compute cascade roots. All other lists paginate.
			'paged'               => $is_trash ? 1 : $page,
			'posts_per_page'      => $is_trash ? -1 : $per_page,
			'orderby'             => 'modified',
			'order'               => 'DESC',
			'ignore_sticky_posts' => true,
		);

		if ( '' !== $search ) {
			$query_args['s'] = $search;
		}

		$query = new WP_Query( $query_args );

		$opts      = array(
			'include_excerpt'    => ! empty( $args['include_excerpt'] ),
			'include_trash_meta' => $is_trash,
		);
		$documents = array();
		foreach ( $query->posts as $post ) {
			if ( ! $post instanceof WP_Post ) {
				continue;
			}
			if ( ! current_user_can( 'edit_post', $post->ID ) ) {
				continue;
			}
			$document = $this->format_document( $post, $opts );
			if ( null !== $document ) {
				$documents[] = $document;
			}
		}

		return array(
			'documents' => $documents,
			'total'     => (int) $query->found_posts,
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
	 * @param string $kind Document kind (`page`, `row`, or empty for any).
	 * @return string[]
	 */
	private function post_types_for_kind( string $kind ): array {
		$post_types = $this->get_document_post_types();

		if ( self::KIND_PAGE === $kind ) {
			return array_values(
				array_filter(
					$post_types,
					static fn( string $post_type ): bool => Page::POST_TYPE === $post_type
				)
			);
		}

		if ( self::KIND_ROW === $kind ) {
			return array_values(
				array_filter(
					$post_types,
					static fn( string $post_type ): bool => Page::POST_TYPE !== $post_type
						&& str_starts_with( $post_type, CollectionEntries::CPT_PREFIX )
				)
			);
		}

		return $post_types;
	}

	/**
	 * Renders one document into the shared shape. Row documents include the
	 * parent collection summary so consumers can render breadcrumbs without a
	 * second lookup. Returns null when the post type does not opt into the
	 * trait, so callers that have already validated the post still get a safe
	 * "not a document" signal.
	 *
	 * @param WP_Post            $post Document post.
	 * @param array<string,bool> $opts Formatting flags.
	 * @return array<string,mixed>|null
	 */
	public function format_document( WP_Post $post, array $opts = array() ): ?array {
		$kind = $this->kind_for_post_type( $post->post_type );
		if ( null === $kind ) {
			return null;
		}

		$collection = self::KIND_ROW === $kind
			? $this->find_collection_by_row_post_type( $post->post_type )
			: null;

		if ( self::KIND_ROW === $kind && ! $collection instanceof WP_Post ) {
			// Row without a resolvable parent collection is unreachable in the
			// UI; drop it rather than surface a half-built document.
			return null;
		}

		$document = array(
			'kind'   => $kind,
			'id'     => (int) $post->ID,
			'title'  => $this->post_title( $post ),
			'path'   => $collection instanceof WP_Post
				? $this->collection_path( $collection )
				: $this->page_path( $post ),
			'parent' => (int) $post->post_parent,
		);

		if ( ! empty( $opts['include_excerpt'] ) ) {
			$document['excerpt'] = $this->build_excerpt( $post );
		}

		$icon = '';
		if ( self::KIND_PAGE === $kind ) {
			$icon = (string) get_post_meta( $post->ID, DocumentIdentity::META_KEY, true );
			if ( '' !== $icon ) {
				$document['icon'] = $icon;
			}
		}

		if ( $collection instanceof WP_Post ) {
			$document['collection'] = array(
				'id'    => (int) $collection->ID,
				'title' => $this->post_title( $collection ),
				'path'  => $this->collection_path( $collection ),
			);
		}

		if ( ! empty( $opts['include_trash_meta'] ) ) {
			$document['modified_at'] = $this->format_gmt_date( $post->post_modified_gmt );
			$document['meta']        = array(
				'cortext_document_icon'    => $icon,
				PageTrashCascade::META_KEY => (int) get_post_meta( $post->ID, PageTrashCascade::META_KEY, true ),
			);
		}

		return $document;
	}

	private function format_gmt_date( string $mysql_gmt ): string {
		$timestamp = strtotime( $mysql_gmt . ' UTC' );
		return false === $timestamp ? '' : gmdate( 'c', $timestamp );
	}

	/**
	 * Maps a post type to its document kind, or null when the post type is
	 * not a Cortext document. Public so other surfaces (trash, breadcrumbs)
	 * can branch on the same classification.
	 *
	 * @param string $post_type Post type slug.
	 */
	public function kind_for_post_type( string $post_type ): ?string {
		if ( Page::POST_TYPE === $post_type ) {
			return self::KIND_PAGE;
		}
		if ( str_starts_with( $post_type, CollectionEntries::CPT_PREFIX )
			&& Collection::POST_TYPE !== $post_type
		) {
			return self::KIND_ROW;
		}
		return null;
	}

	/**
	 * Locates the collection post that owns a given row CPT by matching the
	 * post type suffix to the collection's `slug` meta. Public so callers that
	 * already have a row in hand do not re-derive the same lookup.
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

	private function page_path( WP_Post $post ): string {
		$slug = trim( $post->post_name );
		$tail = '' === $slug ? (string) $post->ID : "{$slug}-{$post->ID}";
		return "page/{$tail}";
	}

	private function collection_path( WP_Post $collection ): string {
		$slug = get_post_meta( (int) $collection->ID, 'slug', true );
		$slug = is_string( $slug ) ? trim( $slug ) : '';
		$tail = '' === $slug ? (string) $collection->ID : "{$slug}-{$collection->ID}";
		return "collection/{$tail}";
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
}
