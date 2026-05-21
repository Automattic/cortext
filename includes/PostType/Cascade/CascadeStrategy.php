<?php
/**
 * Contract for a document kind's trash cascade. Strategies decide whether a
 * post owns children, which posts follow it to trash, and which posts come
 * back on restore.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType\Cascade;

interface CascadeStrategy {

	/**
	 * Whether this strategy handles events for the given post. A strategy
	 * returns false when the post cannot own the child records it manages.
	 *
	 * @param int $post_id ID of the post about to receive a trash, restore, or delete event.
	 */
	public function applies_to( int $post_id ): bool;

	/**
	 * Tags active children with the owner's id and moves them to trash.
	 * `wp_trash_post` fires this hook again for each child, so page
	 * hierarchies continue down the tree without a separate walk.
	 *
	 * @param int $post_id Owner post id that was just moved to trash.
	 */
	public function cascade_trash( int $post_id ): void;

	/**
	 * Restores only the children this owner moved to trash, then clears their
	 * marker meta.
	 *
	 * @param int $post_id Owner post id that was just restored.
	 */
	public function cascade_restore( int $post_id ): void;

	/**
	 * Permanently deletes every child the owner carries, including ones
	 * already in trash. Strategies can leave this as a no-op when another
	 * code path handles delete order, as pages do through
	 * `DocumentsController`.
	 *
	 * @param int $post_id Owner post id about to be permanently deleted.
	 */
	public function cascade_delete( int $post_id ): void;

	/**
	 * Walks the trashed subtree below this post for hierarchical kinds. REST
	 * restore and permanent-delete use this snapshot before mutations run.
	 * Flat owner/child strategies return `[]`.
	 *
	 * @param int $root_id Root post id to walk from.
	 * @return int[]
	 */
	public function descendants_for_root( int $root_id ): array;

	/**
	 * Registers marker meta at `init`. A no-op for markers on dynamic post
	 * types that do not need explicit registration.
	 */
	public function register_meta(): void;

	/**
	 * Registers filters that belong to one strategy, such as page admin bulk
	 * actions or previous-status restore. A no-op when the cross-cutting
	 * trash hooks are enough.
	 */
	public function register_filters(): void;
}
