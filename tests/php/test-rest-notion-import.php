<?php
/**
 * Tests for the Notion import tick loop.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Notion\Importer;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Rest\NotionController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Notion_Import extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private const DATA_SOURCE_ID = 'ds-1';

	private ArchiveCascade $archive_cascade;

	private int $next_page = 0;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );

		$this->archive_cascade = new ArchiveCascade();
		$this->archive_cascade->register_status();
		$this->archive_cascade->register_meta();
		$this->archive_cascade->register();
		( new TrashCascade() )->register();

		$this->next_page = 0;
		add_filter( 'pre_http_request', array( $this, 'fake_notion' ), 10, 3 );

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new NotionController() )->register();
		do_action( 'rest_api_init' );

		wp_set_current_user( $this->create_admin() );
	}

	public function tear_down(): void {
		remove_filter( 'pre_http_request', array( $this, 'fake_notion' ), 10 );
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_tick_imports_rows_into_an_active_collection(): void {
		$started = $this->start_import();

		$ticked = $this->tick( $started['job_id'] );

		$this->assertSame( 'running', $ticked['status'] );
		$this->assertTrue( $ticked['has_more'] );
		$this->assertSame( 2, $ticked['processed'] );
		$this->assertCount( 2, $this->imported_row_ids() );
	}

	/**
	 * @dataProvider hidden_statuses
	 *
	 * @param string $status          Hidden status applied to the collection.
	 * @param string $expected_message Message the job reports.
	 */
	public function test_tick_stops_when_the_collection_is_hidden( string $status, string $expected_message ): void {
		$started = $this->start_import();
		$this->tick( $started['job_id'] );
		$rows_before = $this->imported_row_ids();
		$this->assertCount( 2, $rows_before );

		$this->hide( $started['collection_id'], $status );
		$stopped = $this->tick( $started['job_id'] );

		$this->assertSame( 'error', $stopped['status'] );
		$this->assertFalse( $stopped['has_more'] );
		$this->assertSame( 2, $stopped['processed'] );
		$this->assertSame( $expected_message, $stopped['message'] );
		$this->assertSame( $rows_before, $this->imported_row_ids() );

		$again = $this->tick( $started['job_id'] );
		$this->assertSame( 'error', $again['status'] );
		$this->assertFalse( $again['has_more'] );
		$this->assertSame( $rows_before, $this->imported_row_ids() );
	}

	public static function hidden_statuses(): array {
		return array(
			'archived' => array( 'crtxt_archived', 'The collection was archived, so the import stopped.' ),
			'trashed'  => array( 'trash', 'The collection was moved to Trash, so the import stopped.' ),
		);
	}

	/**
	 * Serves the Notion endpoints the import calls. Every `/query` page
	 * returns two rows and reports more pages.
	 *
	 * @param mixed  $preempt Earlier short-circuit value.
	 * @param array  $args    Request arguments.
	 * @param string $url     Request URL.
	 * @return mixed
	 */
	public function fake_notion( $preempt, $args, $url ) {
		unset( $args );
		if ( ! str_starts_with( (string) $url, 'https://api.notion.com/' ) ) {
			return $preempt;
		}

		if ( str_ends_with( (string) $url, '/data_sources/' . self::DATA_SOURCE_ID ) ) {
			return $this->json_response(
				array(
					'id'         => self::DATA_SOURCE_ID,
					'title'      => array( array( 'plain_text' => 'Tasks' ) ),
					'properties' => array(
						'Name' => array(
							'id'    => 'title',
							'type'  => 'title',
							'title' => array(),
						),
					),
				)
			);
		}

		if ( str_ends_with( (string) $url, '/data_sources/' . self::DATA_SOURCE_ID . '/query' ) ) {
			++$this->next_page;
			$results = array();
			for ( $i = 1; $i <= 2; $i++ ) {
				$results[] = array(
					'id'         => "page-{$this->next_page}-{$i}",
					'properties' => array(
						'Name' => array(
							'id'    => 'title',
							'type'  => 'title',
							'title' => array( array( 'plain_text' => "Row {$this->next_page}.{$i}" ) ),
						),
					),
				);
			}
			return $this->json_response(
				array(
					'results'     => $results,
					'has_more'    => true,
					'next_cursor' => 'cursor-' . $this->next_page,
				)
			);
		}

		return $preempt;
	}

	private function json_response( array $body ): array {
		return array(
			'headers'  => array(),
			'body'     => (string) wp_json_encode( $body ),
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'cookies'  => array(),
		);
	}

	private function start_import(): array {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/notion/import/start' );
		$request->set_header( 'X-Notion-Key', 'secret' );
		$request->set_param( 'data_source_id', self::DATA_SOURCE_ID );

		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertGreaterThan( 0, $data['collection_id'] );

		return $data;
	}

	private function tick( string $job_id ): array {
		$request = new WP_REST_Request( 'POST', "/cortext/v1/notion/import/{$job_id}/tick" );
		$request->set_header( 'X-Notion-Key', 'secret' );
		$request->set_param( 'job_id', $job_id );

		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );

		return $response->get_data();
	}

	/**
	 * Returns the ids of every document the importer created from a Notion page.
	 *
	 * @return int[]
	 */
	private function imported_row_ids(): array {
		$ids = array();
		foreach ( \WorDBless\Posts::init()->posts as $post ) {
			if (
				Document::POST_TYPE === $post->post_type
				&& '' !== (string) get_post_meta( (int) $post->ID, Importer::META_ROW_PAGE_ID, true )
			) {
				$ids[] = (int) $post->ID;
			}
		}
		sort( $ids );

		return $ids;
	}

	private function hide( int $collection_id, string $status ): void {
		if ( 'trash' === $status ) {
			$this->assertNotEmpty( wp_trash_post( $collection_id ) );
		} else {
			$this->assertIsArray( $this->archive_cascade->archive( $collection_id ) );
		}
		$this->assertSame( $status, get_post_status( $collection_id ) );
	}

	private function create_admin(): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_notion_', false ),
				'user_pass'  => 'password',
				'role'       => 'administrator',
			)
		);
	}
}
