<?php
/**
 * Tests for the in-memory WP_Query shim.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use WorDBless\BaseTestCase;
use WP_Query;

final class Test_In_Memory_Posts_Query extends BaseTestCase {

	use InMemoryPostsQuery;

	public function set_up(): void {
		parent::set_up();
		$this->install_in_memory_posts_query();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		parent::tear_down();
	}

	public function test_found_posts_are_bound_to_query_object_identity(): void {
		$first_query             = new WP_Query();
		$first_query->query_vars = array( 'post_type' => 'collision-regression' );

		$this->assertSame( array(), $this->serve_posts_from_memory( null, $first_query ) );
		$first_query_id = spl_object_id( $first_query );
		unset( $first_query );

		$second_query = new WP_Query();
		$this->assertSame( $first_query_id, spl_object_id( $second_query ) );
		$this->assertSame( 17, $this->serve_found_posts_from_memory( 17, $second_query ) );
	}

	public function test_reused_query_does_not_keep_found_posts_after_passthrough(): void {
		$query             = new WP_Query();
		$query->query_vars = array( 'post_type' => 'served-regression' );

		$this->assertSame( array(), $this->serve_posts_from_memory( null, $query ) );
		$this->assertSame( 0, $this->serve_found_posts_from_memory( 17, $query ) );

		$query->query_vars = array();
		$this->assertNull( $this->serve_posts_from_memory( null, $query ) );
		$this->assertSame( 17, $this->serve_found_posts_from_memory( 17, $query ) );
	}

	public function test_found_posts_survive_non_empty_and_empty_pages(): void {
		for ( $index = 1; $index <= 3; ++$index ) {
			wp_insert_post(
				array(
					'post_title'  => "Page {$index}",
					'post_type'   => 'page',
					'post_status' => 'publish',
				)
			);
		}

		$query_args = array(
			'post_type'      => 'page',
			'post_status'    => 'publish',
			'posts_per_page' => 2,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'ASC',
		);

		$non_empty_page = new WP_Query( array_merge( $query_args, array( 'paged' => 2 ) ) );
		$this->assertCount( 1, $non_empty_page->posts );
		$this->assertSame( 3, $non_empty_page->found_posts );
		$this->assertSame( 2, $non_empty_page->max_num_pages );

		$empty_page = new WP_Query( array_merge( $query_args, array( 'paged' => 3 ) ) );
		$this->assertSame( array(), $empty_page->posts );
		$this->assertSame( 3, $empty_page->found_posts );
		$this->assertSame( 2, $empty_page->max_num_pages );
	}
}
