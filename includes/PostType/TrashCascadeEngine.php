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
		foreach ( $this->strategies as $strategy ) {
			$strategy->register_filters();
		}
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
