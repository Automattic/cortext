<?php
/**
 * The post that owns a document, plus the bits the formatter needs to render
 * it: a row's parent collection, or an inline collection's owner page. Also
 * names the response field that carries the pointer (`collection` vs `owner`)
 * and whether the owner's path should replace the document's own.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Documents;

use WP_Post;

final class KindOwnerContext {

	/**
	 * Constructor.
	 *
	 * @param string  $field                Response field name ('collection' for a row's parent, 'owner' for an inline collection's page).
	 * @param WP_Post $post                 The owning post.
	 * @param bool    $use_as_document_path Whether the owner's path should replace the document's own path
	 *                                      (true for inline collections, which lack a workspace route of their own).
	 */
	public function __construct(
		public readonly string $field,
		public readonly WP_Post $post,
		public readonly bool $use_as_document_path = false
	) {}
}
