<?php
/**
 * Tests for Cortext\Editor\RevisionThrottle.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Editor\RevisionThrottle;
use WorDBless\BaseTestCase;
use WP_Post;

final class Test_Revision_Throttle extends BaseTestCase {

	private const POST_TYPE = 'crtxt_page';

	private function make_post( string $post_type ): WP_Post {
		return new WP_Post(
			(object) array(
				'ID'        => 1,
				'post_type' => $post_type,
			)
		);
	}

	private function make_revision( int $seconds_ago ): WP_Post {
		return new WP_Post(
			(object) array(
				'ID'                => 2,
				'post_type'         => 'revision',
				'post_modified_gmt' => gmdate( 'Y-m-d H:i:s', time() - $seconds_ago ),
			)
		);
	}

	public function test_register_hooks_both_filters(): void {
		remove_all_filters( 'wp_save_post_revision_post_has_changed' );
		remove_all_filters( 'wp_revisions_to_keep' );

		( new RevisionThrottle() )->register();

		$this->assertNotFalse(
			has_filter( 'wp_save_post_revision_post_has_changed' ),
			'throttle_revision filter should be registered.'
		);
		$this->assertNotFalse(
			has_filter( 'wp_revisions_to_keep' ),
			'cap_revisions filter should be registered.'
		);
	}

	public function test_throttle_passes_through_for_non_cortext_post_types(): void {
		$throttle = new RevisionThrottle();
		$post     = $this->make_post( 'page' );
		$revision = $this->make_revision( 1 );

		$this->assertTrue( $throttle->throttle_revision( true, $revision, $post ) );
		$this->assertFalse( $throttle->throttle_revision( false, $revision, $post ) );
	}

	public function test_throttle_suppresses_crtxt_page_within_interval_window(): void {
		$throttle = new RevisionThrottle();
		$post     = $this->make_post( self::POST_TYPE );
		$revision = $this->make_revision( 60 );

		$this->assertFalse(
			$throttle->throttle_revision( true, $revision, $post ),
			'Recent revisions should suppress the new revision even when the post changed.'
		);
	}

	public function test_throttle_just_inside_window_still_suppresses(): void {
		$throttle = new RevisionThrottle();
		$post     = $this->make_post( self::POST_TYPE );
		$revision = $this->make_revision( 599 );

		$this->assertFalse( $throttle->throttle_revision( true, $revision, $post ) );
	}

	public function test_throttle_passes_through_once_interval_has_elapsed(): void {
		$throttle = new RevisionThrottle();
		$post     = $this->make_post( self::POST_TYPE );
		$revision = $this->make_revision( 601 );

		$this->assertTrue(
			$throttle->throttle_revision( true, $revision, $post ),
			'Old revisions should let a new revision through when the post changed.'
		);
		$this->assertFalse(
			$throttle->throttle_revision( false, $revision, $post ),
			'Old revisions should preserve the incoming "no change" verdict.'
		);
	}

	public function test_throttle_passes_through_when_revision_timestamp_is_invalid(): void {
		$throttle = new RevisionThrottle();
		$post     = $this->make_post( self::POST_TYPE );
		$revision = new WP_Post(
			(object) array(
				'ID'                => 2,
				'post_type'         => 'revision',
				'post_modified_gmt' => 'not-a-date',
			)
		);

		$this->assertTrue( $throttle->throttle_revision( true, $revision, $post ) );
	}

	public function test_cap_revisions_passes_through_for_non_cortext_post_types(): void {
		$throttle = new RevisionThrottle();
		$post     = $this->make_post( 'page' );

		$this->assertSame( 25, $throttle->cap_revisions( 25, $post ) );
		$this->assertSame( -1, $throttle->cap_revisions( -1, $post ) );
	}

	public function test_cap_revisions_caps_crtxt_page_regardless_of_incoming_value(): void {
		$throttle = new RevisionThrottle();
		$post     = $this->make_post( self::POST_TYPE );

		$this->assertSame( 50, $throttle->cap_revisions( 5, $post ) );
		$this->assertSame( 50, $throttle->cap_revisions( -1, $post ) );
		$this->assertSame( 50, $throttle->cap_revisions( 999, $post ) );
	}
}
