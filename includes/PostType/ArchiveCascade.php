<?php
/**
 * Archive handling for `crtxt_document` posts.
 *
 * An archived document keeps its data but does not appear in regular workspace
 * views or on the public site. Its children and collection rows follow it.
 * Restoring the root returns each marked document to the status it had before
 * it was archived.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

defined( 'ABSPATH' ) || exit;

use Cortext\Documents;
use WP_Error;
use WP_Post;
use WP_REST_Request;

final class ArchiveCascade {

	/** Previous status recorded before a document is archived. */
	public const STATUS_META = '_cortext_archive_meta_status';

	/** Unix timestamp recorded when a document is archived. */
	public const TIME_META = '_cortext_archive_meta_time';

	/** Parent that caused this document to be archived. */
	public const PARENT_MARKER_META = '_cortext_archived_by_parent';

	/** Collection that caused this row to be archived. */
	public const COLLECTION_MARKER_META = '_cortext_archived_by_collection';

	private const ACTIVE_STATUSES        = array( 'publish', 'private', 'draft', 'pending', 'future', 'auto-draft' );
	private const DESIRED_POST_SLUG_META = '_wp_desired_post_slug';

	private DocumentCascade $cascade;

	/**
	 * IDs of archived documents being restored from Trash.
	 *
	 * @var array<int,true>
	 */
	private array $archived_untrash_ids = array();

	/**
	 * Original slug data saved while handling a Trash-to-Archive write.
	 *
	 * @var array<int,array{post_name:string,desired_post_slug:string,had_desired_post_slug:bool}>
	 */
	private array $trash_archive_slug_state = array();

	public function __construct( ?DocumentCascade $cascade = null ) {
		$this->cascade = $cascade ?? new DocumentCascade(
			self::ACTIVE_STATUSES,
			Documents::STATUS_ARCHIVED,
			self::PARENT_MARKER_META,
			self::COLLECTION_MARKER_META
		);
	}

	public function register(): void {
		add_action( 'init', array( $this, 'register_status' ) );
		add_action( 'init', array( $this, 'register_meta' ) );
		add_action( 'transition_post_status', array( $this, 'on_transition' ), 10, 3 );
		add_filter( 'rest_pre_insert_' . Document::POST_TYPE, array( $this, 'validate_rest_archive_transition' ), 5, 2 );
		add_filter( 'rest_dispatch_request', array( $this, 'block_archived_autosave' ), 10, 4 );
		add_filter( 'map_meta_cap', array( $this, 'preserve_original_status_capabilities' ), 10, 4 );
		add_filter( 'wp_untrash_post_status', array( $this, 'allow_archived_untrash_status' ), PHP_INT_MAX, 3 );
		add_filter( 'wp_insert_post_parent', array( $this, 'capture_trash_archive_slug_state' ), 5, 4 );
		add_filter( 'wp_insert_post_data', array( $this, 'prevent_trash_archive_transition' ), 5, 4 );
	}

	public function register_status(): void {
		register_post_status(
			Documents::STATUS_ARCHIVED,
			array(
				'label'                     => __( 'Archived', 'cortext' ),
				// translators: %s: Number of archived documents.
				'label_count'               => _n_noop(
					'Archived <span class="count">(%s)</span>',
					'Archived <span class="count">(%s)</span>',
					'cortext'
				),
				'internal'                  => false,
				'public'                    => false,
				'protected'                 => true,
				'exclude_from_search'       => false,
				'show_in_admin_all_list'    => false,
				'show_in_admin_status_list' => true,
			)
		);
	}

	public function register_meta(): void {
		register_post_meta(
			Document::POST_TYPE,
			self::STATUS_META,
			array(
				'type'          => 'string',
				'single'        => true,
				'show_in_rest'  => false,
				'auth_callback' => static function () {
					return false;
				},
			)
		);

		register_post_meta(
			Document::POST_TYPE,
			self::TIME_META,
			array(
				'type'          => 'integer',
				'single'        => true,
				'show_in_rest'  => false,
				'auth_callback' => static function () {
					return false;
				},
			)
		);

		register_post_meta(
			Document::POST_TYPE,
			self::PARENT_MARKER_META,
			array(
				'type'          => 'integer',
				'single'        => true,
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

	/**
	 * Runs archive or restore cascades when a document status changes.
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Previous post status.
	 * @param WP_Post $post       Post whose status changed.
	 */
	public function on_transition( string $new_status, string $old_status, WP_Post $post ): void {
		if ( Document::POST_TYPE !== $post->post_type ) {
			return;
		}

		if (
			Documents::STATUS_ARCHIVED === $new_status
			&& ! in_array( $old_status, array( Documents::STATUS_ARCHIVED, Documents::STATUS_TRASH ), true )
		) {
			update_post_meta( (int) $post->ID, self::STATUS_META, $old_status );
			update_post_meta( (int) $post->ID, self::TIME_META, time() );

			$this->cascade->cascade(
				(int) $post->ID,
				static function ( int $child_id ): void {
					wp_update_post(
						array(
							'ID'          => $child_id,
							'post_status' => Documents::STATUS_ARCHIVED,
						),
						true
					);
				}
			);
			return;
		}

		if (
			Documents::STATUS_ARCHIVED === $old_status
			&& ! in_array( $new_status, array( Documents::STATUS_ARCHIVED, Documents::STATUS_TRASH ), true )
		) {
			delete_post_meta( (int) $post->ID, self::STATUS_META );
			delete_post_meta( (int) $post->ID, self::TIME_META );

			$this->cascade->restore(
				(int) $post->ID,
				function ( int $child_id ): void {
					wp_update_post(
						array(
							'ID'          => $child_id,
							'post_status' => $this->restore_status_for( $child_id ),
						),
						true
					);
				}
			);
		}
	}

	/**
	 * Checks core REST writes against the archive rules.
	 *
	 * @param mixed           $prepared_post Post data prepared by core REST.
	 * @param WP_REST_Request $request       Incoming core REST request.
	 * @return mixed|WP_Error
	 */
	public function validate_rest_archive_transition( $prepared_post, WP_REST_Request $request ) {
		if ( is_wp_error( $prepared_post ) ) {
			return $prepared_post;
		}

		$post_id = (int) $request->get_param( 'id' );
		if ( $post_id < 1 ) {
			return $prepared_post;
		}

		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return $prepared_post;
		}

		if ( Documents::STATUS_ARCHIVED === $post->post_status ) {
			return $this->archived_write_error();
		}

		if ( Documents::STATUS_ARCHIVED !== $request->get_param( 'status' ) ) {
			return $prepared_post;
		}

		$transition_error = $this->archive_transition_error( $post );
		if ( $transition_error instanceof WP_Error ) {
			return $transition_error;
		}

		if ( ! $this->current_user_can_archive( $post_id ) ) {
			return new WP_Error(
				'cortext_document_archive_forbidden',
				__( 'You are not allowed to archive this document.', 'cortext' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		return $prepared_post;
	}

	/**
	 * Stops core's autosave controller before it can create a revision for an
	 * archived document.
	 *
	 * The autosave controller ignores errors returned by its parent post
	 * controller's prepare method, so the regular pre-insert guard is not enough
	 * for this route.
	 *
	 * @param mixed           $dispatch_result Result supplied by an earlier filter.
	 * @param WP_REST_Request $request         Incoming REST request.
	 * @param string          $route           Matched route pattern.
	 * @param array           $handler         Matched route handler.
	 * @return mixed|WP_Error
	 */
	public function block_archived_autosave( $dispatch_result, WP_REST_Request $request, string $route, array $handler ) {
		unset( $route );

		$callback = $handler['callback'] ?? null;
		if (
			null !== $dispatch_result
			|| 'POST' !== $request->get_method()
			|| ! is_array( $callback )
			|| ! isset( $callback[0], $callback[1] )
			|| ! $callback[0] instanceof \WP_REST_Autosaves_Controller
			|| 'create_item' !== $callback[1]
		) {
			return $dispatch_result;
		}

		$post = get_post( (int) $request->get_param( 'id' ) );
		if (
			$post instanceof WP_Post
			&& Document::POST_TYPE === $post->post_type
			&& Documents::STATUS_ARCHIVED === $post->post_status
		) {
			return $this->archived_write_error();
		}

		return $dispatch_result;
	}

	/**
	 * Keeps edit and delete checks tied to the status held before Archive.
	 *
	 * WordPress treats custom statuses like drafts when it maps these
	 * capabilities. Use the saved status for the checks core would otherwise
	 * drop, including while the archived document is in Trash.
	 *
	 * @param string[] $caps    Primitive capabilities from WordPress.
	 * @param string   $cap     Requested meta capability.
	 * @param int      $user_id User ID being checked.
	 * @param mixed[]  $args    Arguments passed to the capability check.
	 * @return string[]
	 */
	public function preserve_original_status_capabilities( array $caps, string $cap, int $user_id, array $args ): array {
		if ( ! in_array( $cap, array( 'edit_post', 'delete_post' ), true ) || empty( $args[0] ) ) {
			return $caps;
		}

		$post = get_post( (int) $args[0] );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return $caps;
		}

		$is_archived = Documents::STATUS_ARCHIVED === $post->post_status;
		$is_in_trash = Documents::STATUS_TRASH === $post->post_status
			&& Documents::STATUS_ARCHIVED === (string) get_post_meta( (int) $post->ID, '_wp_trash_meta_status', true );
		if ( ! $is_archived && ! $is_in_trash ) {
			return $caps;
		}

		$post_type = get_post_type_object( Document::POST_TYPE );
		if ( null === $post_type ) {
			return $caps;
		}

		$original_status = $this->restore_status_for( (int) $post->ID );
		$prefix          = 'edit_post' === $cap ? 'edit' : 'delete';
		if ( in_array( $original_status, array( 'publish', 'future' ), true ) ) {
			$caps[] = $post_type->cap->{"{$prefix}_published_posts"};
		} elseif ( 'private' === $original_status && $user_id !== (int) $post->post_author ) {
			$caps[] = $post_type->cap->{"{$prefix}_private_posts"};
		}

		return array_values( array_unique( $caps ) );
	}

	/**
	 * Tracks Trash restores for documents that were archived before trashing.
	 *
	 * @param string $new_status      Status WordPress will assign on restore.
	 * @param int    $post_id         ID of the document being restored.
	 * @param string $previous_status Status held before the document was trashed.
	 */
	public function allow_archived_untrash_status( string $new_status, int $post_id, string $previous_status ): string {
		if (
			Documents::STATUS_ARCHIVED === $new_status
			&& Documents::STATUS_ARCHIVED === $previous_status
			&& Document::POST_TYPE === get_post_type( $post_id )
		) {
			$this->archived_untrash_ids[ $post_id ] = true;
		}

		return $new_status;
	}

	/**
	 * Saves the original slug data before WordPress prepares an untrash.
	 *
	 * Core restores and deletes `_wp_desired_post_slug` before
	 * `wp_insert_post_data` runs. The later filter uses these values to block a
	 * direct Trash-to-Archive write without changing the trashed document.
	 *
	 * @param int                 $post_parent Parent ID selected for the write.
	 * @param int                 $post_id     ID of the document being updated.
	 * @param array<string,mixed> $new_postarr Processed post data.
	 * @param array<string,mixed> $postarr     Sanitized post data.
	 */
	public function capture_trash_archive_slug_state( int $post_parent, int $post_id, array $new_postarr, array $postarr ): int {
		unset( $postarr );

		if (
			Document::POST_TYPE === ( $new_postarr['post_type'] ?? '' )
			&& Documents::STATUS_ARCHIVED === ( $new_postarr['post_status'] ?? '' )
			&& Documents::STATUS_TRASH === get_post_status( $post_id )
		) {
			$this->trash_archive_slug_state[ $post_id ] = array(
				'post_name'             => (string) get_post_field( 'post_name', $post_id, 'raw' ),
				'desired_post_slug'     => (string) get_post_meta( $post_id, self::DESIRED_POST_SLUG_META, true ),
				'had_desired_post_slug' => metadata_exists( 'post', $post_id, self::DESIRED_POST_SLUG_META ),
			);
		}

		return $post_parent;
	}

	/**
	 * Keeps a trashed document in Trash when a direct update tries to archive it.
	 *
	 * `wp_insert_post_data` also handles calls from WP-CLI and plugins, but the
	 * filter cannot return a custom error. It changes the invalid status back to
	 * Trash. The only allowed transition is `wp_untrash_post()` restoring a
	 * document whose saved pre-trash status was Archived.
	 *
	 * @param array<string,mixed> $data                Processed post data.
	 * @param array<string,mixed> $postarr             Sanitized post data.
	 * @param array<string,mixed> $unsanitized_postarr Original post data.
	 * @param bool                $update              Whether this is an update.
	 * @return array<string,mixed>
	 */
	public function prevent_trash_archive_transition( array $data, array $postarr, array $unsanitized_postarr, bool $update ): array {
		unset( $unsanitized_postarr );

		if ( ! $update || Document::POST_TYPE !== ( $data['post_type'] ?? '' ) ) {
			return $data;
		}

		$post_id    = (int) ( $postarr['ID'] ?? 0 );
		$slug_state = $this->trash_archive_slug_state[ $post_id ] ?? null;
		unset( $this->trash_archive_slug_state[ $post_id ] );
		$is_valid_restore = isset( $this->archived_untrash_ids[ $post_id ] )
			&& '' === (string) get_post_meta( $post_id, '_wp_trash_meta_status', true );
		unset( $this->archived_untrash_ids[ $post_id ] );

		if (
			! $is_valid_restore
			&& Documents::STATUS_ARCHIVED === ( $data['post_status'] ?? '' )
			&& Documents::STATUS_TRASH === get_post_status( $post_id )
		) {
			$data['post_status'] = Documents::STATUS_TRASH;
			if ( is_array( $slug_state ) ) {
				$data['post_name'] = wp_slash( $slug_state['post_name'] );
				if ( $slug_state['had_desired_post_slug'] ) {
					update_post_meta(
						$post_id,
						self::DESIRED_POST_SLUG_META,
						$slug_state['desired_post_slug']
					);
				}
			}
		}

		return $data;
	}

	/**
	 * Archives a document and every descendant in its cascade.
	 *
	 * @param int $post_id Root document ID.
	 * @return int[]|WP_Error Archived IDs, including the root.
	 */
	public function archive( int $post_id ): array|WP_Error {
		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$transition_error = $this->archive_transition_error( $post );
		if ( $transition_error instanceof WP_Error ) {
			return $transition_error;
		}

		$result = wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => Documents::STATUS_ARCHIVED,
			),
			true
		);
		if ( $result instanceof WP_Error || 0 === $result ) {
			return new WP_Error(
				'cortext_document_archive_failed',
				__( 'Document could not be archived.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		return array_values(
			array_unique(
				array_merge( array( $post_id ), $this->descendants_for_root( $post_id ) )
			)
		);
	}

	/**
	 * Restores an archived document and every descendant in its cascade.
	 *
	 * @param int $post_id Root document ID.
	 * @return int[]|WP_Error Restored IDs, including the root.
	 */
	public function unarchive( int $post_id ): array|WP_Error {
		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return new WP_Error(
				'cortext_document_not_found',
				__( 'Document not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( Documents::STATUS_ARCHIVED !== $post->post_status ) {
			return new WP_Error(
				'cortext_document_not_archived',
				__( 'Document is not archived.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$candidates = $this->descendants_for_root( $post_id );
		$result     = wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => $this->restore_status_for( $post_id ),
			),
			true
		);

		if ( $result instanceof WP_Error || 0 === $result ) {
			return new WP_Error(
				'cortext_document_unarchive_failed',
				__( 'Document could not be restored.', 'cortext' ),
				array( 'status' => 500 )
			);
		}

		$restored = array( $post_id );
		foreach ( $candidates as $candidate_id ) {
			$candidate = get_post( $candidate_id );
			if ( $candidate instanceof WP_Post && Documents::STATUS_ARCHIVED !== $candidate->post_status ) {
				$restored[] = $candidate_id;
			}
		}

		return array_values( array_unique( $restored ) );
	}

	/**
	 * Returns archived descendants marked by this document's cascade.
	 *
	 * @param int $root_id Root document ID.
	 * @return int[] Archived descendant IDs, excluding the root.
	 */
	public function descendants_for_root( int $root_id ): array {
		return $this->cascade->descendants_for_root( $root_id );
	}

	/**
	 * Checks edit permission for every document an Archive request would move.
	 *
	 * @param int $root_id Root document ID.
	 */
	public function current_user_can_archive( int $root_id ): bool {
		$ids = array_merge( array( $root_id ), $this->cascade->candidates_for_cascade( $root_id ) );
		foreach ( array_unique( $ids ) as $post_id ) {
			if ( ! current_user_can( 'edit_post', $post_id ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Checks edit and publication permission for every document restored by an
	 * Unarchive request.
	 *
	 * @param int $root_id Root document ID.
	 */
	public function current_user_can_unarchive( int $root_id ): bool {
		$post_type = get_post_type_object( Document::POST_TYPE );
		if ( null === $post_type ) {
			return false;
		}

		$ids = array_merge( array( $root_id ), $this->descendants_for_root( $root_id ) );
		foreach ( array_unique( $ids ) as $post_id ) {
			if ( ! current_user_can( 'edit_post', $post_id ) ) {
				return false;
			}

			if (
				in_array( $this->restore_status_for( $post_id ), array( 'private', 'publish', 'future' ), true )
				&& ! current_user_can( $post_type->cap->publish_posts )
			) {
				return false;
			}
		}

		return true;
	}

	private function restore_status_for( int $post_id ): string {
		$status = (string) get_post_meta( $post_id, self::STATUS_META, true );
		return in_array( $status, self::ACTIVE_STATUSES, true ) ? $status : 'draft';
	}

	private function archived_write_error(): WP_Error {
		return new WP_Error(
			'cortext_document_archived',
			__( 'Restore this document before editing it.', 'cortext' ),
			array( 'status' => 409 )
		);
	}

	private function archive_transition_error( WP_Post $post ): ?WP_Error {
		if ( Documents::STATUS_ARCHIVED === $post->post_status ) {
			return new WP_Error(
				'cortext_document_already_archived',
				__( 'Document is already archived.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		if ( Documents::STATUS_TRASH === $post->post_status ) {
			return new WP_Error(
				'cortext_document_in_trash',
				__( 'Restore the document from Trash before archiving it.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		return null;
	}
}
