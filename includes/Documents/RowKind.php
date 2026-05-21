<?php
/**
 * Row document kind. Rows live in the dynamic `crtxt_<slug>` CPT registered
 * per collection. Each row has a parent collection that gives the row its
 * schema and workspace breadcrumb.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Documents;

use Cortext\Documents;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Page;
use WP_Post;

final class RowKind implements DocumentKind {

	private Documents $documents;

	public function __construct( Documents $documents ) {
		$this->documents = $documents;
	}

	public function id(): string {
		return 'row';
	}

	public function owns_post_type( string $post_type ): bool {
		// Page and Collection share the `cortext-document` trait but are not
		// rows. Row CPTs all start with the shared prefix.
		if ( Page::POST_TYPE === $post_type || Collection::POST_TYPE === $post_type ) {
			return false;
		}
		if ( ! str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) ) {
			return false;
		}
		return post_type_supports( $post_type, 'cortext-document' );
	}

	public function path_for( WP_Post $post ): string {
		$slug = trim( $post->post_name );
		return '' === $slug ? (string) $post->ID : "{$slug}-{$post->ID}";
	}

	public function has_icon(): bool {
		return false;
	}

	public function owner_context( WP_Post $post ): ?KindOwnerContext {
		$collection = $this->documents->find_collection_by_row_post_type( $post->post_type );
		if ( ! $collection instanceof WP_Post ) {
			return null;
		}
		return new KindOwnerContext( 'collection', $collection );
	}
}
