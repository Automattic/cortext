<?php
/**
 * A Cortext document kind: page, collection, or row. Each implementation
 * answers a few questions about its kind: which post type, what URL path,
 * whether it has an identity icon, and what (if anything) owns it.
 *
 * Adding a new kind means writing an implementation and registering it with
 * `KindRegistry`. Documents and the REST surface read from the registry
 * instead of branching on post-type slugs.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Documents;

use WP_Post;

interface DocumentKind {

	/**
	 * Stable identifier used across PHP and REST responses. Matches the
	 * `Documents::KIND_*` string constants the React shell already speaks.
	 */
	public function id(): string;

	/**
	 * Whether this kind claims the given post type. Row CPTs are dynamic
	 * (`crtxt_<slug>`), so the row kind matches by prefix while page/collection
	 * match exact slugs.
	 *
	 * @param string $post_type Post type slug to test.
	 */
	public function owns_post_type( string $post_type ): bool;

	/**
	 * Workspace path for the document, used by command palette, breadcrumbs,
	 * and trash rows. Returned without a leading slash, e.g. `page/about-12`.
	 *
	 * @param WP_Post $post Document post to route.
	 */
	public function path_for( WP_Post $post ): string;

	/**
	 * Whether documents of this kind carry a `cortext_document_icon`. Pages
	 * and collections do; rows render their icon from collection schema.
	 */
	public function has_icon(): bool;

	/**
	 * The post that owns this document, or null when the document stands
	 * alone. Rows always have a parent collection; inline collections have
	 * an owner page; pages have no owner.
	 *
	 * @param WP_Post $post Document whose owner is needed.
	 */
	public function owner_context( WP_Post $post ): ?KindOwnerContext;
}
