<?php
/**
 * Shared body for cascade strategies. Subclasses supply the child lookups,
 * marker meta key, and owner check for their document kind.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType\Cascade;

abstract class BaseCascadeStrategy implements CascadeStrategy {

	abstract public function marker_meta_key(): string;

	abstract public function applies_to( int $post_id ): bool;

	/**
	 * Child posts owned by `$owner_id` that are not in trash.
	 *
	 * @param int $owner_id Owner post id.
	 * @return int[]
	 */
	abstract protected function active_child_ids( int $owner_id ): array;

	/**
	 * Trashed children this owner marked during its cascade. Unmarked
	 * children, and children marked by another owner, stay put.
	 *
	 * @param int $owner_id Owner post id whose marker tags the children.
	 * @return int[]
	 */
	abstract protected function trashed_child_ids_tagged_with( int $owner_id ): array;

	/**
	 * All children for `$owner_id`, including trashed ones. Used when
	 * permanent delete should remove the owner's child records too.
	 *
	 * @param int $owner_id Owner post id.
	 * @return int[]
	 */
	abstract protected function all_child_ids( int $owner_id ): array;

	public function cascade_trash( int $post_id ): void {
		$marker = $this->marker_meta_key();
		foreach ( $this->active_child_ids( $post_id ) as $child_id ) {
			update_post_meta( $child_id, $marker, $post_id );
			wp_trash_post( $child_id );
		}
	}

	public function cascade_restore( int $post_id ): void {
		$this->before_restore( $post_id );
		$marker = $this->marker_meta_key();
		foreach ( $this->trashed_child_ids_tagged_with( $post_id ) as $child_id ) {
			wp_untrash_post( $child_id );
			delete_post_meta( $child_id, $marker );
		}
	}

	public function cascade_delete( int $post_id ): void {
		if ( ! $this->cascade_delete_enabled() ) {
			return;
		}
		foreach ( $this->all_child_ids( $post_id ) as $child_id ) {
			wp_delete_post( $child_id, true );
		}
	}

	public function descendants_for_root( int $root_id ): array {
		return array();
	}

	public function register_meta(): void {}

	public function register_filters(): void {}

	/**
	 * Hook that runs before marked children are restored. The page hierarchy
	 * clears the restored page's own marker here so a later ancestor restore
	 * will not restore it again.
	 *
	 * @param int $post_id Post id being restored.
	 */
	protected function before_restore( int $post_id ): void {}

	/**
	 * Whether this strategy deletes child posts inside `cascade_delete`.
	 * Pages return false because `DocumentsController` deletes their subtree
	 * leaves-first; flat owner/child strategies return true.
	 */
	protected function cascade_delete_enabled(): bool {
		return true;
	}
}
