<?php
/**
 * Shared WP_Query shim for tests running on WorDBless.
 *
 * WorDBless's `wpdb` mock returns empty rows for any query that is not a
 * single-row primary-key lookup, so calls like `WP_Query` with `meta_key`,
 * `post_parent`, post-type filters, or `s` search all come back empty even
 * though the in-memory post store has matches. This trait installs a
 * `posts_pre_query` filter that answers from the in-memory store and keeps
 * pagination totals available.
 *
 * Tracked in docs/tech-debt.md#9. Use by `use InMemoryPostsQuery;` in a test
 * class and call `install_in_memory_posts_query()` from `set_up()` and
 * `uninstall_in_memory_posts_query()` from `tear_down()`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use WorDBless\Posts as WorDBlessPosts;
use WP_Post;
use WP_Query;

trait InMemoryPostsQuery {

	protected function install_in_memory_posts_query(): void {
		add_filter( 'posts_pre_query', array( $this, 'serve_posts_from_memory' ), 10, 2 );
	}

	protected function uninstall_in_memory_posts_query(): void {
		remove_filter( 'posts_pre_query', array( $this, 'serve_posts_from_memory' ), 10 );
	}

	/**
	 * Short-circuits `WP_Query` for queries WorDBless cannot serve from its
	 * `wpdb` mock. Handles the filter shapes used across the Cortext test
	 * suite: post_type, post_status (including `trash`), post_parent,
	 * meta_key+meta_value, `s` search, and pagination.
	 *
	 * @param mixed    $pre   Existing filter return; passed through when null.
	 * @param WP_Query $query The query being short-circuited.
	 *
	 * @return mixed
	 */
	public function serve_posts_from_memory( $pre, WP_Query $query ) {
		$vars = $query->query_vars;

		$wants_parent_filter   = ! empty( $vars['post_parent'] );
		$wants_meta_filter     = ! empty( $vars['meta_key'] );
		$wants_post_type_query = ! empty( $vars['post_type'] ) && 'any' !== $vars['post_type'];
		$wants_search          = isset( $vars['s'] ) && '' !== (string) $vars['s'];
		$statuses              = (array) ( $vars['post_status'] ?? array() );
		$wants_trash_query     = in_array( 'trash', $statuses, true );

		if (
			! $wants_parent_filter &&
			! $wants_meta_filter &&
			! $wants_post_type_query &&
			! $wants_search &&
			! $wants_trash_query
		) {
			return $pre;
		}

		$candidates = $this->all_in_memory_posts();

		if ( $wants_post_type_query ) {
			$types      = (array) $vars['post_type'];
			$candidates = array_filter(
				$candidates,
				static fn( WP_Post $post ): bool => in_array( $post->post_type, $types, true )
			);
		}

		if ( $wants_parent_filter ) {
			$parent     = (int) $vars['post_parent'];
			$candidates = array_filter(
				$candidates,
				static fn( WP_Post $post ): bool => (int) $post->post_parent === $parent
			);
		}

		if ( ! empty( $statuses ) ) {
			$candidates = array_filter(
				$candidates,
				static fn( WP_Post $post ): bool => in_array( $post->post_status, $statuses, true )
			);
		}

		if ( $wants_meta_filter ) {
			$key        = (string) $vars['meta_key'];
			$value      = (string) ( $vars['meta_value'] ?? '' );
			$candidates = array_filter(
				$candidates,
				static fn( WP_Post $post ): bool => (string) get_post_meta( (int) $post->ID, $key, true ) === $value
			);
		}

		if ( $wants_search ) {
			$needle     = strtolower( (string) $vars['s'] );
			$candidates = array_filter(
				$candidates,
				static function ( WP_Post $post ) use ( $needle ): bool {
					$haystack = strtolower( $post->post_title . ' ' . $post->post_excerpt . ' ' . $post->post_content );
					return false !== strpos( $haystack, $needle );
				}
			);
		}

		$orderby = (string) ( $vars['orderby'] ?? '' );
		if ( in_array( $orderby, array( 'modified', 'date' ), true ) ) {
			$direction  = strtoupper( (string) ( $vars['order'] ?? 'DESC' ) );
			$field      = 'modified' === $orderby ? 'post_modified_gmt' : 'post_date_gmt';
			$candidates = array_values( $candidates );
			usort(
				$candidates,
				static function ( WP_Post $a, WP_Post $b ) use ( $field, $direction ): int {
					$cmp = strcmp( (string) $b->{$field}, (string) $a->{$field} );
					return 'ASC' === $direction ? -$cmp : $cmp;
				}
			);
		}

		$candidates = array_values( $candidates );

		// posts_pre_query short-circuits the SQL path, so WP_Query never calls
		// set_found_posts(). Set the count here so callers still get pagination
		// totals from `$query->found_posts`.
		$query->found_posts = count( $candidates );

		$per_page = (int) ( $vars['posts_per_page'] ?? 0 );
		$page     = max( 1, (int) ( $vars['paged'] ?? 1 ) );
		if ( $per_page > 0 ) {
			$candidates = array_slice( $candidates, ( $page - 1 ) * $per_page, $per_page );
		}

		if ( 'ids' === ( $vars['fields'] ?? '' ) ) {
			return array_map( static fn( WP_Post $post ): int => (int) $post->ID, $candidates );
		}

		return $candidates;
	}

	/**
	 * Returns every in-memory post as a `WP_Post`.
	 *
	 * @return WP_Post[]
	 */
	private function all_in_memory_posts(): array {
		$store = WorDBlessPosts::init()->posts;
		$out   = array();
		foreach ( $store as $row ) {
			$out[] = new WP_Post( $row );
		}
		return $out;
	}
}
