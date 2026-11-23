<?php
/**
 * Trash cascade for `crtxt_document` posts.
 *
 * One class owns every cascade rule. Two composable rules cover the universal
 * document model:
 *   - Children of the trashed post via `post_parent` follow it to trash.
 *   - If the trashed post is a collection (has `cortext_fields` meta), its
 *     rows (documents tagged with the collection's trait term) follow too.
 *
 * A doc that is both nested under a page and a collection of its own gets
 * handled naturally: the parent's trash cascades down via `post_parent`, and
 * the doc's own trash cascades to its rows via the trait term.
 *
 * `DocumentsController` asks this class for descendants before restore or
 * permanent delete, because the WordPress hooks run synchronously inside
 * `wp_untrash_post` / `wp_delete_post` and a query after the call cannot tell
 * which descendants changed.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use Cortext\FieldValues\FieldValueIndex;
use Cortext\Relations;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class TrashCascade {

	/**
	 * Marks a child as trashed by its parent. The value is the immediate
	 * parent's id, so any restored node can find its own children. Children
	 * already in trash stay unmarked and do not come back with a later parent
	 * restore.
	 */
	public const PARENT_MARKER_META = '_cortext_trashed_by_parent';

	/**
	 * Marks a row as trashed after its last active collection is trashed. The
	 * value records the collection that caused that transition. Restoring any
	 * collection the row still belongs to revives it; rows already in trash
	 * stay unmarked.
	 */
	public const COLLECTION_MARKER_META = '_cortext_trashed_by_collection';

	/**
	 * User who moved the document to trash. Cascaded children record the
	 * same user as their root.
	 */
	public const TRASHED_BY_USER_META = '_cortext_trashed_by_user';

	private const ACTIVE_STATUSES = array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft', Documents::STATUS_ARCHIVED );

	private DocumentCascade $cascade;

	public function __construct( ?DocumentCascade $cascade = null ) {
		$this->cascade = $cascade ?? new DocumentCascade(
			self::ACTIVE_STATUSES,
			Documents::STATUS_TRASH,
			self::PARENT_MARKER_META,
			self::COLLECTION_MARKER_META
		);
	}

	public function register(): void {
		// Attach filters immediately so tests and admin flows see them right
		// after register(). Marker meta still waits for init, matching
		// register_post_meta.
		add_action( 'init', array( $this, 'register_meta' ) );
		add_action( 'wp_trash_post', array( $this, 'on_trash' ), 10, 1 );
		add_action( 'untrashed_post', array( $this, 'on_restore' ), 10, 1 );
		// Runs before `TraitTaxonomy::sync_term_on_delete` (priority 10), so
		// `row_ids_for_collection()` still resolves the trait term and can collect the
		// collection's rows. Direct `wp_delete_post( $collection_id, true )`
		// would otherwise orphan rows if the term were gone first.
		add_action( 'before_delete_post', array( $this, 'on_delete' ), 5, 1 );
		add_action( 'rest_api_init', array( $this, 'register_rest_filters' ) );
		// Core adds wp_untrash_post_set_previous_status only in
		// wp-admin/edit.php's bulk-untrash flow. REST, WP-CLI, and the
		// cascade would otherwise restore documents as drafts.
		add_filter( 'wp_untrash_post_status', array( $this, 'restore_previous_status' ), 10, 3 );
		// edit.php's bulk loop calls `wp_die()` when `wp_trash_post` returns
		// false, which happens once the cascade already trashed a selected
		// descendant. Renaming the actions routes them through
		// `handle_bulk_actions-{screen}` so the no-op counts as processed
		// instead of dying.
		add_filter(
			'bulk_actions-edit-' . Document::POST_TYPE,
			array( $this, 'replace_bulk_actions' )
		);
		add_filter(
			'handle_bulk_actions-edit-' . Document::POST_TYPE,
			array( $this, 'handle_admin_bulk_action' ),
			10,
			3
		);
	}

	public function register_meta(): void {
		register_post_meta(
			Document::POST_TYPE,
			self::PARENT_MARKER_META,
			array(
				'type'          => 'integer',
				'single'        => true,
				// The sidebar Trash section reads this marker to show only
				// cascade roots and walk each subtree on the client.
				'show_in_rest'  => true,
				'auth_callback' => static function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		register_post_meta(
			Document::POST_TYPE,
			self::COLLECTION_MARKER_META,
			array(
				'type'          => 'integer',
				'single'        => true,
				'show_in_rest'  => false,
				'auth_callback' => static function () {
					return false;
				},
			)
		);
	}

	public function register_rest_filters(): void {
		// Documents cascade into descendants and rows; the response to a REST
		// trash should carry those ids so the client can drop them from
		// favorites without re-computing the cascade locally.
		add_filter(
			'rest_prepare_' . Document::POST_TYPE,
			array( $this, 'extend_trash_response' ),
			10,
			3
		);
	}

	/**
	 * Cascades trash from a document down to its `post_parent` children and,
	 * if the document is a collection, to its rows.
	 *
	 * @param int $post_id Document id that was just moved to trash.
	 */
	public function on_trash( int $post_id ): void {
		if ( Document::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		update_post_meta( $post_id, self::TRASHED_BY_USER_META, get_current_user_id() );

		// A row stays live while another live collection still exposes it.
		// Retired memberships remain attached for restore, but do not count as
		// a home: retiring the last live collection must not leave a live row
		// visible nowhere.
		$this->cascade->cascade(
			$post_id,
			static function ( int $child_id ): void {
				wp_trash_post( $child_id );
			},
			array( DocumentCascade::class, 'has_other_live_membership' )
		);
	}

	/**
	 * Restores only the children this document moved to trash. Clears markers
	 * along the way so a later ancestor restore does not pull anything back
	 * twice.
	 *
	 * @param int $post_id Document id that was just restored.
	 */
	public function on_restore( int $post_id ): void {
		delete_post_meta( $post_id, self::TRASHED_BY_USER_META );

		$this->cascade->restore(
			$post_id,
			static function ( int $child_id ): void {
				wp_untrash_post( $child_id );
			},
			true
		);

		// Rows archived with their last live collection have a live one again.
		// They go after the rows above, because a row archived before it was
		// trashed has just come back as archived.
		if ( Document::is_collection( $post_id ) && Documents::is_live_status( (string) get_post_status( $post_id ) ) ) {
			( new ArchiveCascade() )->unarchive_collection_rows( $post_id );
		}
	}

	/**
	 * Rows of a collection that a collection's trash cascade moved to Trash.
	 *
	 * @param int $collection_id Collection document id.
	 * @return int[]
	 */
	public function rows_trashed_with_collection( int $collection_id ): array {
		return $this->cascade->rows_moved_by_any_collection( $collection_id );
	}

	/**
	 * On permanent delete, removes the rows of the collection. The page
	 * subtree is handled leaves-first by `DocumentsController` via
	 * `descendants_for_root`, so the post_parent cascade is intentionally
	 * skipped here; WordPress's hierarchical reparenting would otherwise move
	 * non-leaf descendants before they can be cleaned up.
	 *
	 * @param int $post_id Document id about to be permanently deleted.
	 */
	public function on_delete( int $post_id ): void {
		if ( Document::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		// Drop this document's id from the reverse relation fields of any row
		// that points at it, so a permanent delete never leaves a dangling
		// reference behind in meta or the field-value index. The collection
		// cascade below deletes each row with `wp_delete_post`, which re-enters
		// this hook, so cascaded rows get the same cleanup.
		Relations::remove_deleted_row_references( $post_id );

		if ( ! Document::is_collection( $post_id ) ) {
			return;
		}

		$rows               = $this->cascade->row_ids_for_collection(
			$post_id,
			array_merge( self::ACTIVE_STATUSES, array( Documents::STATUS_TRASH ) )
		);
		$relation_field_ids = array_values(
			array_filter(
				Document::collection_field_ids( $post_id ),
				static fn( int $field_id ): bool => 'relation' === (string) get_post_meta( $field_id, 'type', true )
			)
		);

		foreach ( $rows as $row_id ) {
			// Keep rows that still belong to another collection. This hook runs
			// before `TraitTaxonomy::sync_term_on_delete` removes the collection's
			// term, so a shared row still reports both memberships here; deleting
			// the term later drops only this membership and leaves the document
			// alive in its other collections. Rows exclusive to this collection
			// are deleted with it.
			$other_collection_ids = DocumentCascade::other_memberships( $row_id, $post_id );
			if ( count( $other_collection_ids ) > 0 ) {
				// The row survives, so its delete hook will not detach the reverse
				// pointers belonging exclusively to fields in the deleted collection.
				// A field can be shared by schemas, so keep pointers for definitions
				// the row still owns through another membership.
				$retained_fields = array();
				foreach ( $other_collection_ids as $other_collection_id ) {
					foreach ( Document::collection_field_ids( $other_collection_id ) as $field_id ) {
						$retained_fields[ (int) $field_id ] = true;
					}
				}
				$detached_field_ids = array_values(
					array_filter(
						$relation_field_ids,
						static fn( int $field_id ): bool => ! isset( $retained_fields[ $field_id ] )
					)
				);
				if ( count( $detached_field_ids ) > 0 ) {
					Relations::remove_deleted_row_references( $row_id, $detached_field_ids );
				}

				// A direct force-delete can remove the row's last live collection
				// without first running the collection trash cascade. Preserve the
				// row for its retired memberships, but keep it out of the live set
				// until one of those collections is restored.
				if (
					in_array( get_post_status( $row_id ), self::ACTIVE_STATUSES, true )
					&& ! DocumentCascade::has_other_live_membership( $row_id, $post_id )
				) {
					update_post_meta( $row_id, self::COLLECTION_MARKER_META, $post_id );
					wp_trash_post( $row_id );
				}
				continue;
			}
			wp_delete_post( $row_id, true );
		}

		// Relation detachment can re-index surviving shared targets while the
		// collection's mirror term still exists. FieldValueIndex's normal hook
		// runs after that term is removed and can no longer recognize the post as
		// a collection, so make this the final collection-scoped sidecar write.
		$post = get_post( $post_id );
		( new FieldValueIndex() )->cleanup_deleted_post(
			$post_id,
			$post instanceof WP_Post ? $post : null
		);
	}

	/**
	 * Walks the trashed-and-marked subtree below a document. Combines both
	 * cascade rules with a BFS so a trashed collection nested under a page
	 * brings down its own rows.
	 *
	 * Permanent-delete calls this before mutating the root, because the
	 * synchronous WordPress hooks have already changed the descendants by the
	 * time the call returns. Shared rows are omitted so another membership can
	 * retain them.
	 *
	 * @param int $root_id Root document id to walk from.
	 * @return int[] Trashed descendant ids (root excluded), no guaranteed order.
	 */
	public function descendants_for_root( int $root_id ): array {
		return $this->cascade->descendants_for_root(
			$root_id,
			static fn( int $row_id, int $collection_id ): bool => count( DocumentCascade::other_memberships( $row_id, $collection_id ) ) > 0
		);
	}

	/**
	 * Walks the subtree that restoring a document will revive. Unlike the
	 * permanent-delete walk, this includes shared rows marked by any collection
	 * cascade: restoring one of their memberships makes them live again even
	 * when a different collection caused the original trash transition. Rows
	 * archived with a collection that becomes live again come back too.
	 *
	 * @param int $root_id Root document id to walk from.
	 * @return int[] Candidate ids (root excluded), no guaranteed order.
	 */
	public function restore_candidates_for_root( int $root_id ): array {
		$candidates = $this->cascade->descendants_for_root( $root_id, null, true );
		$archive    = new ArchiveCascade();
		foreach ( array_merge( array( $root_id ), $candidates ) as $document_id ) {
			// A collection that returns to Archive leaves its archived rows there.
			if ( Documents::STATUS_ARCHIVED === (string) get_post_meta( $document_id, '_wp_trash_meta_status', true ) ) {
				continue;
			}
			$candidates = array_merge( $candidates, $archive->rows_archived_with_collection( $document_id ) );
		}

		return array_values( array_unique( $candidates ) );
	}

	/**
	 * Adds the cascade list to a REST trash response. The client uses it to
	 * filter favorites without re-walking the cascade locally.
	 *
	 * @param WP_REST_Response $response Prepared response.
	 * @param WP_Post          $post     Post being responded for.
	 * @param WP_REST_Request  $request  Incoming REST request.
	 */
	public function extend_trash_response( WP_REST_Response $response, WP_Post $post, WP_REST_Request $request ): WP_REST_Response {
		if ( 'DELETE' !== $request->get_method() ) {
			return $response;
		}

		$data = $response->get_data();
		if ( ! is_array( $data ) ) {
			return $response;
		}

		$data['cascade_deleted'] = $this->cascade->descendants_for_root( (int) $post->ID );
		$response->set_data( $data );
		return $response;
	}

	/**
	 * Restores a `crtxt_document` to the status it had before being trashed,
	 * falling back to the default ('draft') when no previous status is
	 * recorded.
	 *
	 * @param string $new_status      Status WordPress would otherwise assign on restore.
	 * @param int    $post_id         ID of the document being restored.
	 * @param string $previous_status Status the document held before it was trashed.
	 */
	public function restore_previous_status( string $new_status, int $post_id, string $previous_status ): string {
		if ( Document::POST_TYPE !== get_post_type( $post_id ) ) {
			return $new_status;
		}
		return '' !== $previous_status ? $previous_status : $new_status;
	}

	/**
	 * Swaps core's trash/untrash bulk actions for Cortext-prefixed clones.
	 * Renaming routes the actions through `handle_bulk_actions-{screen}`,
	 * which does not `wp_die()` on a false return from `wp_trash_post`. The
	 * cascade is allowed to no-op when a row is already trashed by its
	 * collection (or a child by its parent) in the same bulk request.
	 *
	 * @param array<string,string> $actions Bulk-action dropdown entries.
	 * @return array<string,string>
	 */
	public function replace_bulk_actions( array $actions ): array {
		if ( isset( $actions['trash'] ) ) {
			unset( $actions['trash'] );
			$actions['cortext_trash'] = __( 'Move to Trash', 'cortext' );
		}
		if ( isset( $actions['untrash'] ) ) {
			unset( $actions['untrash'] );
			$actions['cortext_untrash'] = __( 'Restore', 'cortext' );
		}
		return $actions;
	}

	/**
	 * Handles the cascade-safe bulk trash/untrash actions. A selected
	 * document counts as processed once it ends up in the requested status,
	 * whether the bulk loop changed it directly or a cascade got there
	 * first.
	 *
	 * @param mixed             $sendback URL the admin will redirect to after processing.
	 * @param string            $action   Bulk action identifier.
	 * @param array<int,string> $post_ids Selected post ids.
	 * @return mixed
	 */
	public function handle_admin_bulk_action( $sendback, string $action, array $post_ids ) {
		if ( 'cortext_trash' === $action ) {
			return $this->run_admin_bulk( (string) $sendback, $post_ids, 'trash' );
		}
		if ( 'cortext_untrash' === $action ) {
			return $this->run_admin_bulk( (string) $sendback, $post_ids, 'untrash' );
		}
		return $sendback;
	}

	/**
	 * Shared handler for the cascade-safe trash and untrash actions.
	 *
	 * @param string            $sendback URL the admin will redirect to after processing.
	 * @param array<int,string> $post_ids Selected post ids.
	 * @param string            $action   Either 'trash' or 'untrash'.
	 */
	private function run_admin_bulk( string $sendback, array $post_ids, string $action ): string {
		$count  = 0;
		$locked = 0;

		foreach ( $post_ids as $post_id ) {
			$post_id = (int) $post_id;
			if ( ! current_user_can( 'delete_post', $post_id ) ) {
				wp_die(
					'trash' === $action
						? esc_html__( 'Sorry, you are not allowed to move this item to the Trash.', 'cortext' )
						: esc_html__( 'Sorry, you are not allowed to restore this item from the Trash.', 'cortext' )
				);
			}

			if ( 'trash' === $action ) {
				if ( wp_check_post_lock( $post_id ) ) {
					++$locked;
					continue;
				}
				wp_trash_post( $post_id );
				if ( 'trash' === get_post_status( $post_id ) ) {
					++$count;
				}
			} else {
				wp_untrash_post( $post_id );
				if ( 'trash' !== get_post_status( $post_id ) ) {
					++$count;
				}
			}
		}

		$count_key = 'trash' === $action ? 'trashed' : 'untrashed';
		$args      = array(
			$count_key => $count,
			'ids'      => implode( ',', array_map( 'intval', $post_ids ) ),
		);
		if ( 'trash' === $action ) {
			$args['locked'] = $locked;
		}

		return add_query_arg( $args, $sendback );
	}
}
