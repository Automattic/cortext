<?php
/**
 * Dispatches trash-cascade hooks. The engine hooks WordPress once for trash,
 * restore, and permanent delete, then lets each registered strategy handle
 * the post types it owns.
 *
 * `DocumentsController` also asks the engine for descendants before restore
 * or permanent delete. The WordPress hooks run synchronously inside
 * `wp_untrash_post` / `wp_delete_post`, so a query after the call cannot tell
 * which descendants changed.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

use Cortext\PostType\Cascade\CascadeStrategy;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class TrashCascadeEngine {

	/**
	 * Strategies that receive trash, restore, and delete events.
	 *
	 * @var CascadeStrategy[]
	 */
	private array $strategies;

	/**
	 * Constructor.
	 *
	 * @param CascadeStrategy[] $strategies Strategies to register.
	 */
	public function __construct( array $strategies ) {
		$this->strategies = $strategies;
	}

	public function register(): void {
		// Attach filters immediately so tests and admin flows see them right
		// after register(). Marker meta still waits for init, matching
		// register_post_meta.
		add_action( 'init', array( $this, 'register_meta' ) );
		add_action( 'wp_trash_post', array( $this, 'on_trash' ), 10, 1 );
		add_action( 'untrashed_post', array( $this, 'on_restore' ), 10, 1 );
		add_action( 'before_delete_post', array( $this, 'on_delete' ), 10, 1 );
		add_action( 'rest_api_init', array( $this, 'register_rest_filters' ) );
		foreach ( $this->strategies as $strategy ) {
			$strategy->register_filters();
		}
	}

	public function register_rest_filters(): void {
		// Pages cascade into descendants and inline collections; the response
		// to a REST trash should carry those ids so the client can drop them
		// from favorites without re-computing the cascade locally.
		add_filter(
			'rest_prepare_' . Page::POST_TYPE,
			array( $this, 'extend_trash_response' ),
			10,
			3
		);
	}

	/**
	 * Adds the cascade list to a REST trash response. The client uses it to
	 * filter favorites without re-walking the page tree locally.
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

		$data['cascade_deleted'] = $this->cascade_deleted_for_root( (int) $post->ID );
		$response->set_data( $data );
		return $response;
	}

	/**
	 * Groups cascade-deleted ids by document kind. Walks across strategies so
	 * a page subtree picks up inline collections nested in subpages and rows
	 * nested in those collections, not just the descendants the root strategy
	 * sees directly.
	 *
	 * @param int $root_id Root post id that was trashed.
	 * @return array{pages: int[], collections: int[], rows: int[]}
	 */
	private function cascade_deleted_for_root( int $root_id ): array {
		$grouped = array(
			'pages'       => array(),
			'collections' => array(),
			'rows'        => array(),
		);

		$seen     = array( $root_id => true );
		$frontier = array( $root_id );
		while ( ! empty( $frontier ) ) {
			$next = array();
			foreach ( $frontier as $current ) {
				foreach ( $this->strategies as $strategy ) {
					if ( ! $strategy->applies_to( $current ) ) {
						continue;
					}
					foreach ( $strategy->descendants_for_root( $current ) as $descendant_id ) {
						$descendant_id = (int) $descendant_id;
						if ( isset( $seen[ $descendant_id ] ) ) {
							continue;
						}
						$seen[ $descendant_id ] = true;
						$next[]                 = $descendant_id;

						$type = get_post_type( $descendant_id );
						if ( Page::POST_TYPE === $type ) {
							$grouped['pages'][] = $descendant_id;
						} elseif ( Collection::POST_TYPE === $type ) {
							$grouped['collections'][] = $descendant_id;
						} elseif ( is_string( $type ) && str_starts_with( $type, CollectionEntries::CPT_PREFIX ) ) {
							$grouped['rows'][] = $descendant_id;
						}
					}
				}
			}
			$frontier = $next;
		}

		return $grouped;
	}

	public function register_meta(): void {
		foreach ( $this->strategies as $strategy ) {
			$strategy->register_meta();
		}
	}

	public function on_trash( int $post_id ): void {
		foreach ( $this->strategies as $strategy ) {
			if ( $strategy->applies_to( $post_id ) ) {
				$strategy->cascade_trash( $post_id );
			}
		}
	}

	public function on_restore( int $post_id ): void {
		foreach ( $this->strategies as $strategy ) {
			if ( $strategy->applies_to( $post_id ) ) {
				$strategy->cascade_restore( $post_id );
			}
		}
	}

	public function on_delete( int $post_id ): void {
		foreach ( $this->strategies as $strategy ) {
			if ( $strategy->applies_to( $post_id ) ) {
				$strategy->cascade_delete( $post_id );
			}
		}
	}

	/**
	 * Combines descendant snapshots from every strategy. Hierarchical
	 * strategies can return a trashed subtree; flat owner/child strategies
	 * return `[]`.
	 *
	 * @param int $root_id Root post id to walk from.
	 * @return int[]
	 */
	public function descendants_for_root( int $root_id ): array {
		$collected = array();
		foreach ( $this->strategies as $strategy ) {
			$collected = array_merge( $collected, $strategy->descendants_for_root( $root_id ) );
		}
		return array_values( array_unique( $collected ) );
	}
}
