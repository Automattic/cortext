<?php
/**
 * Tests for Cortext\Frontend\AdminBar.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Frontend\AdminBar;
use Cortext\PostType\Document;
use WorDBless\BaseTestCase;
use WP_Query;

final class Test_Frontend_Admin_Bar extends BaseTestCase {

	private ?WP_Query $previous_wp_query = null;

	private ?AdminBar $admin_bar = null;

	public function set_up(): void {
		parent::set_up();

		global $wp_query;
		$this->previous_wp_query = $wp_query ?? null;

		( new Document() )->register_post_type();
	}

	public function tear_down(): void {
		if ( $this->admin_bar ) {
			remove_filter( 'show_admin_bar', array( $this->admin_bar, 'hide_on_public_document_pages' ) );
		}

		global $wp_query;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restore the query object swapped in by this test.
		$wp_query = $this->previous_wp_query;

		parent::tear_down();
	}

	public function test_filter_hides_admin_bar_on_public_cortext_pages(): void {
		$document_id = $this->create_post_of_type( Document::POST_TYPE );
		$this->set_singular_query_for_post( $document_id );

		$this->admin_bar = new AdminBar();
		$this->admin_bar->register();

		$this->assertFalse( apply_filters( 'show_admin_bar', true ) );
	}

	public function test_filter_leaves_other_frontend_pages_alone(): void {
		$post_id = $this->create_post_of_type( 'post' );
		$this->set_singular_query_for_post( $post_id );

		$this->admin_bar = new AdminBar();
		$this->admin_bar->register();

		$this->assertTrue( apply_filters( 'show_admin_bar', true ) );
		$this->assertFalse( apply_filters( 'show_admin_bar', false ) );
	}

	private function create_post_of_type( string $post_type ): int {
		$post_id = wp_insert_post(
			array(
				'post_type'   => $post_type,
				'post_status' => 'publish',
				'post_title'  => 'Admin bar test ' . wp_generate_uuid4(),
			)
		);

		$this->assertIsInt( $post_id );
		$this->assertGreaterThan( 0, $post_id );

		return (int) $post_id;
	}

	private function set_singular_query_for_post( int $post_id ): void {
		global $wp_query;

		$post = get_post( $post_id );
		$this->assertNotNull( $post );

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Exercise the same query conditional the filter uses.
		$wp_query                    = new WP_Query();
		$wp_query->post              = $post;
		$wp_query->queried_object    = $post;
		$wp_query->queried_object_id = $post_id;
		$wp_query->is_single         = true;
		$wp_query->is_singular       = true;
	}
}
