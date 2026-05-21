<?php
/**
 * Lookup for registered document kinds. Callers ask "what kind is this post
 * type?" or "give me the page kind" instead of branching on post-type slugs.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Documents;

final class KindRegistry {

	/**
	 * Kinds indexed by id.
	 *
	 * @var DocumentKind[]
	 */
	private array $kinds = array();

	public function register( DocumentKind $kind ): void {
		$this->kinds[ $kind->id() ] = $kind;
	}

	public function by_id( string $id ): ?DocumentKind {
		return $this->kinds[ $id ] ?? null;
	}

	/**
	 * Returns the kind that claims this post type, or null when no kind does.
	 * Dynamic row CPTs are matched by prefix; pages and collections by exact
	 * slug.
	 *
	 * @param string $post_type Post type slug to resolve.
	 */
	public function by_post_type( string $post_type ): ?DocumentKind {
		foreach ( $this->kinds as $kind ) {
			if ( $kind->owns_post_type( $post_type ) ) {
				return $kind;
			}
		}
		return null;
	}

	/**
	 * Every registered kind, in registration order.
	 *
	 * @return DocumentKind[]
	 */
	public function all(): array {
		return array_values( $this->kinds );
	}
}
