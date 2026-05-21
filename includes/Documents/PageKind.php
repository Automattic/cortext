<?php
/**
 * Page document kind. Pages own block-editor content, sit in a hierarchical
 * tree under `post_parent`, and have an identity icon.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Documents;

use Cortext\PostType\Page;
use WP_Post;

final class PageKind implements DocumentKind {

	public function id(): string {
		return 'page';
	}

	public function owns_post_type( string $post_type ): bool {
		return Page::POST_TYPE === $post_type;
	}

	public function path_for( WP_Post $post ): string {
		$slug = trim( $post->post_name );
		$tail = '' === $slug ? (string) $post->ID : "{$slug}-{$post->ID}";
		return "page/{$tail}";
	}

	public function has_icon(): bool {
		return true;
	}

	public function owner_context( WP_Post $post ): ?KindOwnerContext {
		return null;
	}
}
