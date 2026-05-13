<?php
/**
 * Tests for Cortext\Rest\RowsQueryScope.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\Rest\RowsFilterQuery;
use Cortext\Rest\RowsQueryScope;
use WorDBless\BaseTestCase;
use WP_Query;

final class Test_Rest_Rows_Query_Scope extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();
	}

	public function test_run_appends_where_sql_for_scoped_query(): void {
		$scope          = $this->build_scope( 'WHERE_FRAGMENT', '', null );
		$query          = $this->mock_query_with_token( $scope );
		$where_callback = $this->grab_callback( $scope, 'posts_where' );

		$this->assertSame(
			"original_where AND WHERE_FRAGMENT",
			$where_callback( 'original_where', $query )
		);
	}

	public function test_run_leaves_unrelated_queries_untouched(): void {
		$scope          = $this->build_scope( 'WHERE_FRAGMENT', '', null );
		$other_query    = $this->mock_query_with_token( $scope, 'a-different-token' );
		$where_callback = $this->grab_callback( $scope, 'posts_where' );

		$this->assertSame(
			'original_where',
			$where_callback( 'original_where', $other_query ),
			'Scope should ignore queries that did not register its token.'
		);
	}

	public function test_run_returns_unchanged_where_when_fragment_is_empty(): void {
		$scope          = $this->build_scope( '', '', null );
		$query          = $this->mock_query_with_token( $scope );
		$where_callback = $this->grab_callback( $scope, 'posts_where' );

		$this->assertSame( 'original_where', $where_callback( 'original_where', $query ) );
	}

	public function test_run_unregisters_filters_when_done(): void {
		$scope = $this->build_scope( 'IRRELEVANT', '', null );

		try {
			$reflection = new \ReflectionClass( $scope );
			$method     = $reflection->getMethod( 'run' );
			$method->setAccessible( true );
			$method->invoke( $scope, array( 'post_type' => 'crtxt_does_not_exist' ) );
		} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement.DetectedCatch
			// Even if WP_Query throws on the unknown post type, the
			// scope's cleanup contract still applies.
		}

		$this->assertFalse(
			$this->scope_callback_is_registered( 'posts_where' ),
			'posts_where callback should have been removed.'
		);
		$this->assertFalse(
			$this->scope_callback_is_registered( 'posts_clauses' ),
			'posts_clauses callback should have been removed.'
		);
	}

	/**
	 * Builds a real RowsQueryScope and starts its run() machinery so the
	 * callbacks attach. Returns the scope object; the caller is expected
	 * to read the closures via grab_callback() and then trigger cleanup
	 * either by running a query or by directly removing.
	 */
	private function build_scope( string $where_sql, string $join_sql, mixed $sort ): RowsQueryScope {
		$row_query = new RowsFilterQuery();
		return new RowsQueryScope( $row_query, array(), $where_sql, $join_sql, $sort );
	}

	/**
	 * Returns a WP_Query whose cortext_rows_query_token matches the
	 * scope (so the scope's callbacks treat it as "ours"). When a custom
	 * token is supplied, the query looks like someone else's run.
	 */
	private function mock_query_with_token( RowsQueryScope $scope, ?string $token = null ): WP_Query {
		$reflection  = new \ReflectionClass( $scope );
		$token_prop  = $reflection->getProperty( 'token' );
		$token_prop->setAccessible( true );
		$scope_token = $token_prop->getValue( $scope );

		$query = new WP_Query();
		$query->set( 'cortext_rows_query_token', $token ?? $scope_token );
		return $query;
	}

	/**
	 * Invokes run() against a no-op query just so the scope attaches its
	 * callbacks, captures one of them by hook name, and then cleans up
	 * by manually firing the cleanup path.
	 *
	 * @return callable
	 */
	private function grab_callback( RowsQueryScope $scope, string $hook ): callable {
		$captured = null;
		$capture  = static function ( $value, $query ) use ( &$captured, $hook ): mixed {
			global $wp_filter;
			foreach ( $wp_filter[ $hook ]->callbacks as $priority_callbacks ) {
				foreach ( $priority_callbacks as $entry ) {
					$callback = $entry['function'];
					if ( $callback instanceof \Closure ) {
						$reflection = new \ReflectionFunction( $callback );
						if ( str_contains( (string) $reflection->getFileName(), 'RowsQueryScope.php' ) ) {
							$captured = $callback;
							return $value;
						}
					}
				}
			}
			return $value;
		};

		add_filter( $hook, $capture, 1, 2 );
		try {
			$reflection = new \ReflectionClass( $scope );
			$method     = $reflection->getMethod( 'run' );
			$method->setAccessible( true );
			$method->invoke( $scope, array( 'post_type' => 'crtxt_does_not_exist' ) );
		} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement.DetectedCatch
			// run() may throw if WP_Query trips on the unknown CPT; the
			// scope still attached and detached its callbacks first.
		}
		remove_filter( $hook, $capture, 1 );

		$this->assertNotNull( $captured, "Scope did not register a {$hook} callback." );
		return $captured;
	}

	private function scope_callback_is_registered( string $hook ): bool {
		global $wp_filter;
		if ( ! isset( $wp_filter[ $hook ] ) ) {
			return false;
		}
		foreach ( $wp_filter[ $hook ]->callbacks as $priority_callbacks ) {
			foreach ( $priority_callbacks as $callback_entry ) {
				$callback = $callback_entry['function'] ?? null;
				if ( $callback instanceof \Closure ) {
					$reflection = new \ReflectionFunction( $callback );
					if ( str_contains( (string) $reflection->getFileName(), 'RowsQueryScope.php' ) ) {
						return true;
					}
				}
			}
		}
		return false;
	}

	private function unregister_dynamic_collection_post_types(): void {
		foreach ( get_post_types() as $post_type ) {
			if (
				str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) &&
				! in_array( $post_type, array( Collection::POST_TYPE, Field::POST_TYPE ), true )
			) {
				unregister_post_type( $post_type );
			}
		}
	}
}
