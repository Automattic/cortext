<?php
/**
 * Public entry point for Cortext document operations.
 *
 * Every editable document is a `crtxt_document` post. The "kind" labels
 * (`page`, `collection`, `row`) are UI copy derived from state at display
 * time, not part of the wire shape:
 *   - `cortext_fields` meta -> collection (schema-bearing).
 *   - `crtxt_trait` term    -> row (collection member).
 *   - neither               -> page.
 *
 * Callers outside this class should call `format_document` / `format_target`
 * instead of branching on the underlying meta or taxonomy themselves.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents\DocumentDuplicator;
use Cortext\Relations;
use Cortext\Fields\FieldTypeRegistry;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\TrashCascade;
use Cortext\Rest\RowsFilterQuery;
use Cortext\Taxonomy\TraitTaxonomy;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_User;

final class Documents {

	public const KIND_PAGE       = 'page';
	public const KIND_ROW        = 'row';
	public const KIND_COLLECTION = 'collection';

	public const STATUS_ARCHIVED = 'crtxt_archived';
	public const STATUS_TRASH    = 'trash';

	public const DEFAULT_STATUSES  = array( 'publish', 'draft', 'private' );
	private const DEFAULT_PER_PAGE = 20;
	private const MAX_PER_PAGE     = 100;

	/**
	 * Caches `document_id -> trait_post` lookups for this service instance.
	 *
	 * @var array<int,?WP_Post>
	 */
	private array $trait_cache = array();

	private RowsFilterQuery $rows_filter_query;

	public function __construct( ?RowsFilterQuery $rows_filter_query = null ) {
		$this->rows_filter_query = $rows_filter_query ?? new RowsFilterQuery();
	}

	/**
	 * Duplicates a document by id. See `DocumentDuplicator` for the
	 * capability-by-capability copy rules.
	 *
	 * @param int $id Source document post id.
	 *
	 * @return array<string,mixed>|WP_Error
	 */
	public function duplicate( int $id ): array|WP_Error {
		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$result = ( new DocumentDuplicator( $this ) )->duplicate( $post );
		if ( $result instanceof WP_Error ) {
			return $result;
		}

		$document = $result['document'];
		return array(
			'id'             => (int) $document->ID,
			'title'          => $document->post_title,
			'slug'           => (string) $document->post_name,
			'restBase'       => 'crtxt_documents',
			'parent'         => (int) $document->post_parent,
			'collection_id'  => $result['collection_id'] > 0 ? $result['collection_id'] : null,
			'skipped_fields' => $result['skipped_fields'],
		);
	}

	/**
	 * Creates or updates a `crtxt_document`. Kind is derived from the
	 * payload, never declared:
	 *   - `fields` present -> writes the `cortext_fields` schema
	 *                          (collection in UI terms).
	 *   - `trait`  present -> assigns the `crtxt_trait` mirror term
	 *                          (row, i.e. member of that trait/collection).
	 *   - neither          -> page.
	 *
	 * The same call shape covers create (no `id`) and update (with `id`).
	 *
	 * Payload keys:
	 *   - id      (int)             Update when present; create otherwise.
	 *   - title   (string)          post_title.
	 *   - status  (string)          post_status. Default 'draft' on create.
	 *   - parent  (int)             post_parent.
	 *   - content (string)          post_content.
	 *   - author  (int)             post_author.
	 *   - fields  (int[]|string[])  Schema field ids. Rewrites all
	 *                               cortext_fields meta rows.
	 *   - trait   (int|null)        Owning collection/trait document id.
	 *                               Sets the mirror term; pass 0/null to
	 *                               remove membership.
	 *   - meta    (array)           Extra meta_input merged in
	 *                               (`field-<id>` values, breadcrumbs,
	 *                               `cortext_document_icon`, ...).
	 *
	 * @param array<string,mixed> $payload Save payload.
	 *
	 * @return int|WP_Error Document id, or WP_Error.
	 */
	public function save( array $payload ): int|WP_Error {
		$is_update = isset( $payload['id'] ) && (int) $payload['id'] > 0;

		$postarr = array( 'post_type' => Document::POST_TYPE );

		if ( $is_update ) {
			$post_id  = (int) $payload['id'];
			$existing = get_post( $post_id );
			if ( ! $existing instanceof WP_Post || Document::POST_TYPE !== $existing->post_type ) {
				return new WP_Error(
					'cortext_document_not_found',
					__( 'Document not found.', 'cortext' ),
					array( 'status' => 404 )
				);
			}
			$postarr['ID'] = $post_id;
		} else {
			$postarr['post_status'] = isset( $payload['status'] )
				? (string) $payload['status']
				: 'draft';
		}

		if ( array_key_exists( 'title', $payload ) ) {
			$postarr['post_title'] = (string) $payload['title'];
		}
		if ( $is_update && array_key_exists( 'status', $payload ) ) {
			$postarr['post_status'] = (string) $payload['status'];
		}
		if ( array_key_exists( 'parent', $payload ) ) {
			$postarr['post_parent'] = (int) $payload['parent'];
		}
		if ( array_key_exists( 'content', $payload ) ) {
			$postarr['post_content'] = (string) $payload['content'];
		}
		if ( array_key_exists( 'author', $payload ) ) {
			$postarr['post_author'] = (int) $payload['author'];
		}

		// Single-row meta goes through `meta_input`. `cortext_fields` is
		// multi-row (registered with `single => false`); handled after the
		// post exists with `add_post_meta` in a loop.
		if ( isset( $payload['meta'] ) && is_array( $payload['meta'] ) && count( $payload['meta'] ) > 0 ) {
			$postarr['meta_input'] = $payload['meta'];
		}

		$result = $is_update
			? wp_update_post( $postarr, true )
			: wp_insert_post( $postarr, true );

		if ( $result instanceof WP_Error ) {
			return $result;
		}
		$document_id = (int) $result;

		if ( array_key_exists( 'fields', $payload ) && is_array( $payload['fields'] ) ) {
			// The `fields` key designates this document a collection, even when
			// the schema is empty (a new collection has only the implicit
			// title). Create the mirror term first so the document is a
			// collection regardless of how many custom fields it carries.
			( new TraitTaxonomy() )->ensure_mirror_term( $document_id );
			delete_post_meta( $document_id, 'cortext_fields' );
			foreach ( $payload['fields'] as $field_id ) {
				$value = (string) $field_id;
				if ( '' !== $value ) {
					add_post_meta( $document_id, 'cortext_fields', $value );
				}
			}
		}

		if ( array_key_exists( 'trait', $payload ) ) {
			$trait_id = (int) $payload['trait'];
			if ( $trait_id > 0 ) {
				$term_id = TraitTaxonomy::term_id_for_trait( $trait_id );
				if ( $term_id < 1 ) {
					return new WP_Error(
						'cortext_trait_not_found',
						__( 'Trait mirror term not found.', 'cortext' ),
						array(
							'status'   => 404,
							'trait_id' => $trait_id,
						)
					);
				}
				$set = wp_set_object_terms( $document_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
				if ( $set instanceof WP_Error ) {
					return $set;
				}
			} else {
				// Explicit `trait => 0/null` removes membership.
				wp_set_object_terms( $document_id, array(), TraitTaxonomy::TAXONOMY, false );
			}
		}

		return $document_id;
	}

	/**
	 * Returns the post types that opt into the `cortext-document` trait.
	 * After the universal-document refactor this is a stable, finite set.
	 *
	 * @return string[]
	 */
	public function get_document_post_types(): array {
		return array( Document::POST_TYPE );
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

		if ( empty( $opts['allow_trash'] ) && self::STATUS_TRASH === $post->post_status ) {
			return null;
		}

		if ( ! current_user_can( 'edit_post', $post->ID ) ) {
			return null;
		}

		return $this->format_document( $post, $opts );
	}

	/**
	 * Lists documents the current user can edit. Filters and paging mirror
	 * the conventions used by the rows endpoint.
	 *
	 * Arguments:
	 *   - `search` (string): split-term match across title, excerpt, content.
	 *   - `status` (string|string[]): post status filter. Defaults to
	 *     `publish, draft, private`. Use `'trash'` or `'crtxt_archived'` to list
	 *     trashed or archived documents.
	 *   - `page`   (int):    1-based page number.
	 *   - `per_page` (int):  page size, clamped to MAX_PER_PAGE.
	 *   - `include_excerpt` (bool): include excerpt in formatted documents.
	 *
	 * @param array<string,mixed> $args
	 * @return array{documents: array<int,array<string,mixed>>, total: int}
	 */
	public function list( array $args = array() ): array {
		$statuses             = $this->normalize_statuses( $args['status'] ?? null );
		$is_trash             = array( self::STATUS_TRASH ) === $statuses;
		$is_archived          = array( self::STATUS_ARCHIVED ) === $statuses;
		$is_lifecycle_listing = $is_trash || $is_archived;
		$page                 = max( 1, (int) ( $args['page'] ?? 1 ) );
		$per_page             = min(
			self::MAX_PER_PAGE,
			max( 1, (int) ( $args['per_page'] ?? self::DEFAULT_PER_PAGE ) )
		);
		$search               = isset( $args['search'] ) ? trim( (string) $args['search'] ) : '';

		$query_args = array(
			'post_type'           => Document::POST_TYPE,
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
			// body/meta-only matches.
			$query_args['s'] = $search;
		}

		$search_filter = $this->build_search_filter( $search );
		if ( null !== $search_filter ) {
			add_filter( 'posts_search', $search_filter, 10, 2 );
		}

		$orderby_filter = $this->build_search_orderby_filter( $search );
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
		$page_ids     = $is_lifecycle_listing
			? $editable_ids
			: array_slice( $editable_ids, ( $page - 1 ) * $per_page, $per_page );

		$opts      = array(
			'include_excerpt'      => ! empty( $args['include_excerpt'] ),
			'include_trash_meta'   => $is_trash,
			'include_archive_meta' => $is_archived,
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

		$allowed = array_merge( self::DEFAULT_STATUSES, array( self::STATUS_ARCHIVED, self::STATUS_TRASH ) );
		$valid   = array_values( array_intersect( $candidates, $allowed ) );

		return empty( $valid ) ? self::DEFAULT_STATUSES : $valid;
	}

	/**
	 * Formats one document for the shared response shape. Row documents
	 * include the parent collection summary so callers can render breadcrumbs
	 * without a second lookup. Returns null when the post is not a Cortext
	 * document.
	 *
	 * @param WP_Post            $post Document post.
	 * @param array<string,bool> $opts Formatting flags.
	 * @return array<string,mixed>|null
	 */
	public function format_document( WP_Post $post, array $opts = array() ): ?array {
		$kind = self::kind_for_document( $post );
		if ( null === $kind ) {
			return null;
		}

		// A row needs at least one live parent collection to be openable.
		$source_collection = null;
		if ( self::KIND_ROW === $kind ) {
			$live_collections  = $this->find_live_traits_for_document( $post );
			$source_collection = $live_collections[0] ?? null;

			// Trash and Archive listings still need their collection shape when the
			// collection was retired with the row. Normal live targets must have a
			// live source or Favorites/Recents would retain an orphaned row.
			if (
				! $source_collection instanceof WP_Post
				&& ( ! empty( $opts['include_trash_meta'] ) || ! empty( $opts['include_archive_meta'] ) )
			) {
				$source_collection = $this->find_traits_for_document( $post )[0] ?? null;
			}
			if ( ! $source_collection instanceof WP_Post ) {
				return null;
			}
		}

		$document = array(
			'id'     => (int) $post->ID,
			'title'  => $this->post_title( $post ),
			'path'   => $this->path_for( $post ),
			'parent' => (int) $post->post_parent,
		);

		if ( ! empty( $opts['include_excerpt'] ) ) {
			$document['excerpt'] = $this->build_excerpt( $post );
		}

		$icon = (string) get_post_meta( $post->ID, DocumentIdentity::META_KEY, true );
		if ( '' !== $icon ) {
			$document['icon'] = $icon;
		}

		if ( $source_collection instanceof WP_Post ) {
			$document['collection'] = $this->format_collection_summary( $source_collection );
		}

		$include_trash_meta     = ! empty( $opts['include_trash_meta'] );
		$include_archive_meta   = ! empty( $opts['include_archive_meta'] );
		$include_lifecycle_meta = $include_trash_meta || $include_archive_meta;

		if ( ! empty( $opts['include_trait_flags'] ) || $include_lifecycle_meta ) {
			// Mirror the `cortext_defines_trait` and `crtxt_trait` fields exposed by
			// `/wp/v2/crtxt_documents`, so callers can tell pages, collections, and
			// rows apart. Trash and archived listings also use these fields for
			// cascade details and collection actions.
			$document['cortext_defines_trait'] = Document::is_collection_post( $post );
			$document['crtxt_trait']           = array_values(
				array_map( 'intval', wp_get_object_terms( $post->ID, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) ) )
			);
		}

		if ( $include_lifecycle_meta ) {
			$document['modified_at'] = $this->format_gmt_date( $post->post_modified_gmt );
			$meta                    = array(
				'cortext_document_icon' => $icon,
				'cortext_fields'        => Document::collection_field_ids( (int) $post->ID ),
			);
			if ( $include_trash_meta ) {
				$meta[ TrashCascade::PARENT_MARKER_META ]     = (int) get_post_meta( $post->ID, TrashCascade::PARENT_MARKER_META, true );
				$meta[ TrashCascade::COLLECTION_MARKER_META ] = (int) get_post_meta( $post->ID, TrashCascade::COLLECTION_MARKER_META, true );
				$document                                     = array_merge( $document, $this->trash_details( $post ) );
			}
			if ( $include_archive_meta ) {
				$meta[ ArchiveCascade::PARENT_MARKER_META ]     = (int) get_post_meta( $post->ID, ArchiveCascade::PARENT_MARKER_META, true );
				$meta[ ArchiveCascade::COLLECTION_MARKER_META ] = (int) get_post_meta( $post->ID, ArchiveCascade::COLLECTION_MARKER_META, true );
				$document                                       = array_merge(
					$document,
					self::lifecycle_details(
						'archived',
						(int) get_post_meta( $post->ID, ArchiveCascade::TIME_META, true ),
						(int) get_post_meta( $post->ID, ArchiveCascade::ARCHIVED_BY_USER_META, true )
					)
				);
			}
			$document['meta'] = $meta;
		}

		return $document;
	}

	/**
	 * When the document went to trash, who sent it there, and when WordPress's
	 * scheduled cleanup will delete it. With `EMPTY_TRASH_DAYS` at 0 the
	 * cleanup's cutoff is now, so `purge_at` equals `trashed_at` and the next
	 * daily run deletes it. `trashed_by` is null for
	 * documents trashed before the user was recorded, or whose user is gone.
	 *
	 * @param WP_Post $post Trashed document.
	 * @return array{trashed_at: string, purge_at: string, trashed_by: ?array{id: int, name: string}}
	 */
	private function trash_details( WP_Post $post ): array {
		$trashed_at = (int) get_post_meta( $post->ID, '_wp_trash_meta_time', true );

		$details             = self::lifecycle_details(
			'trashed',
			$trashed_at,
			(int) get_post_meta( $post->ID, TrashCascade::TRASHED_BY_USER_META, true )
		);
		$details['purge_at'] = $trashed_at > 0
			? gmdate( 'c', $trashed_at + EMPTY_TRASH_DAYS * DAY_IN_SECONDS )
			: '';

		return $details;
	}

	/**
	 * When a document entered a lifecycle state and who put it there, as
	 * `{$state}_at` and `{$state}_by` (`trashed_at`, `archived_by`, `frozen_at`, ...).
	 * The date is empty when none was recorded. The user is null when none
	 * was recorded or the user is gone.
	 *
	 * @param string $state   Key prefix, such as `trashed`, `archived` or `frozen`.
	 * @param int    $time    Unix timestamp the state was entered, 0 if unknown.
	 * @param int    $user_id User who moved the document there, 0 if unknown.
	 * @return array<string, mixed>
	 */
	public static function lifecycle_details( string $state, int $time, int $user_id ): array {
		$user = get_userdata( $user_id );

		return array(
			"{$state}_at" => $time > 0 ? gmdate( 'c', $time ) : '',
			"{$state}_by" => $user instanceof WP_User
				? array(
					'id'   => (int) $user->ID,
					'name' => $user->display_name,
				)
				: null,
		);
	}

	private function format_gmt_date( string $mysql_gmt ): string {
		$timestamp = strtotime( $mysql_gmt . ' UTC' );
		return false === $timestamp ? '' : gmdate( 'c', $timestamp );
	}

	/**
	 * Whether a document status keeps it live: neither archived nor in the
	 * trash. A row lives in the collections whose status is live.
	 *
	 * @param string $status Post status.
	 */
	public static function is_live_status( string $status ): bool {
		return ! in_array( $status, array( self::STATUS_ARCHIVED, self::STATUS_TRASH ), true );
	}

	/**
	 * Derives the document kind label from state for internal branching.
	 * Returns null when the post does not opt into the `cortext-document`
	 * trait. Not part of the wire shape; consumers derive UI copy from the
	 * loaded record's capabilities.
	 *
	 * @param WP_Post $post Document post.
	 */
	public static function kind_for_document( WP_Post $post ): ?string {
		if ( ! post_type_supports( $post->post_type, 'cortext-document' ) ) {
			return null;
		}
		if ( Document::is_collection_post( $post ) ) {
			return self::KIND_COLLECTION;
		}
		if ( self::has_trait_term( $post ) ) {
			return self::KIND_ROW;
		}
		return self::KIND_PAGE;
	}

	/**
	 * Workspace path for any document: `<slug>-<id>`, or `<id>` for fresh
	 * drafts with no `post_name`. Mirrors `computeDocumentUri` on the JS side.
	 *
	 * @param WP_Post $post Document post.
	 */
	private function path_for( WP_Post $post ): string {
		$slug = trim( (string) $post->post_name );
		return '' === $slug ? (string) $post->ID : "{$slug}-{$post->ID}";
	}

	/**
	 * Whether the document carries at least one `crtxt_trait` term.
	 *
	 * @param WP_Post $post Document post.
	 */
	private static function has_trait_term( WP_Post $post ): bool {
		if ( Document::POST_TYPE !== $post->post_type ) {
			return false;
		}
		$terms = wp_get_object_terms(
			(int) $post->ID,
			TraitTaxonomy::TAXONOMY,
			array( 'fields' => 'ids' )
		);
		return is_array( $terms ) && count( $terms ) > 0;
	}

	/**
	 * Returns the first active trait (collection) document that a row document is a
	 * member of. Reads the document's `crtxt_trait` term, extracts the trait
	 * document id from the deterministic term slug, and loads the document.
	 *
	 * In the universal model, traits are just `crtxt_document` posts with a
	 * `cortext_fields` meta. A row can belong to multiple traits (multi-trait
	 * membership), but most legacy callers expect a singular "owning trait" —
	 * this helper returns the first live one found. Callers that need all
	 * traits, including retired memberships kept for restore, should use
	 * `find_traits_for_document`.
	 *
	 * @param WP_Post $document Row document post.
	 */
	public function find_trait_for_document( WP_Post $document ): ?WP_Post {
		$document_id = (int) $document->ID;
		if ( array_key_exists( $document_id, $this->trait_cache ) ) {
			$cached = $this->trait_cache[ $document_id ];
			if ( $cached instanceof WP_Post ) {
				$fresh = get_post( $cached->ID );
				if ( $fresh instanceof WP_Post && self::is_live_status( $fresh->post_status ) ) {
					return $fresh;
				}
			}
			unset( $this->trait_cache[ $document_id ] );
		}

		$live_traits = $this->find_live_traits_for_document( $document );
		$trait       = $live_traits[0] ?? null;

		$this->trait_cache[ $document_id ] = $trait;
		return $trait;
	}

	/**
	 * Returns every collection (trait) document a row is a member of. A row can
	 * carry several `crtxt_trait` terms; `find_trait_for_document`
	 * returns the first of these as the source collection. Terms whose mirror
	 * document no longer exists or is no longer a collection are skipped.
	 *
	 * @param WP_Post $document Row document post.
	 * @return WP_Post[]
	 */
	public function find_traits_for_document( WP_Post $document ): array {
		$terms = get_the_terms( (int) $document->ID, TraitTaxonomy::TAXONOMY );
		if ( ! is_array( $terms ) || count( $terms ) === 0 ) {
			return array();
		}

		$collections = array();
		foreach ( $terms as $term ) {
			$trait_id = TraitTaxonomy::trait_id_from_slug( (string) $term->slug );
			if ( $trait_id < 1 ) {
				continue;
			}
			$candidate = get_post( $trait_id );
			if (
				$candidate instanceof WP_Post
				&& Document::POST_TYPE === $candidate->post_type
				&& Document::is_collection( $trait_id )
			) {
				$collections[] = $candidate;
			}
		}
		return $collections;
	}

	/**
	 * Returns the row's live collection memberships: those neither archived
	 * nor in the trash. Full membership lookup keeps retired collections so
	 * their cascades can restore shared rows; source selection ignores them.
	 *
	 * @param WP_Post $document Row document post.
	 * @return WP_Post[]
	 */
	public function find_live_traits_for_document( WP_Post $document ): array {
		return array_values(
			array_filter(
				$this->find_traits_for_document( $document ),
				static fn( WP_Post $collection ): bool => self::is_live_status( $collection->post_status )
			)
		);
	}

	/**
	 * Returns the collections whose properties a row shows. A row that still
	 * lives somewhere shows only its live collections; a row retired together
	 * with all of its collections keeps showing them, read-only.
	 *
	 * @param WP_Post $document Row document post.
	 * @return WP_Post[]
	 */
	public function find_visible_traits_for_document( WP_Post $document ): array {
		$live = $this->find_live_traits_for_document( $document );
		return count( $live ) > 0 ? $live : $this->find_traits_for_document( $document );
	}

	/**
	 * Collection ids a document currently belongs to. Thin wrapper over
	 * `find_traits_for_document` for callers that only need the ids (membership
	 * diffs, sidecar cleanup).
	 *
	 * @param int $document_id Document id.
	 * @return int[]
	 */
	public function membership_ids( int $document_id ): array {
		$post = get_post( $document_id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return array();
		}
		return array_map(
			static fn( WP_Post $collection ): int => (int) $collection->ID,
			$this->find_traits_for_document( $post )
		);
	}

	/**
	 * Formatted `{id,title,path,icon,active,readable}` summaries for every
	 * collection a document belongs to. The traits REST endpoint and the
	 * membership chips render this. `active` is false for memberships whose
	 * collection is archived or in the trash: those stay in the set so restore
	 * keeps working, but a row that lives elsewhere does not show or write
	 * their fields. A collection the current user cannot read is listed with
	 * its id and flags only (`readable` false), so a write can keep the
	 * membership without learning what the collection is.
	 *
	 * @param int $document_id Document id.
	 * @return array<int,array<string,mixed>>
	 */
	public function get_memberships( int $document_id ): array {
		$post = get_post( $document_id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return array();
		}
		return array_map(
			function ( WP_Post $collection ): array {
				$readable = current_user_can( 'read_post', $collection->ID );
				$summary  = $readable
					? $this->format_collection_summary( $collection )
					: array( 'id' => (int) $collection->ID );

				$summary['active']   = self::is_live_status( $collection->post_status );
				$summary['readable'] = $readable;
				return $summary;
			},
			$this->find_traits_for_document( $post )
		);
	}

	/**
	 * Replaces a document's collection memberships with the given set, letting a
	 * row belong to several collections at once. Each id must be a
	 * collection (resolve a mirror term); unknown or non-collection ids abort the
	 * whole write. Deduplicates and writes the full term set in one call, so the
	 * manual-order append hook only fires for genuinely new memberships. An empty
	 * set removes every membership (the document becomes a page); callers that
	 * must keep at least one membership guard before calling this.
	 *
	 * @param int   $document_id    Row document id.
	 * @param int[] $collection_ids Collections the document should belong to.
	 * @return int[]|WP_Error Resolved (deduplicated) collection ids on success.
	 */
	public function set_memberships( int $document_id, array $collection_ids ): array|WP_Error {
		$post = get_post( $document_id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$current_ids = $this->membership_ids( $document_id );
		$resolved    = array();
		$term_ids    = array();
		foreach ( $collection_ids as $collection_id ) {
			$collection_id = (int) $collection_id;
			if ( $collection_id < 1 || isset( $resolved[ $collection_id ] ) ) {
				continue;
			}
			$collection = get_post( $collection_id );
			$term_id    = TraitTaxonomy::term_id_for_trait( $collection_id );
			if (
				! $collection instanceof WP_Post
				|| (
					! self::is_live_status( $collection->post_status )
					&& ! in_array( $collection_id, $current_ids, true )
				)
				|| $term_id < 1
				|| ! Document::is_collection_post( $collection )
			) {
				return new WP_Error(
					'cortext_trait_not_found',
					__( 'Collection not found.', 'cortext' ),
					array(
						'status'        => 404,
						'collection_id' => $collection_id,
					)
				);
			}
			$resolved[ $collection_id ] = true;
			$term_ids[]                 = $term_id;
		}

		$set = wp_set_object_terms( $document_id, $term_ids, TraitTaxonomy::TAXONOMY, false );
		if ( $set instanceof WP_Error ) {
			return $set;
		}

		unset( $this->trait_cache[ $document_id ] );
		return array_keys( $resolved );
	}

	/**
	 * Formats a collection document into the `{id,title,path,icon}` summary the
	 * shell renders as breadcrumb segments and collection chips.
	 *
	 * @param WP_Post $collection Collection document post.
	 * @return array<string,mixed>
	 */
	private function format_collection_summary( WP_Post $collection ): array {
		$summary = array(
			'id'    => (int) $collection->ID,
			'title' => $this->post_title( $collection ),
			'path'  => $this->path_for( $collection ),
		);
		$icon    = (string) get_post_meta( $collection->ID, DocumentIdentity::META_KEY, true );
		if ( '' !== $icon ) {
			$summary['icon'] = $icon;
		}
		return $summary;
	}

	/**
	 * Resolves a document target by id and returns the shape used by
	 * Favorites, Recents, and Workspace Home. Those callers pass an id, and
	 * the documents service handles kind lookup, validation, and formatting
	 * in one place.
	 *
	 * @param int   $id   Target document id.
	 * @param array $opts {
	 *     Optional. Validation options.
	 *
	 *     @type bool $require_edit Enforce `edit_post` capability. Defaults to true.
	 * }
	 * @return array<string,mixed>|WP_Error
	 */
	public function format_target( int $id, array $opts = array() ) {
		$require_edit = ! array_key_exists( 'require_edit', $opts ) || (bool) $opts['require_edit'];

		if ( $id < 1 ) {
			return $this->invalid_target_error();
		}

		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || self::STATUS_TRASH === $post->post_status ) {
			return $this->target_not_found_error();
		}

		$kind = self::kind_for_document( $post );
		if ( null === $kind ) {
			return $this->target_not_found_error();
		}
		if ( self::STATUS_ARCHIVED === $post->post_status ) {
			return $this->target_hidden_error();
		}

		if ( self::KIND_ROW === $kind ) {
			$row_check = $this->validate_row_target( $post, $require_edit );
			if ( $row_check instanceof WP_Error ) {
				return $row_check;
			}
			$document = $this->format_document( $post );
			return $document ?? $this->target_not_found_error();
		}

		if ( $require_edit && ! current_user_can( 'edit_post', $id ) ) {
			return $this->target_forbidden_error();
		}

		$target = array(
			'id'    => $id,
			'title' => $this->post_title( $post ),
			'path'  => $this->path_for( $post ),
		);

		$icon = (string) get_post_meta( $id, DocumentIdentity::META_KEY, true );
		if ( '' !== $icon ) {
			$target['icon'] = $icon;
		}

		return $target;
	}

	/**
	 * Resolves a row's parent trait and runs the permission check. The row's
	 * `crtxt_trait` term names the trait, so callers do not pass a
	 * separate trait id; the lookup is cached for the service instance.
	 *
	 * @param WP_Post $row          Row document post.
	 * @param bool    $require_edit Enforce `edit_post` on both row and trait.
	 */
	private function validate_row_target( WP_Post $row, bool $require_edit ): ?WP_Error {
		// A shared row stays reachable through any live collection. Without one,
		// an archived collection hides it and a trashed one makes it unreachable.
		$trait = $this->find_live_traits_for_document( $row )[0] ?? null;
		if ( ! $trait instanceof WP_Post ) {
			foreach ( $this->find_traits_for_document( $row ) as $collection ) {
				if ( self::STATUS_ARCHIVED === $collection->post_status ) {
					return $this->target_hidden_error();
				}
			}
			return $this->target_not_found_error();
		}

		if ( $require_edit
			&& ( ! current_user_can( 'edit_post', $trait->ID )
				|| ! current_user_can( 'edit_post', $row->ID ) )
		) {
			return $this->target_forbidden_error();
		}

		return null;
	}

	private function invalid_target_error(): WP_Error {
		return new WP_Error(
			'cortext_document_target_invalid',
			__( 'Target document is invalid.', 'cortext' ),
			array( 'status' => 400 )
		);
	}

	private function target_not_found_error(): WP_Error {
		return new WP_Error(
			'cortext_document_target_not_found',
			__( 'Target document was not found.', 'cortext' ),
			array( 'status' => 404 )
		);
	}

	private function target_hidden_error(): WP_Error {
		return new WP_Error(
			'cortext_document_target_hidden',
			__( 'Target document is hidden.', 'cortext' ),
			array( 'status' => 404 )
		);
	}

	private function target_forbidden_error(): WP_Error {
		return new WP_Error(
			'cortext_document_target_forbidden',
			__( 'You are not allowed to use this document target.', 'cortext' ),
			array( 'status' => 403 )
		);
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
	 * trait field meta (text, email, url), not only title/content/excerpt.
	 * Pages and collections in the same result set fall back to WP's default
	 * search clause behavior (their post_type still gets the title/content
	 * branches inside `build_documents_search_sql`).
	 *
	 * Returns null for an empty search or a workspace without any trait that
	 * defines text-like fields.
	 *
	 * @param string $search Trimmed search string.
	 */
	private function build_search_filter( string $search ): ?callable {
		if ( '' === $search ) {
			return null;
		}

		$row_text_keys = $this->collect_row_text_keys();
		if ( count( $row_text_keys ) === 0 ) {
			return null;
		}

		return function (
			string $search_sql,
			WP_Query $wp_query
		) use (
			$search,
			$row_text_keys
		): string {
			unset( $wp_query );
			return $this->build_documents_search_sql( $search, $row_text_keys );
		};
	}

	/**
	 * Collects the text-like field meta keys across every trait in the
	 * workspace. Returns the unique set of keys; trait-specific scoping is
	 * not required because the meta key encodes the field id.
	 *
	 * @return string[]
	 */
	private function collect_row_text_keys(): array {
		$keys   = array();
		$traits = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => array( 'publish', 'draft', 'private' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => 'cortext_fields',
						'compare' => 'EXISTS',
					),
				),
			)
		);
		foreach ( $traits as $trait_id ) {
			$schema = $this->rows_filter_query->field_schema_for( (int) $trait_id );
			foreach ( $schema as $field ) {
				if ( empty( $field['system'] ) && FieldTypeRegistry::is_text_like( (string) $field['type'] ) ) {
					$keys[ (string) $field['key'] ] = true;
				}
			}
		}
		return array_keys( $keys );
	}

	/**
	 * Builds the SQL used by the documents endpoint instead of WP_Query's
	 * default search clause. Each search term must match somewhere. Pages
	 * and traits use title/content/excerpt; row documents can also use
	 * text-like trait field meta values.
	 *
	 * @param string   $search        Search string.
	 * @param string[] $row_text_keys Text-like field meta keys.
	 */
	private function build_documents_search_sql( string $search, array $row_text_keys ): string {
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

			if ( count( $row_text_keys ) > 0 ) {
				$meta_sql = $this->rows_filter_query->meta_search_sql( $row_text_keys, $like );
				if ( '' !== $meta_sql ) {
					$branches[] = '( ' . $wpdb->prepare( "{$wpdb->posts}.post_type = %s", Document::POST_TYPE ) . " AND {$meta_sql} )";
				}
			}
			// phpcs:enable

			$term_clauses[] = '( ' . implode( ' OR ', $branches ) . ' )';
		}

		return ' AND ( ' . implode( ' AND ', $term_clauses ) . ' )';
	}

	/**
	 * Returns a `posts_search_orderby` filter that ranks documents by where
	 * the query lives in them.
	 *
	 * @param string $search Trimmed search string.
	 */
	private function build_search_orderby_filter( string $search ): ?callable {
		if ( '' === $search ) {
			return null;
		}

		return function (
			string $search_orderby,
			WP_Query $wp_query
		) use ( $search ): string {
			unset( $wp_query, $search_orderby );

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
