<?php
/**
 * In-memory term and term-relationship shim for tests running on WorDBless.
 *
 * WorDBless does not back the `wp_terms`, `wp_term_taxonomy`, or
 * `wp_term_relationships` tables, so calls like `wp_insert_term`,
 * `wp_set_object_terms`, `get_term_by( 'slug', ... )`, `has_term`, and
 * tax_query lookups all come back empty. This trait stores terms and the
 * object-term relationships in static arrays and short-circuits the WP
 * filters and function calls that need them.
 *
 * Use by `use InMemoryTermStore;` in a test class and call
 * `install_in_memory_term_store()` from `set_up()` plus
 * `uninstall_in_memory_term_store()` from `tear_down()`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Taxonomy\TraitTaxonomy;
use WP_Term;

trait InMemoryTermStore {

	/**
	 * @var array<int, array{term_id:int,name:string,slug:string,taxonomy:string,term_taxonomy_id:int}>
	 */
	private static array $term_store = array();

	/**
	 * Map of object id to the list of term ids the object is tagged with.
	 *
	 * @var array<int, int[]>
	 */
	private static array $object_terms = array();

	private static int $next_term_id = 1;

	protected function install_in_memory_term_store(): void {
		self::$term_store     = array();
		self::$object_terms   = array();
		self::$next_term_id   = 1;

		add_filter( 'pre_insert_term', array( $this, 'mock_pre_insert_term' ), 10, 3 );
		add_filter( 'wp_insert_term_data', array( $this, 'mock_wp_insert_term_data' ), 10, 4 );
		add_filter( 'terms_pre_query', array( $this, 'mock_terms_pre_query' ), 10, 2 );
		add_filter( 'get_term', array( $this, 'mock_get_term_filter' ), 10, 2 );
		add_filter( 'get_object_terms', array( $this, 'mock_get_object_terms' ), 10, 4 );
		add_filter( 'get_the_terms', array( $this, 'mock_get_the_terms' ), 10, 3 );
		add_filter( 'wp_get_object_terms_args', array( $this, 'noop_filter' ), 10, 1 );
		add_action( 'set_object_terms', array( $this, 'mock_set_object_terms' ), 10, 6 );
		add_action( 'delete_term', array( $this, 'mock_delete_term' ), 10, 5 );
	}

	protected function uninstall_in_memory_term_store(): void {
		remove_filter( 'pre_insert_term', array( $this, 'mock_pre_insert_term' ), 10 );
		remove_filter( 'wp_insert_term_data', array( $this, 'mock_wp_insert_term_data' ), 10 );
		remove_filter( 'terms_pre_query', array( $this, 'mock_terms_pre_query' ), 10 );
		remove_filter( 'get_term', array( $this, 'mock_get_term_filter' ), 10 );
		remove_filter( 'get_object_terms', array( $this, 'mock_get_object_terms' ), 10 );
		remove_filter( 'get_the_terms', array( $this, 'mock_get_the_terms' ), 10 );
		remove_filter( 'wp_get_object_terms_args', array( $this, 'noop_filter' ), 10 );
		remove_action( 'set_object_terms', array( $this, 'mock_set_object_terms' ), 10 );
		remove_action( 'delete_term', array( $this, 'mock_delete_term' ), 10 );
		foreach ( array_keys( self::$object_terms ) as $object_id ) {
			wp_cache_delete( $object_id, TraitTaxonomy::TAXONOMY . '_relationships' );
		}
		self::$term_store   = array();
		self::$object_terms = array();
		self::$next_term_id = 1;
	}

	/**
	 * Direct write into the shim so test setup can avoid going through
	 * `wp_insert_term` (which round-trips through WorDBless's broken
	 * wpdb).
	 *
	 * @param string $name     Term name.
	 * @param string $slug     Term slug.
	 * @param string $taxonomy Taxonomy slug.
	 * @return int Newly assigned term id.
	 */
	protected function memo_insert_term( string $name, string $slug, string $taxonomy ): int {
		$term_id                       = self::$next_term_id++;
		self::$term_store[ $term_id ] = array(
			'term_id'          => $term_id,
			'name'             => $name,
			'slug'             => $slug,
			'taxonomy'         => $taxonomy,
			'term_taxonomy_id' => $term_id,
		);
		wp_cache_set( $term_id, (object) self::$term_store[ $term_id ], 'terms' );
		return $term_id;
	}

	/**
	 * Direct write into the relationship store so test setup can avoid
	 * `wp_set_object_terms`.
	 *
	 * @param int   $object_id Post id.
	 * @param int[] $term_ids  Term ids to attach (replaces previous values).
	 */
	protected function memo_set_object_terms( int $object_id, array $term_ids ): void {
		self::$object_terms[ $object_id ] = array_values( array_unique( array_map( 'intval', $term_ids ) ) );
		wp_cache_set( $object_id, self::$object_terms[ $object_id ], TraitTaxonomy::TAXONOMY . '_relationships' );
	}

	/**
	 * Forwards the pre_insert_term filter: returns the term unchanged so WP
	 * can continue, but if there's an existing term with the same slug we
	 * short-circuit by returning a WP_Error to avoid the DB write that
	 * would fail in WorDBless.
	 *
	 * @param string|\WP_Error $term     Term name.
	 * @param string           $taxonomy Taxonomy slug.
	 * @param array            $args     Insert args.
	 * @return string|\WP_Error
	 */
	public function mock_pre_insert_term( $term, $taxonomy, $args = array() ) {
		unset( $args );
		return $term;
	}

	/**
	 * Captures inserts that go through `wp_insert_term` so the shim store
	 * stays consistent. The filter returns the data unchanged; the actual
	 * write into `$wpdb->terms` succeeds silently in WorDBless without
	 * persisting anything, so we mirror it here.
	 *
	 * @param array  $data     Term data.
	 * @param string $taxonomy Taxonomy slug.
	 * @param array  $args     Insert args (unused).
	 * @param int    $tt_id    Term taxonomy id (unused at this point).
	 * @return array
	 */
	public function mock_wp_insert_term_data( $data, $taxonomy, $args, $tt_id = 0 ) {
		unset( $args, $tt_id );
		$slug = (string) ( $data['slug'] ?? '' );
		$name = (string) ( $data['name'] ?? '' );
		if ( '' === $slug ) {
			$slug = sanitize_title( $name );
		}
		// Mirror the WP insert into the in-memory store.
		$term_id                      = self::$next_term_id++;
		self::$term_store[ $term_id ] = array(
			'term_id'          => $term_id,
			'name'             => $name,
			'slug'             => $slug,
			'taxonomy'         => (string) $taxonomy,
			'term_taxonomy_id' => $term_id,
		);
		// Prime the WP object cache so `WP_Term::get_instance` can resolve
		// the term without hitting wpdb. Without this, get_term returns
		// null and `is_object_in_term` reads property on null when the
		// relationship cache returns just term ids.
		wp_cache_set( $term_id, (object) self::$term_store[ $term_id ], 'terms' );
		// `wp_insert_term` does a database INSERT next; WorDBless will
		// "succeed" without writing anything. We've recorded the term in
		// the shim so subsequent reads find it.
		return $data;
	}

	/**
	 * Serves `WP_Term_Query` reads from the in-memory store. Implements
	 * a minimal subset of the query: by slug, by name, by include, by
	 * taxonomy.
	 *
	 * @param array|null      $terms Existing terms (passed through when null).
	 * @param \WP_Term_Query  $query The term query.
	 * @return array|null
	 */
	public function mock_terms_pre_query( $terms, $query ) {
		$vars = $query->query_vars;

		$taxonomies = isset( $vars['taxonomy'] ) ? (array) $vars['taxonomy'] : array();
		$slugs      = isset( $vars['slug'] ) ? (array) $vars['slug'] : array();
		$names      = isset( $vars['name'] ) ? (array) $vars['name'] : array();
		$include    = isset( $vars['include'] ) ? array_map( 'intval', (array) $vars['include'] ) : array();
		$object_ids = isset( $vars['object_ids'] ) ? array_map( 'intval', (array) $vars['object_ids'] ) : array();
		$fields     = (string) ( $vars['fields'] ?? 'all' );

		$matches = array();
		foreach ( self::$term_store as $term ) {
			if ( $taxonomies && ! in_array( $term['taxonomy'], $taxonomies, true ) ) {
				continue;
			}
			if ( $slugs && ! in_array( $term['slug'], $slugs, true ) ) {
				continue;
			}
			if ( $names && ! in_array( $term['name'], $names, true ) ) {
				continue;
			}
			if ( $include && ! in_array( $term['term_id'], $include, true ) ) {
				continue;
			}
			$matches[] = $term;
		}

		if ( $object_ids ) {
			$attached = array();
			foreach ( $object_ids as $oid ) {
				foreach ( self::$object_terms[ $oid ] ?? array() as $term_id ) {
					$attached[ $term_id ] = true;
				}
			}
			$matches = array_values(
				array_filter(
					$matches,
					static fn( array $term ): bool => isset( $attached[ $term['term_id'] ] )
				)
			);
		}

		return $this->shape_terms( $matches, $fields );
	}

	/**
	 * Returns the requested view over the matched terms. Supports the
	 * subset of `fields` values used across Cortext code paths.
	 *
	 * @param array<int,array<string,mixed>> $matches Filtered term rows.
	 * @param string                         $fields  Field selector.
	 * @return array
	 */
	private function shape_terms( array $matches, string $fields ): array {
		if ( 'ids' === $fields ) {
			return array_map( static fn( array $term ): int => (int) $term['term_id'], $matches );
		}
		if ( 'tt_ids' === $fields ) {
			return array_map( static fn( array $term ): int => (int) $term['term_taxonomy_id'], $matches );
		}
		if ( 'slugs' === $fields ) {
			return array_map( static fn( array $term ): string => (string) $term['slug'], $matches );
		}
		if ( 'count' === $fields ) {
			return array( count( $matches ) );
		}
		return array_map( fn( array $term ): WP_Term => $this->row_to_term( $term ), $matches );
	}

	/**
	 * Resolves a `WP_Term` from a stored row.
	 */
	private function row_to_term( array $row ): WP_Term {
		$term                   = new WP_Term( (object) $row );
		$term->term_id          = (int) $row['term_id'];
		$term->term_taxonomy_id = (int) $row['term_taxonomy_id'];
		$term->name             = (string) $row['name'];
		$term->slug             = (string) $row['slug'];
		$term->taxonomy         = (string) $row['taxonomy'];
		return $term;
	}

	/**
	 * Handles `get_term` lookups by term id when the underlying DB returns
	 * nothing.
	 *
	 * @param mixed  $term     Existing term (passed through when not empty).
	 * @param string $taxonomy Expected taxonomy slug.
	 * @return mixed
	 */
	public function mock_get_term_filter( $term, $taxonomy ) {
		if ( $term instanceof WP_Term ) {
			return $term;
		}
		$term_id = 0;
		if ( is_object( $term ) && isset( $term->term_id ) ) {
			$term_id = (int) $term->term_id;
		} elseif ( is_numeric( $term ) ) {
			$term_id = (int) $term;
		}
		if ( $term_id < 1 ) {
			return $term;
		}
		if ( ! isset( self::$term_store[ $term_id ] ) ) {
			return $term;
		}
		$row = self::$term_store[ $term_id ];
		if ( $taxonomy && $row['taxonomy'] !== $taxonomy ) {
			return $term;
		}
		return $this->row_to_term( $row );
	}

	/**
	 * Serves `wp_get_object_terms` from the in-memory store.
	 *
	 * @param array|null $terms      Existing terms (passed through when not empty).
	 * @param int[]      $object_ids Object ids.
	 * @param string[]   $taxonomies Taxonomies.
	 * @param array      $args       Query args.
	 * @return array
	 */
	public function mock_get_object_terms( $terms, $object_ids, $taxonomies, $args ) {
		if ( ! empty( $terms ) ) {
			return $terms;
		}

		$matches = array();
		foreach ( (array) $object_ids as $oid ) {
			foreach ( self::$object_terms[ (int) $oid ] ?? array() as $term_id ) {
				$row = self::$term_store[ $term_id ] ?? null;
				if ( ! $row ) {
					continue;
				}
				if ( $taxonomies && ! in_array( $row['taxonomy'], (array) $taxonomies, true ) ) {
					continue;
				}
				$matches[ $term_id ] = $row;
			}
		}

		$fields = is_array( $args ) ? (string) ( $args['fields'] ?? 'all' ) : 'all';
		return $this->shape_terms( array_values( $matches ), $fields );
	}

	/**
	 * Supplies terms when WorDBless cannot hydrate cached term IDs.
	 *
	 * @param mixed  $terms    Existing terms.
	 * @param int    $post_id  Post ID.
	 * @param string $taxonomy Taxonomy slug.
	 * @return mixed
	 */
	public function mock_get_the_terms( $terms, $post_id, $taxonomy ) {
		if ( TraitTaxonomy::TAXONOMY !== (string) $taxonomy || is_wp_error( $terms ) ) {
			return $terms;
		}

		$has_valid_terms = is_array( $terms ) && ! empty( $terms );
		if ( $has_valid_terms ) {
			foreach ( $terms as $term ) {
				if ( ! ( $term instanceof WP_Term ) ) {
					$has_valid_terms = false;
					break;
				}
			}
		}
		if ( $has_valid_terms ) {
			return $terms;
		}

		$matches = array();
		foreach ( self::$object_terms[ (int) $post_id ] ?? array() as $term_id ) {
			$row = self::$term_store[ $term_id ] ?? null;
			if ( $row && TraitTaxonomy::TAXONOMY === $row['taxonomy'] ) {
				$matches[] = $row;
			}
		}
		if ( count( $matches ) === 0 ) {
			return $has_valid_terms ? $terms : false;
		}

		return $this->shape_terms( $matches, 'all' );
	}

	/**
	 * Captures `wp_set_object_terms` writes.
	 *
	 * @param int    $object_id  Object id.
	 * @param array  $terms      Terms passed in (names/ids).
	 * @param array  $tt_ids     Term taxonomy ids that ended up assigned.
	 * @param string $taxonomy   Taxonomy slug.
	 * @param bool   $append     Whether to append.
	 * @param array  $old_tt_ids Previously assigned.
	 */
	public function mock_set_object_terms( $object_id, $terms, $tt_ids, $taxonomy, $append, $old_tt_ids ) {
		unset( $old_tt_ids );

		$object_id = (int) $object_id;
		$resolved  = array();
		foreach ( (array) $terms as $term ) {
			$row = $this->resolve_term( $term, (string) $taxonomy );
			if ( $row ) {
				$resolved[] = (int) $row['term_id'];
			}
		}
		$current = self::$object_terms[ $object_id ] ?? array();
		if ( ! $append ) {
			$current = array_values(
				array_filter(
					$current,
					static function ( int $term_id ) use ( $taxonomy ): bool {
						$row = self::$term_store[ $term_id ] ?? null;
						return $row && $row['taxonomy'] !== $taxonomy;
					}
				)
			);
		}
		self::$object_terms[ $object_id ] = array_values( array_unique( array_merge( $current, $resolved ) ) );
		wp_cache_set( $object_id, self::$object_terms[ $object_id ], $taxonomy . '_relationships' );
	}

	/**
	 * Drops a term from the in-memory store when WP deletes it.
	 *
	 * @param int    $term_id  Term id.
	 * @param int    $tt_id    Term taxonomy id.
	 * @param string $taxonomy Taxonomy slug.
	 * @param mixed  $deleted  Deleted term (unused).
	 * @param array  $ids      Object ids previously attached (unused).
	 */
	public function mock_delete_term( $term_id, $tt_id, $taxonomy, $deleted, $ids ) {
		unset( $tt_id, $taxonomy, $deleted, $ids );
		$term_id = (int) $term_id;
		unset( self::$term_store[ $term_id ] );
		foreach ( self::$object_terms as $object_id => $attached ) {
			self::$object_terms[ $object_id ] = array_values(
				array_filter(
					$attached,
					static fn( int $tid ): bool => $tid !== $term_id
				)
			);
			wp_cache_set( $object_id, self::$object_terms[ $object_id ], TraitTaxonomy::TAXONOMY . '_relationships' );
		}
	}

	/**
	 * Resolves a term reference (id, slug, name) against the in-memory store.
	 *
	 * @param int|string $term     Term reference.
	 * @param string     $taxonomy Taxonomy slug.
	 * @return array<string,mixed>|null
	 */
	private function resolve_term( $term, string $taxonomy ): ?array {
		if ( is_numeric( $term ) ) {
			$id = (int) $term;
			if ( isset( self::$term_store[ $id ] ) && self::$term_store[ $id ]['taxonomy'] === $taxonomy ) {
				return self::$term_store[ $id ];
			}
			return null;
		}
		$name = (string) $term;
		foreach ( self::$term_store as $row ) {
			if ( $row['taxonomy'] !== $taxonomy ) {
				continue;
			}
			if ( $row['name'] === $name || $row['slug'] === $name ) {
				return $row;
			}
		}
		return null;
	}

	/**
	 * No-op filter used as a passthrough for `wp_get_object_terms_args`.
	 *
	 * @param array $args Args.
	 * @return array
	 */
	public function noop_filter( $args ) {
		return $args;
	}
}
