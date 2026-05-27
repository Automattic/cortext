<?php
/**
 * Tests for Cortext\Rest\CollectionsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Block\DataView;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Rest\CollectionsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_Block;
use WP_Block_Type_Registry;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Collections_Controller extends BaseTestCase {

	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new Document() )->register_collection_meta();
		( new DocumentIdentity() )->register();
		( new TraitTaxonomy() )->register_taxonomy();
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new CollectionsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_get_views_returns_default_view_config(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Views' );

		$response = $this->get_collection_views( $collection_id );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'default', $data['active_view'] );
		$this->assertSame( 'table', $data['default_view']['type'] );
		$this->assertArrayNotHasKey( 'page', $data['default_view'] );
		$this->assertSame( '', $data['default_view']['search'] );
		$this->assertArrayNotHasKey( 'page', $data['default_view'] );
		$this->assertSame( 'compact', $data['default_layouts']['table']['layout']['density'] );
		$this->assertSame( 230, $data['default_layouts']['grid']['layout']['previewSize'] );
		$this->assertCount( 1, $data['view_list'] );
		$this->assertSame( 'default', $data['view_list'][0]['slug'] );
		$this->assertSame( 'Table', $data['view_list'][0]['title'] );
		$this->assertSame( 'table', $data['view_list'][0]['view']['type'] );
		$this->assertSame( 'side', $data['view_list'][0]['view']['rowDetailMode'] );
	}

	public function test_update_views_persists_view_config(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Saved Views' );

		$payload = array(
			'active_view' => 'view-2',
			'view_list'   => array(
				array(
					'slug'  => 'default',
					'title' => 'Table',
					'view'  => array(
						'type'         => 'table',
						'fields'       => array( 'title' ),
						'sort'         => null,
						'filters'      => array(),
						'calculations' => array(),
						'perPage'      => 25,
						'layout'       => array( 'density' => 'compact' ),
					),
				),
				array(
					'slug'  => 'view-2',
					'title' => 'Filtered',
					'view'  => array(
						'type'          => 'table',
						'fields'        => array( 'title', 'field-10' ),
						'sort'          => array(
							'field'     => 'field-10',
							'direction' => 'asc',
						),
						'filters'       => array(
							array(
								'field'    => 'field-10',
								'operator' => 'is',
								'value'    => 'open',
							),
						),
						'calculations'  => array( 'field-10' => 'count' ),
						'perPage'       => 50,
						'page'          => 2,
						'search'        => 'open',
						'groupByField'  => 'field-10',
						'layout'        => array(
							'density' => 'comfortable',
							'styles'  => array(
								'field-10' => array( 'width' => 240 ),
							),
						),
						'rowDetailMode' => 'modal',
					),
				),
			),
		);

		$response = $this->update_collection_views( $collection_id, $payload );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'view-2', $data['active_view'] );
		$this->assertSame( 'Filtered', $data['view_list'][1]['title'] );
		$this->assertSame( 'modal', $data['view_list'][1]['view']['rowDetailMode'] );
		$this->assertArrayNotHasKey( 'page', $data['view_list'][1]['view'] );
		$this->assertSame( 'open', $data['view_list'][1]['view']['search'] );

		$stored = json_decode( get_post_meta( $collection_id, 'cortext_view_config', true ), true );
		$this->assertSame( $data, $stored );

		$get_response = $this->get_collection_views( $collection_id );
		$this->assertSame( $data, $get_response->get_data() );
	}

	public function test_update_views_preserves_json_escapes_in_storage(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Escaped Views' );
		add_post_meta(
			$collection_id,
			'cortext_view_config',
			wp_json_encode(
				array(
					'active_view' => 'default',
					'view_list'   => array(
						array(
							'slug'  => 'default',
							'title' => 'Initial',
							'view'  => array( 'type' => 'table' ),
						),
					),
				)
			),
			true
		);

		$payload = array(
			'active_view' => 'default',
			'view_list'   => array(
				array(
					'slug'  => 'default',
					'title' => 'Quotes "and" slash \\ view',
					'view'  => array(
						'type'         => 'table',
						'fields'       => array( 'title' ),
						'sort'         => null,
						'filters'      => array(
							array(
								'field'    => 'title',
								'operator' => 'is',
								'value'    => 'A "quoted" C:\\Drafts value',
							),
						),
						'calculations' => array(),
						'perPage'      => 25,
						'layout'       => array( 'density' => 'compact' ),
					),
				),
			),
		);

		$response = $this->update_collection_views( $collection_id, $payload );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Quotes "and" slash \\ view', $data['view_list'][0]['title'] );
		$this->assertSame( 'A "quoted" C:\\Drafts value', $data['view_list'][0]['view']['filters'][0]['value'] );

		$stored_raw = get_post_meta( $collection_id, 'cortext_view_config', true );
		$stored     = json_decode( $stored_raw, true );
		if ( ! is_array( $stored ) ) {
			$stored = json_decode( wp_unslash( $stored_raw ), true );
		}
		$this->assertSame( $data, $stored );
		$this->assertSame( $data, $this->get_collection_views( $collection_id )->get_data() );
	}

	public function test_update_views_rejects_empty_view_list(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Invalid Views' );

		$response = $this->update_collection_views(
			$collection_id,
			array(
				'active_view' => 'default',
				'view_list'   => array(),
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_update_views_rejects_malformed_view_payload(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Malformed Views' );

		$response = $this->update_collection_views(
			$collection_id,
			array(
				'active_view' => 'default',
				'view_list'   => array(
					array(
						'slug'  => 'default',
						'title' => 'Broken',
						'view'  => array( 'not-an-object' ),
					),
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_update_views_rejects_duplicate_slugs(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Duplicate Views' );

		$response = $this->update_collection_views(
			$collection_id,
			array(
				'active_view' => 'default',
				'view_list'   => array(
					array(
						'slug'  => 'default',
						'title' => 'One',
						'view'  => array( 'type' => 'table' ),
					),
					array(
						'slug'  => 'default',
						'title' => 'Two',
						'view'  => array( 'type' => 'table' ),
					),
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_get_views_returns_default_for_malformed_stored_payload(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Stored Malformed Views' );

		update_post_meta( $collection_id, 'cortext_view_config', '{"view_list": "broken"}' );

		$response = $this->get_collection_views( $collection_id );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'default', $data['active_view'] );
		$this->assertCount( 1, $data['view_list'] );
		$this->assertSame( 'Table', $data['view_list'][0]['title'] );
	}

	public function test_get_views_dedupes_colliding_stored_slugs(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Colliding Views' );

		update_post_meta(
			$collection_id,
			'cortext_view_config',
			wp_json_encode(
				array(
					'active_view' => 'view-2',
					'view_list'   => array(
						array(
							'slug'  => 'view-2',
							'title' => 'First',
							'view'  => array( 'type' => 'table' ),
						),
						array(
							'slug'  => 'view-2',
							'title' => 'Second',
							'view'  => array( 'type' => 'table' ),
						),
						array(
							'slug'  => '',
							'title' => 'Third',
							'view'  => array( 'type' => 'table' ),
						),
					),
				)
			)
		);

		$data  = $this->get_collection_views( $collection_id )->get_data();
		$slugs = array_column( $data['view_list'], 'slug' );

		$this->assertCount( 3, $slugs );
		$this->assertSame( $slugs, array_values( array_unique( $slugs ) ) );
		$this->assertSame( 'view-2', $data['active_view'] );
	}

	public function test_render_shows_active_named_view_from_block_attributes(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Inline Views', 'publish' );
		$page_id       = $this->create_collection( 'Host Page', 'publish' );

		$view = $this->rendered_view(
			array(
				'collectionId' => $collection_id,
				'view'         => array( 'fields' => array( 'title', 'field-legacy' ) ),
				'active_view'  => 'view-1',
				'view_list'    => array(
					array(
						'slug'  => 'default',
						'title' => 'Table',
						'view'  => array( 'fields' => array( 'title' ) ),
					),
					array(
						'slug'  => 'view-1',
						'title' => 'Wide',
						'view'  => array(
							'type'   => 'grid',
							'fields' => array( 'title', 'field-1' ),
						),
					),
				),
			),
			$page_id
		);

		$this->assertSame( 'grid', $view['type'] );
		$this->assertSame( array( 'title', 'field-1' ), $view['fields'] );
	}

	public function test_render_owner_block_shows_active_view_from_collection_meta(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Owner Views', 'publish' );
		$this->update_collection_views(
			$collection_id,
			array(
				'active_view' => 'view-1',
				'view_list'   => array(
					array(
						'slug'  => 'default',
						'title' => 'Table',
						'view'  => array( 'type' => 'table' ),
					),
					array(
						'slug'  => 'view-1',
						'title' => 'Board',
						'view'  => array(
							'type'   => 'list',
							'fields' => array( 'title', 'field-2' ),
						),
					),
				),
			)
		);

		$view = $this->rendered_view(
			array(
				'collectionId' => $collection_id,
				'view'         => array( 'fields' => array( 'title', 'field-legacy' ) ),
			),
			$collection_id
		);

		$this->assertSame( 'list', $view['type'] );
		$this->assertSame( array( 'title', 'field-2' ), $view['fields'] );
	}

	public function test_render_falls_back_to_single_view_attribute(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$collection_id = $this->create_collection( 'Unmigrated Views', 'publish' );
		$legacy_view   = array( 'fields' => array( 'title', 'field-legacy' ) );

		$this->assertSame(
			$legacy_view,
			$this->rendered_view(
				array(
					'collectionId' => $collection_id,
					'view'         => $legacy_view,
				),
				$collection_id
			)
		);
	}

	public function test_collection_views_require_edit_permission(): void {
		$author_id = $this->create_user( 'author' );
		wp_set_current_user( $author_id );
		$collection_id = $this->create_collection( 'Private Views' );

		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$this->assertSame( 403, $this->get_collection_views( $collection_id )->get_status() );
		$this->assertSame(
			403,
			$this->update_collection_views(
				$collection_id,
				array(
					'active_view' => 'default',
					'view_list'   => array(
						array(
							'slug'  => 'default',
							'title' => 'Table',
							'view'  => array( 'type' => 'table' ),
						),
					),
				)
			)->get_status()
		);
	}

	private function create_collection( string $title, string $status = 'private' ): int {
		$collection_id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => $status,
				'post_title'  => $title,
				'post_author' => get_current_user_id(),
			),
			true
		);

		if ( is_wp_error( $collection_id ) ) {
			$this->fail( $collection_id->get_error_message() );
		}
		( new TraitTaxonomy() )->ensure_mirror_term( (int) $collection_id );
		return (int) $collection_id;
	}

	private function get_collection_views( int $collection_id ) {
		$request = new WP_REST_Request( 'GET', "/cortext/v1/collections/{$collection_id}/views" );

		return rest_do_request( $request );
	}

	private function update_collection_views( int $collection_id, array $body ) {
		$request = new WP_REST_Request( 'PUT', "/cortext/v1/collections/{$collection_id}/views" );
		$request->set_body_params( $body );

		return rest_do_request( $request );
	}

	private function rendered_view( array $attributes, int $post_id ): array {
		$registry = WP_Block_Type_Registry::get_instance();
		if ( ! $registry->is_registered( DataView::BLOCK_NAME ) ) {
			( new DataView() )->register_block();
		}
		$block = new WP_Block(
			array(
				'blockName' => DataView::BLOCK_NAME,
				'attrs'     => $attributes,
			),
			array( 'postId' => $post_id )
		);

		$html = $block->render();
		$this->assertMatchesRegularExpression( '#<script[^>]*>(.*)</script>#s', $html );
		preg_match( '#<script[^>]*>(.*)</script>#s', $html, $matches );

		return json_decode( $matches[1], true )['view'];
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
