<?php
/**
 * Registers a post type as a Cortext document. Wraps the plain WordPress
 * registration so the document trait, default settings, and identity meta
 * stay consistent across the two cortext post types (`crtxt_document` for
 * pages and rows, `crtxt_trait` for collection schemas).
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

final class DocumentTypeRegistrar {

	/**
	 * Registers a Cortext document post type. Forwards `$args` to
	 * `register_post_type`, then adds the `cortext-document` trait and
	 * identity icon meta through `DocumentIdentity`.
	 *
	 * Call once per document post type during the `init` action.
	 *
	 * @param string              $post_type Post type slug.
	 * @param array<string,mixed> $args      Arguments for `register_post_type`.
	 */
	public static function register( string $post_type, array $args ): void {
		register_post_type( $post_type, $args );
		DocumentIdentity::register_for_post_type( $post_type );
	}
}
