<?php
/**
 * Tests for Cortext\Rest\BacklinksController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Rest\BacklinksController;
use Cortext\Taxonomy\MentionTaxonomy;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Backlinks_Controller extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private MentionTaxonomy $mentions;
	private TraitTaxonomy $traits;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new Field() )->register_post_type();
		$this->traits   = new TraitTaxonomy();
		$this->mentions = new MentionTaxonomy();
		$this->traits->register_taxonomy();
		$this->mentions->register_taxonomy();
		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		add_action( 'save_post_' . Document::POST_TYPE, array( $this->mentions, 'sync_mentions_on_save' ), 10, 3 );
		add_action( 'before_delete_post', array( $this->mentions, 'sync_term_on_delete' ), 10, 2 );

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new BacklinksController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		remove_action( 'save_post_' . Document::POST_TYPE, array( $this->mentions, 'sync_mentions_on_save' ), 10 );
		remove_action( 'before_delete_post', array( $this->mentions, 'sync_term_on_delete' ), 10 );
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_returns_page_and_row_backlinks_as_a_flat_list(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$target     = $this->create_document( 'Target' );
		$page       = $this->create_document( 'Source page', $this->mention_markup( $target ) );
		$collection = $this->create_collection( 'Tasks' );
		$row        = $this->create_row( $collection, 'Source row', $this->mention_markup( $target ) );

		$response = $this->get_backlinks( $target );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 2, $data['total'] );
		$this->assertFalse( $data['truncated'] );
		$this->assertArrayNotHasKey( 'groups', $data );
		$this->assertEqualsCanonicalizing( array( $page, $row ), array_column( $data['sources'], 'id' ) );

		$row_source = null;
		foreach ( $data['sources'] as $source ) {
			if ( $row === $source['id'] ) {
				$row_source = $source;
			}
		}
		$this->assertNotNull( $row_source );
		$this->assertSame( $collection, $row_source['collection']['id'] );
	}

	public function test_trashed_source_is_excluded(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$target = $this->create_document( 'Target' );
		$source = $this->create_document( 'Source', $this->mention_markup( $target ) );
		wp_trash_post( $source );

		$response = $this->get_backlinks( $target );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 0, $response->get_data()['total'] );
	}

	public function test_unreadable_source_is_filtered_out(): void {
		$admin = $this->create_user( 'administrator' );
		wp_set_current_user( $admin );

		$target  = $this->create_document( 'Target' );
		$public  = $this->create_document( 'Public source', $this->mention_markup( $target ) );
		$private = (int) wp_insert_post(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_status'  => 'private',
				'post_title'   => 'Private source',
				'post_content' => $this->mention_markup( $target ),
				'post_author'  => $admin,
			)
		);
		$this->assertGreaterThan( 0, $private );

		wp_set_current_user( $this->create_user( 'subscriber' ) );
		$response = $this->get_backlinks( $target );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 1, $data['total'] );
		$this->assertSame( array( $public ), array_column( $data['sources'], 'id' ) );
	}

	public function test_unknown_target_returns_404(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->get_backlinks( 99999 );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_empty_result_when_never_mentioned(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$target = $this->create_document( 'Target' );

		$response = $this->get_backlinks( $target );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 0, $response->get_data()['total'] );
		$this->assertSame( array(), $response->get_data()['sources'] );
	}

	private function get_backlinks( int $id ) {
		$request = new WP_REST_Request( 'GET', '/cortext/v1/documents/' . $id . '/backlinks' );
		return rest_do_request( $request );
	}

	private function create_document( string $title, string $content = '' ): int {
		return (int) wp_insert_post(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_status'  => 'publish',
				'post_title'   => $title,
				'post_content' => $content,
			)
		);
	}

	private function create_collection( string $title ): int {
		$collection = $this->create_document( $title );
		$this->traits->ensure_mirror_term( $collection );
		return $collection;
	}

	private function create_row( int $collection, string $title, string $content = '' ): int {
		$row     = $this->create_document( $title, $content );
		$term_id = TraitTaxonomy::term_id_for_trait( $collection );
		wp_set_object_terms( $row, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		return $row;
	}

	private function mention_markup( int $target ): string {
		return sprintf(
			'<p><a class="cortext-mention" data-crtxt-mention="%d" href="#">Target</a></p>',
			$target
		);
	}

	private function create_user( string $role ): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_', false ),
				'user_pass'  => 'password',
				'role'       => $role,
			)
		);
	}
}
