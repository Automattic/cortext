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
 * Tracked in docs/tech-debt.md#td-wordbless-row-coverage. Use by `use InMemoryPostsQuery;` in a test
 * class and call `install_in_memory_posts_query()` from `set_up()` and
 * `uninstall_in_memory_posts_query()` from `tear_down()`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Fields\FieldTypeRegistry;
use Cortext\PostType\Document;
use WorDBless\Posts as WorDBlessPosts;
use WeakMap;
use WP_Post;
use WP_Query;

trait InMemoryPostsQuery {

	/**
	 * `found_posts` totals for queries handled by `posts_pre_query`.
	 *
	 * @var WeakMap<WP_Query,int>|null
	 */
	private static ?WeakMap $in_memory_found_posts = null;

	protected function install_in_memory_posts_query(): void {
		self::$in_memory_found_posts = new WeakMap();
		add_filter( 'posts_pre_query', array( $this, 'serve_posts_from_memory' ), 10, 2 );
		add_filter( 'found_posts', array( $this, 'serve_found_posts_from_memory' ), 10, 2 );
	}

	protected function uninstall_in_memory_posts_query(): void {
		remove_filter( 'posts_pre_query', array( $this, 'serve_posts_from_memory' ), 10 );
		remove_filter( 'found_posts', array( $this, 'serve_found_posts_from_memory' ), 10 );
		self::$in_memory_found_posts = null;
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
		if ( null !== self::$in_memory_found_posts && isset( self::$in_memory_found_posts[ $query ] ) ) {
			unset( self::$in_memory_found_posts[ $query ] );
		}

		$vars = $query->query_vars;

		$wants_parent_filter   = ! empty( $vars['post_parent'] );
		$wants_meta_filter     = ! empty( $vars['meta_key'] );
		$wants_meta_query      = ! empty( $vars['meta_query'] ) && is_array( $vars['meta_query'] );
		$wants_tax_query       = ! empty( $vars['tax_query'] ) && is_array( $vars['tax_query'] );
		$wants_post_type_query = ! empty( $vars['post_type'] ) && 'any' !== $vars['post_type'];
		$wants_search          = isset( $vars['s'] ) && '' !== (string) $vars['s'];
		$statuses              = (array) ( $vars['post_status'] ?? array() );
		$wants_trash_query     = in_array( 'trash', $statuses, true );

		if (
			! $wants_parent_filter &&
			! $wants_meta_filter &&
			! $wants_meta_query &&
			! $wants_tax_query &&
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

		if ( $wants_meta_query ) {
			$candidates = array_filter(
				$candidates,
				fn( WP_Post $post ): bool => $this->matches_meta_query( $post, (array) $vars['meta_query'] )
			);
		}

		if ( $wants_tax_query ) {
			$candidates = array_filter(
				$candidates,
				fn( WP_Post $post ): bool => $this->matches_tax_query( $post, (array) $vars['tax_query'] )
			);
		}

		if ( $wants_search ) {
			$terms      = preg_split( '/\s+/', strtolower( trim( (string) $vars['s'] ) ) );
			$terms      = is_array( $terms )
				? array_values(
					array_filter(
						$terms,
						static fn( string $term ): bool => '' !== $term
					)
				)
				: array();
			$candidates = array_filter(
				$candidates,
				function ( WP_Post $post ) use ( $terms ): bool {
					foreach ( $terms as $term ) {
						if ( ! $this->post_matches_search( $post, $term ) ) {
							return false;
						}
					}
					return true;
				}
			);
		}

		$orderby = $vars['orderby'] ?? '';
		// `WP_Query` accepts arrays like `[ 'menu_order' => 'ASC', 'ID' => 'ASC' ]`.
		// We don't try to mirror multi-key ordering here; only the simple
		// string forms get applied, anything else falls through to the
		// insertion order.
		$orderby = is_string( $orderby ) ? $orderby : '';
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
		} elseif ( $wants_search && '' === $orderby ) {
			// Mirror the `posts_search_orderby` filter `Documents::list()`
			// installs: title prefix wins over title contains, which wins
			// over excerpt and content matches. Modified-date DESC is the
			// tiebreaker.
			$needle     = strtolower( trim( (string) $vars['s'] ) );
			$candidates = array_values( $candidates );
			usort(
				$candidates,
				function ( WP_Post $a, WP_Post $b ) use ( $needle ): int {
					$tier_a = $this->search_relevance_tier( $a, $needle );
					$tier_b = $this->search_relevance_tier( $b, $needle );
					if ( $tier_a !== $tier_b ) {
						return $tier_a - $tier_b;
					}
					return strcmp(
						(string) $b->post_modified_gmt,
						(string) $a->post_modified_gmt
					);
				}
			);
		}

		$candidates = array_values( $candidates );

		// posts_pre_query short-circuits the SQL path, so WP_Query never calls
		// set_found_posts(). Set the count here so callers still get pagination
		// totals from `$query->found_posts`.
		$total = count( $candidates );
		if ( null === self::$in_memory_found_posts ) {
			self::$in_memory_found_posts = new WeakMap();
		}
		self::$in_memory_found_posts[ $query ] = $total;
		$query->found_posts                    = $total;

		$per_page = (int) ( $vars['posts_per_page'] ?? 0 );
		$page     = max( 1, (int) ( $vars['paged'] ?? 1 ) );
		$query->max_num_pages = $per_page > 0 ? (int) ceil( $total / $per_page ) : 0;
		if ( $per_page > 0 ) {
			$candidates = array_slice( $candidates, ( $page - 1 ) * $per_page, $per_page );
		}

		if ( 'ids' === ( $vars['fields'] ?? '' ) ) {
			return array_map( static fn( WP_Post $post ): int => (int) $post->ID, $candidates );
		}

		return $candidates;
	}

	/**
	 * Returns the stored total for a query handled by `posts_pre_query`.
	 *
	 * @param int      $found_posts Existing found-post count.
	 * @param WP_Query $query       Query being counted.
	 */
	public function serve_found_posts_from_memory( int $found_posts, WP_Query $query ): int {
		if ( null !== self::$in_memory_found_posts && isset( self::$in_memory_found_posts[ $query ] ) ) {
			return self::$in_memory_found_posts[ $query ];
		}
		return $found_posts;
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

	/**
	 * Returns the tier (1-best, 5-worst) for a post against a search
	 * needle. Matches the CASE expression `Documents::list()` registers via
	 * the `posts_search_orderby` filter.
	 */
	private function search_relevance_tier( WP_Post $post, string $needle ): int {
		if ( '' === $needle ) {
			return 5;
		}
		$title = strtolower( (string) $post->post_title );
		if ( '' !== $title && str_starts_with( $title, $needle ) ) {
			return 1;
		}
		if ( '' !== $title && false !== strpos( $title, $needle ) ) {
			return 2;
		}
		$excerpt = strtolower( (string) $post->post_excerpt );
		if ( '' !== $excerpt && false !== strpos( $excerpt, $needle ) ) {
			return 3;
		}
		$content = strtolower( (string) $post->post_content );
		if ( '' !== $content && false !== strpos( $content, $needle ) ) {
			return 4;
		}
		return 5;
	}

	/**
	 * Keep test search close to `Documents::list()`: pages use
	 * title/content/excerpt, and rows can also match text-like field meta
	 * (text, email, url).
	 *
	 * @param WP_Post $post   Post to inspect.
	 * @param string  $needle Lowercase search term.
	 */
	private function post_matches_search( WP_Post $post, string $needle ): bool {
		$haystack = strtolower( $post->post_title . ' ' . $post->post_excerpt . ' ' . $post->post_content );
		if ( false !== strpos( $haystack, $needle ) ) {
			return true;
		}

		if ( Document::POST_TYPE !== $post->post_type ) {
			return false;
		}

		foreach ( $this->text_like_field_keys_for_document() as $meta_key ) {
			$value = strtolower( (string) get_post_meta( (int) $post->ID, $meta_key, true ) );
			if ( false !== strpos( $value, $needle ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Evaluates a subset of `meta_query` clauses against an in-memory post.
	 * Supports `EXISTS`, `NOT EXISTS`, and `=` comparisons; ignores nested
	 * arrays. Used by `Documents::list()` and the cascade strategies.
	 *
	 * @param WP_Post $post        Candidate.
	 * @param array   $meta_query  meta_query clauses.
	 */
	private function matches_meta_query( WP_Post $post, array $meta_query ): bool {
		foreach ( $meta_query as $key => $clause ) {
			if ( 'relation' === $key || ! is_array( $clause ) ) {
				continue;
			}
			$meta_key = (string) ( $clause['key'] ?? '' );
			if ( '' === $meta_key ) {
				continue;
			}
			$compare = strtoupper( (string) ( $clause['compare'] ?? '=' ) );
			$values  = get_post_meta( (int) $post->ID, $meta_key, false );
			$has_any = is_array( $values ) && count( $values ) > 0;

			if ( 'EXISTS' === $compare ) {
				if ( ! $has_any ) {
					return false;
				}
				continue;
			}
			if ( 'NOT EXISTS' === $compare ) {
				if ( $has_any ) {
					return false;
				}
				continue;
			}
			$expected = (string) ( $clause['value'] ?? '' );
			$matched  = false;
			foreach ( (array) $values as $value ) {
				if ( (string) $value === $expected ) {
					$matched = true;
					break;
				}
			}
			if ( ! $matched ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Evaluates a subset of `tax_query` clauses against the in-memory term
	 * store. Supports `EXISTS`, `NOT EXISTS`, and membership tests by term id
	 * or slug. Term relationships are derived from `wp_get_object_terms`,
	 * which `wp_set_object_terms` writes through WP's standard taxonomy
	 * machinery and WorDBless backs in memory.
	 *
	 * @param WP_Post $post      Candidate.
	 * @param array   $tax_query tax_query clauses.
	 */
	private function matches_tax_query( WP_Post $post, array $tax_query ): bool {
		foreach ( $tax_query as $key => $clause ) {
			if ( 'relation' === $key || ! is_array( $clause ) ) {
				continue;
			}
			$taxonomy = (string) ( $clause['taxonomy'] ?? '' );
			if ( '' === $taxonomy ) {
				continue;
			}
			$compare = strtoupper( (string) ( $clause['operator'] ?? 'IN' ) );
			$field   = (string) ( $clause['field'] ?? 'term_id' );
			$fields  = in_array( $field, array( 'slug', 'name' ), true ) ? 'slugs' : 'ids';
			$terms   = wp_get_object_terms(
				(int) $post->ID,
				$taxonomy,
				array( 'fields' => $fields )
			);
			$has_any = is_array( $terms ) && count( $terms ) > 0;

			if ( 'EXISTS' === $compare ) {
				if ( ! $has_any ) {
					return false;
				}
				continue;
			}
			if ( 'NOT EXISTS' === $compare ) {
				if ( $has_any ) {
					return false;
				}
				continue;
			}
			$expected = in_array( $field, array( 'slug', 'name' ), true )
				? array_map( 'strval', (array) ( $clause['terms'] ?? array() ) )
				: array_map( 'intval', (array) ( $clause['terms'] ?? array() ) );
			$matched  = false;
			foreach ( (array) $terms as $term ) {
				$value = in_array( $field, array( 'slug', 'name' ), true )
					? (string) $term
					: (int) $term;
				if ( in_array( $value, $expected, true ) ) {
					$matched = true;
					break;
				}
			}
			if ( ! $matched ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Finds the text-like (`text`, `email`, `url`) field meta keys defined
	 * across every collection document in the in-memory store. WorDBless
	 * does not back the term relationships needed to scope rows to one
	 * trait, so the test shim widens the search to every text-like field on
	 * the workspace; this matches the production behaviour where
	 * `Documents::collect_row_text_keys` aggregates the union of field keys.
	 *
	 * @return string[]
	 */
	private function text_like_field_keys_for_document(): array {
		$keys = array();
		foreach ( $this->all_in_memory_posts() as $candidate ) {
			if ( Document::POST_TYPE !== $candidate->post_type ) {
				continue;
			}
			$field_ids = get_post_meta( (int) $candidate->ID, 'cortext_fields', false );
			if ( ! is_array( $field_ids ) || count( $field_ids ) === 0 ) {
				continue;
			}
			foreach ( $field_ids as $raw_field_id ) {
				$field_id = (int) $raw_field_id;
				if ( $field_id < 1 ) {
					continue;
				}
				$type = (string) get_post_meta( $field_id, 'type', true );
				if ( FieldTypeRegistry::is_text_like( $type ) ) {
					$keys[ "field-{$field_id}" ] = true;
				}
			}
		}
		return array_keys( $keys );
	}
}
