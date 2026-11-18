<?php
/**
 * Tests for Cortext\Rest\DocumentMetaFields and DocumentsPostsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Rest\DocumentMetaFields;
use Cortext\Rest\DocumentsPostsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Post_Meta_Fields;
use WP_REST_Posts_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

final class Test_Document_Meta_Fields extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private const LATE_KEY = 'cortext_test_late_key';

	/**
	 * Fixture ids.
	 *
	 * @var array<string, int>
	 */
	private array $ids = array();

	public function set_up(): void {
		parent::set_up();

		$document = new Document();
		$document->register_post_type();
		$document->register_collection_meta();
		( new DocumentIdentity() )->register();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		( new Field() )->register_post_type();
		add_filter( 'rest_pre_insert_' . Document::POST_TYPE, array( $document, 'prepare_meta_updates' ), 10, 2 );
		add_action( 'rest_after_insert_' . Document::POST_TYPE, array( $document, 'assign_trait_from_request' ), 10, 3 );
		add_action( 'rest_after_insert_' . Document::POST_TYPE, array( $document, 'apply_meta_updates' ), 20, 3 );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$this->ids = $this->create_fixture();
		$document->register_field_meta();
		// A non-field key registered after the field keys, so key order in the
		// scoped read has to follow the registry, not "non-field keys first".
		register_post_meta(
			Document::POST_TYPE,
			self::LATE_KEY,
			array(
				'type'         => 'string',
				'single'       => true,
				'show_in_rest' => true,
			)
		);

		wp_set_current_user( $this->create_admin() );
		$this->boot_rest_server();
	}

	public function tear_down(): void {
		unregister_meta_key( 'post', self::LATE_KEY, Document::POST_TYPE );
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_documents_use_the_scoped_controller(): void {
		$controller = get_post_type_object( Document::POST_TYPE )->get_rest_controller();

		$this->assertInstanceOf( DocumentsPostsController::class, $controller );
		$this->assertInstanceOf( WP_REST_Posts_Controller::class, $controller );
	}

	public function test_get_value_matches_the_full_read_trimmed_to_the_collection(): void {
		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'context', 'edit' );
		$scoped = new DocumentMetaFields( Document::POST_TYPE );
		$stock  = new WP_REST_Post_Meta_Fields( Document::POST_TYPE );

		foreach ( array( 'page', 'collection_a', 'collection_b', 'row_a', 'row_a_empty', 'row_b' ) as $name ) {
			$id       = $this->ids[ $name ];
			$expected = self::trim( $stock->get_value( $id, $request ), $id );

			$this->assertSame(
				wp_json_encode( $expected ),
				wp_json_encode( $scoped->get_value( $id, $request ) ),
				"meta differs for {$name}"
			);
		}
	}

	public function test_row_meta_holds_only_its_own_writable_fields(): void {
		$meta = $this->get( $this->ids['row_a'] )->get_data()['meta'];

		$this->assertSame( 'Alpha', $meta[ 'field-' . $this->ids['a_text'] ] );
		$this->assertSame( array( 'red', 'blue' ), $meta[ 'field-' . $this->ids['a_multi'] ] );
		$this->assertSame( array( $this->ids['row_b'] ), $meta[ 'field-' . $this->ids['a_relation'] ] );
		$this->assertArrayNotHasKey( 'field-' . $this->ids['a_rollup'], $meta );
		$this->assertArrayNotHasKey( 'field-' . $this->ids['a_formula'], $meta );
		$this->assertArrayNotHasKey( 'field-' . $this->ids['b_text'], $meta );
		$this->assertArrayHasKey( 'cortext_fields', $meta );
	}

	/**
	 * @dataProvider provide_get_requests
	 *
	 * @param string               $target Fixture name, or `list`.
	 * @param array<string, mixed> $params Query params. `cortext_trait` names a fixture.
	 */
	public function test_rest_response_is_byte_identical_to_the_stock_controller( string $target, array $params ): void {
		if ( isset( $params['cortext_trait'] ) ) {
			$params['cortext_trait'] = $this->ids[ $params['cortext_trait'] ];
		}
		$route = 'list' === $target ? '/wp/v2/crtxt_documents' : '/wp/v2/crtxt_documents/' . $this->ids[ $target ];
		$run   = static function () use ( $route, $params ): string {
			$request = new WP_REST_Request( 'GET', $route );
			$request->set_query_params( $params );
			$response = rest_do_request( $request );
			return (string) wp_json_encode( rest_get_server()->response_to_data( $response, false ) );
		};

		$scoped = $run();
		$this->use_stock_controller_with_trim();
		$stock = $run();

		$this->assertStringContainsString( '"meta"', $scoped );
		$this->assertSame( $stock, $scoped );
	}

	/**
	 * @return array<string, array{0: string, 1: array<string, mixed>}>
	 */
	public static function provide_get_requests(): array {
		$list = array(
			'context'  => 'edit',
			'status'   => array( 'draft', 'private', 'publish' ),
			'per_page' => 100,
		);
		return array(
			'page'                 => array( 'page', array( 'context' => 'edit' ) ),
			'collection'           => array( 'collection_a', array( 'context' => 'edit' ) ),
			'row'                  => array( 'row_a', array( 'context' => 'edit' ) ),
			'row with no values'   => array( 'row_a_empty', array( 'context' => 'edit' ) ),
			'row in view context'  => array( 'row_a', array() ),
			'row with _fields'     => array(
				'row_a',
				array(
					'context' => 'edit',
					'_fields' => 'id,meta',
				),
			),
			'list'                 => array( 'list', $list ),
			'list with _fields'    => array( 'list', array_merge( $list, array( '_fields' => 'id,parent,slug,title,meta' ) ) ),
			'rows of a collection' => array( 'list', array_merge( $list, array( 'cortext_trait' => 'collection_a' ) ) ),
		);
	}

	public function test_schema_lists_every_registered_field(): void {
		$scoped = ( new DocumentMetaFields( Document::POST_TYPE ) )->get_field_schema();
		$stock  = ( new WP_REST_Post_Meta_Fields( Document::POST_TYPE ) )->get_field_schema();

		unset( $scoped['arg_options'], $stock['arg_options'] );
		$this->assertSame( wp_json_encode( $stock ), wp_json_encode( $scoped ) );
		$this->assertArrayHasKey( 'field-' . $this->ids['b_text'], $scoped['properties'] );
	}

	public function test_fields_registered_after_the_first_read_show_up(): void {
		$meta_fields = new DocumentMetaFields( Document::POST_TYPE );
		$request     = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$meta_fields->get_value( $this->ids['row_a'], $request );

		$field_id = $this->create_field( 'text' );
		add_post_meta( $this->ids['collection_a'], 'cortext_fields', (string) $field_id );
		update_post_meta( $this->ids['row_a'], 'field-' . $field_id, 'Late' );
		register_post_meta(
			Document::POST_TYPE,
			'field-' . $field_id,
			array(
				'type'         => 'string',
				'single'       => true,
				'show_in_rest' => true,
			)
		);

		$this->assertSame( 'Late', $meta_fields->get_value( $this->ids['row_a'], $request )[ 'field-' . $field_id ] );
		$this->assertArrayHasKey( 'field-' . $field_id, $meta_fields->get_field_schema()['properties'] );

		unregister_meta_key( 'post', 'field-' . $field_id, Document::POST_TYPE );
		$this->assertArrayNotHasKey( 'field-' . $field_id, $meta_fields->get_value( $this->ids['row_a'], $request ) );
	}

	public function test_null_deletes_a_single_field(): void {
		$response = $this->put( $this->ids['row_a'], array( 'field-' . $this->ids['a_text'] => null ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '', $response->get_data()['meta'][ 'field-' . $this->ids['a_text'] ] );
		$this->assertSame( array(), get_post_meta( $this->ids['row_a'], 'field-' . $this->ids['a_text'], false ) );
	}

	public function test_multiselect_values_are_replaced_and_cleared(): void {
		$key = 'field-' . $this->ids['a_multi'];

		$replaced = $this->put( $this->ids['row_a'], array( $key => array( 'green' ) ) );
		$this->assertSame( 200, $replaced->get_status() );
		$this->assertSame( array( 'green' ), $replaced->get_data()['meta'][ $key ] );
		$this->assertSame( array( 'green' ), get_post_meta( $this->ids['row_a'], $key, false ) );

		$cleared = $this->put( $this->ids['row_a'], array( $key => array() ) );
		$this->assertSame( 200, $cleared->get_status() );
		$this->assertSame( array(), $cleared->get_data()['meta'][ $key ] );
	}

	public function test_relation_writes_still_validate_targets(): void {
		$targets  = array( $this->ids['row_b'], $this->ids['page'] );
		$response = $this->put( $this->ids['row_a'], array( 'field-' . $this->ids['a_relation'] => $targets ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_relation_target_row_invalid', $response->as_error()->get_error_code() );
	}

	public function test_foreign_field_writes_are_rejected(): void {
		$response = $this->put( $this->ids['row_a'], array( 'field-' . $this->ids['b_text'] => 'nope' ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_field_not_in_collection', $response->as_error()->get_error_code() );
	}

	public function test_creating_a_row_keeps_its_field_meta(): void {
		$key     = 'field-' . $this->ids['a_text'];
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_body_params(
			array(
				'title'         => 'Prefilled',
				'status'        => 'private',
				'cortext_trait' => $this->ids['collection_a'],
				'meta'          => array( $key => 'Prefilled value' ),
			)
		);
		$response = rest_do_request( $request );

		$this->assertSame( 201, $response->get_status() );
		$row_id = (int) $response->get_data()['id'];
		$this->assertSame( 'Prefilled value', get_post_meta( $row_id, $key, true ) );
		$this->assertSame( 'Prefilled value', $response->get_data()['meta'][ $key ] );
		$this->assertArrayNotHasKey( 'field-' . $this->ids['b_text'], $response->get_data()['meta'] );
	}

	/**
	 * Main's trim, kept here as the reference the scoped read must match.
	 *
	 * @param array<string, mixed> $meta Full meta read.
	 * @param int                  $id   Document id.
	 * @return array<string, mixed>
	 */
	private static function trim( array $meta, int $id ): array {
		$allowed = array_flip( Document::rest_field_meta_keys( get_post( $id ) ) );
		foreach ( array_keys( $meta ) as $key ) {
			if ( str_starts_with( (string) $key, 'field-' ) && ! isset( $allowed[ $key ] ) ) {
				unset( $meta[ $key ] );
			}
		}
		return $meta;
	}

	/**
	 * Puts the post type back on core's controller with main's response trim.
	 */
	private function use_stock_controller_with_trim(): void {
		$type                        = get_post_type_object( Document::POST_TYPE );
		$type->rest_controller_class = WP_REST_Posts_Controller::class;
		$type->rest_controller       = null;
		add_filter(
			'rest_prepare_' . Document::POST_TYPE,
			static function ( WP_REST_Response $response, $post ): WP_REST_Response {
				$data = $response->get_data();
				if ( isset( $data['meta'] ) && is_array( $data['meta'] ) ) {
					$data['meta'] = self::trim( $data['meta'], (int) $post->ID );
					$response->set_data( $data );
				}
				return $response;
			},
			10,
			2
		);
		$this->boot_rest_server();
	}

	private function boot_rest_server(): void {
		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		do_action( 'rest_api_init', $GLOBALS['wp_rest_server'] );
	}

	private function get( int $id ): WP_REST_Response {
		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents/' . $id );
		$request->set_param( 'context', 'edit' );
		return rest_do_request( $request );
	}

	/**
	 * @param int                  $id   Document id.
	 * @param array<string, mixed> $meta Meta payload.
	 */
	private function put( int $id, array $meta ): WP_REST_Response {
		$request = new WP_REST_Request( 'PUT', '/wp/v2/crtxt_documents/' . $id );
		$request->set_body_params( array( 'meta' => $meta ) );
		return rest_do_request( $request );
	}

	/**
	 * Two collections. Collection A has one field of each kind that matters for
	 * reads and writes. Collection B's field is foreign to A's rows.
	 *
	 * @return array<string, int>
	 */
	private function create_fixture(): array {
		$ids                 = array();
		$ids['page']         = $this->create_document( 'Page' );
		$ids['collection_b'] = $this->create_document( 'Collection B' );
		$ids['b_text']       = $this->create_field( 'text' );
		add_post_meta( $ids['collection_b'], 'cortext_fields', (string) $ids['b_text'] );

		$ids['collection_a'] = $this->create_document( 'Collection A' );
		foreach ( array( 'text', 'number', 'checkbox', 'multiselect', 'relation', 'rollup', 'formula' ) as $type ) {
			$key         = 'a_' . ( 'multiselect' === $type ? 'multi' : $type );
			$ids[ $key ] = $this->create_field( $type );
			add_post_meta( $ids['collection_a'], 'cortext_fields', (string) $ids[ $key ] );
		}
		$reverse = $this->create_field( 'relation' );
		add_post_meta( $ids['collection_b'], 'cortext_fields', (string) $reverse );
		update_post_meta( $ids['a_relation'], 'related_collection_id', (string) $ids['collection_b'] );
		update_post_meta( $ids['a_relation'], 'relation_reverse_field_id', (string) $reverse );
		update_post_meta( $reverse, 'related_collection_id', (string) $ids['collection_a'] );
		update_post_meta( $reverse, 'relation_reverse_field_id', (string) $ids['a_relation'] );

		$ids['row_b'] = $this->create_row( $ids['collection_b'], 'Row B' );
		update_post_meta( $ids['row_b'], 'field-' . $ids['b_text'], 'Beta' );

		$ids['row_a_empty'] = $this->create_row( $ids['collection_a'], 'Row A empty' );
		$ids['row_a']       = $this->create_row( $ids['collection_a'], 'Row A' );
		update_post_meta( $ids['row_a'], 'field-' . $ids['a_text'], 'Alpha' );
		update_post_meta( $ids['row_a'], 'field-' . $ids['a_number'], '42' );
		update_post_meta( $ids['row_a'], 'field-' . $ids['a_checkbox'], '1' );
		add_post_meta( $ids['row_a'], 'field-' . $ids['a_multi'], 'red' );
		add_post_meta( $ids['row_a'], 'field-' . $ids['a_multi'], 'blue' );
		add_post_meta( $ids['row_a'], 'field-' . $ids['a_relation'], (string) $ids['row_b'] );
		update_post_meta( $ids['row_a'], 'field-' . $ids['a_rollup'], '7' );
		update_post_meta( $ids['row_a'], 'field-' . $ids['a_formula'], '9' );
		update_post_meta( $ids['row_a'], 'field-' . $ids['b_text'], 'Stray' );

		return $ids;
	}

	private function create_document( string $title ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
			)
		);
		$this->assertGreaterThan( 0, $id );
		return $id;
	}

	private function create_row( int $collection_id, string $title ): int {
		$id = $this->create_document( $title );
		wp_set_object_terms( $id, array( TraitTaxonomy::term_id_for_trait( $collection_id ) ), TraitTaxonomy::TAXONOMY );
		return $id;
	}

	private function create_field( string $type ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => ucfirst( $type ) . ' field',
				'meta_input'  => array( 'type' => $type ),
			)
		);
		$this->assertGreaterThan( 0, $id );
		return $id;
	}

	private function create_admin(): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_', false ),
				'user_pass'  => 'password',
				'role'       => 'administrator',
			)
		);
	}
}
