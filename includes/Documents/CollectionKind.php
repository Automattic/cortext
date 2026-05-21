<?php
/**
 * Collection document kind. Full-page collections sit in the sidebar as their
 * own workspace entry; inline collections are owned by a page and have no
 * workspace route of their own, so their document path resolves to the owner
 * page.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Documents;

use Cortext\PostType\Collection;
use Cortext\PostType\Page;
use WP_Post;

final class CollectionKind implements DocumentKind {

	public function id(): string {
		return 'collection';
	}

	public function owns_post_type( string $post_type ): bool {
		return Collection::POST_TYPE === $post_type;
	}

	public function path_for( WP_Post $post ): string {
		$slug = get_post_meta( (int) $post->ID, 'slug', true );
		$slug = is_string( $slug ) ? trim( $slug ) : '';
		$tail = '' === $slug ? (string) $post->ID : "{$slug}-{$post->ID}";
		return "collection/{$tail}";
	}

	public function has_icon(): bool {
		return true;
	}

	public function owner_context( WP_Post $post ): ?KindOwnerContext {
		if ( ! Collection::is_inline( (int) $post->ID ) ) {
			return null;
		}

		$owner_id   = (int) get_post_meta( $post->ID, Collection::INLINE_OWNER_META_KEY, true );
		$owner_post = $owner_id > 0 ? get_post( $owner_id ) : null;
		if ( ! $owner_post instanceof WP_Post || Page::POST_TYPE !== $owner_post->post_type ) {
			return null;
		}

		// Inline collections route through the owner page in search/trash, so
		// the owner's path replaces the document's own path.
		return new KindOwnerContext( 'owner', $owner_post, true );
	}
}
