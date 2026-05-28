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

use Cortext\Relations;
use Cortext\Taxonomy\TraitTaxonomy;
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
	 * Marks a row as trashed by its collection. The value is the collection's
	 * id, so restoring the collection brings back only the rows its own
	 * cascade trashed. Rows already in trash stay unmarked.
	 */
	public const COLLECTION_MARKER_META = '_cortext_trashed_by_collection';

	private const ACTIVE_STATUSES = array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft' );

	public function register(): void {
		// Attach filters immediately so tests and admin flows see them right
		// after register(). Marker meta still waits for init, matching
		// register_post_meta.
		add_action( 'init', array( $this, 'register_meta' ) );
		add_action( 'wp_trash_post', array( $this, 'on_trash' ), 10, 1 );
		add_action( 'untrashed_post', array( $this, 'on_restore' ), 10, 1 );
		// Runs before `TraitTaxonomy::sync_term_on_delete` (priority 10), so
		// `all_row_ids()` still resolves the trait term and can collect the
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

		foreach ( $this->active_child_ids( $post_id ) as $child_id ) {
			update_post_meta( $child_id, self::PARENT_MARKER_META, $post_id );
			wp_trash_post( $child_id );
		}

		if ( Document::is_collection( $post_id ) ) {
			foreach ( $this->active_row_ids( $post_id ) as $row_id ) {
				update_post_meta( $row_id, self::COLLECTION_MARKER_META, $post_id );
				wp_trash_post( $row_id );
			}
		}
	}

	/**
	 * Restores only the children this document moved to trash. Clears markers
	 * along the way so a later ancestor restore does not pull anything back
	 * twice.
	 *
	 * @param int $post_id Document id that was just restored.
	 */
	public function on_restore( int $post_id ): void {
		if ( Document::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		// Clear the restored document's own markers so a later ancestor
		// restore cannot pull it through the cascade again.
		delete_post_meta( $post_id, self::PARENT_MARKER_META );
		delete_post_meta( $post_id, self::COLLECTION_MARKER_META );

		foreach ( $this->trashed_children_marked_by( $post_id ) as $child_id ) {
			wp_untrash_post( $child_id );
			delete_post_meta( $child_id, self::PARENT_MARKER_META );
		}

		if ( Document::is_collection( $post_id ) ) {
			foreach ( $this->trashed_rows_marked_by( $post_id ) as $row_id ) {
				wp_untrash_post( $row_id );
				delete_post_meta( $row_id, self::COLLECTION_MARKER_META );
			}
		}
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

		if ( ! Document::is_collection( $post_id ) ) {
			return;
		}

		foreach ( $this->all_row_ids( $post_id ) as $row_id ) {
			wp_delete_post( $row_id, true );
		}
	}

	/**
	 * Walks the trashed-and-marked subtree below a document. Combines both
	 * cascade rules with a BFS so a trashed collection nested under a page
	 * brings down its own rows.
	 *
	 * REST restore and permanent-delete call this before mutating the root,
	 * because the synchronous WordPress hooks have already changed the
	 * descendants by the time the call returns.
	 *
	 * @param int $root_id Root document id to walk from.
	 * @return int[] Trashed descendant ids (root excluded), no guaranteed order.
	 */
	public function descendants_for_root( int $root_id ): array {
		if ( Document::POST_TYPE !== get_post_type( $root_id ) ) {
			return array();
		}

		$collected = array();
		$seen      = array( $root_id => true );
		$frontier  = array( $root_id );

		while ( ! empty( $frontier ) ) {
			$next = array();
			foreach ( $frontier as $current ) {
				foreach ( $this->trashed_children_marked_by( $current ) as $child_id ) {
					if ( isset( $seen[ $child_id ] ) ) {
						continue;
					}
					$seen[ $child_id ] = true;
					$collected[]       = $child_id;
					$next[]            = $child_id;
				}
				if ( Document::is_collection( $current ) ) {
					foreach ( $this->trashed_rows_marked_by( $current ) as $row_id ) {
						if ( isset( $seen[ $row_id ] ) ) {
							continue;
						}
						$seen[ $row_id ] = true;
						$collected[]     = $row_id;
						$next[]          = $row_id;
					}
				}
			}
			$frontier = $next;
		}

		return $collected;
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

		$data['cascade_deleted'] = $this->descendants_for_root( (int) $post->ID );
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
	 * Active children of `$parent_id` via `post_parent`.
	 *
	 * @param int $parent_id Document id.
	 * @return int[]
	 */
	private function active_child_ids( int $parent_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_parent'    => $parent_id,
				'post_status'    => self::ACTIVE_STATUSES,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);
		return array_map( 'intval', $ids );
	}

	/**
	 * Trashed children tagged with `$parent_id`'s parent marker.
	 *
	 * @param int $parent_id Document id whose marker tags the children.
	 * @return int[]
	 */
	private function trashed_children_marked_by( int $parent_id ): array {
		$ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::PARENT_MARKER_META,  // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $parent_id,       // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
		return array_map( 'intval', $ids );
	}

	/**
	 * Active rows of the collection `$collection_id`.
	 *
	 * @param int $collection_id Collection document id.
	 * @return int[]
	 */
	private function active_row_ids( int $collection_id ): array {
		return $this->row_ids_for_collection( $collection_id, self::ACTIVE_STATUSES );
	}

	/**
	 * Trashed rows tagged with `$collection_id`'s collection marker.
	 *
	 * @param int $collection_id Collection document id whose marker tags the rows.
	 * @return int[]
	 */
	private function trashed_rows_marked_by( int $collection_id ): array {
		$term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $term_id < 1 ) {
			return array();
		}
		$ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::COLLECTION_MARKER_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (string) $collection_id,      // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
					array(
						'taxonomy' => TraitTaxonomy::TAXONOMY,
						'field'    => 'term_id',
						'terms'    => array( $term_id ),
					),
				),
			)
		);
		return array_map( 'intval', $ids );
	}

	/**
	 * All rows of `$collection_id`, including trashed ones. Used on permanent
	 * delete to clean up rows that the trait term still points at.
	 *
	 * @param int $collection_id Collection document id.
	 * @return int[]
	 */
	private function all_row_ids( int $collection_id ): array {
		return $this->row_ids_for_collection(
			$collection_id,
			array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft', 'trash' )
		);
	}

	/**
	 * Rows of a collection in the given statuses.
	 *
	 * @param int      $collection_id Collection document id.
	 * @param string[] $statuses      Post status filter.
	 */
	private function row_ids_for_collection( int $collection_id, array $statuses ): array {
		$term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $term_id < 1 ) {
			return array();
		}
		$ids = get_posts(
			array(
				'post_type'      => Document::POST_TYPE,
				'post_status'    => $statuses,
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
					array(
						'taxonomy' => TraitTaxonomy::TAXONOMY,
						'field'    => 'term_id',
						'terms'    => array( $term_id ),
					),
				),
			)
		);
		return array_map( 'intval', $ids );
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
