<?php
/**
 * Tests for collection REST behaviour that survived the universal-document
 * refactor:
 *
 * - duplication via `DocumentsController` (`/cortext/v1/documents/{id}/duplicate`);
 * - REST writes of the row-detail layout meta on a collection document
 *   (`cortext_detail_layout`).
 *
 * Legacy tests that exercised the dedicated `POST /cortext/v1/collections`
 * route, dynamic row CPT registration, the `crtxt_<slug>` post type,
 * inline-vs-full-page modes, slug uniqueness, and the legacy Collection
 * controller filters no longer apply: collections are just `crtxt_document`
 * posts whose body carries `cortext_fields` meta.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Rest\DocumentsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Collections extends BaseTestCase {

	use InMemoryTermStore;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new DocumentIdentity() )->register();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );
		( new Field() )->register_post_type();
		// `register_collection_meta` exposes `cortext_detail_layout` to REST.
		( new Document() )->register_collection_meta();

		$this->install_in_memory_term_store();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_updates_detail_layout_meta_through_rest(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'reading-list', 'Reading List' );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $collection_id );
		$request->set_body_params(
			array(
				'meta' => array(
					'cortext_detail_layout' => array(
						'fields' => array(
							array(
								'field'   => 'field-12',
								'visible' => false,
							),
							array(
								'field'   => 'created_at',
								'visible' => true,
							),
							// Duplicate `field-12` is collapsed to the first
							// entry by the sanitizer.
							array(
								'field'   => 'field-12',
								'visible' => true,
							),
							// `title` is not in the allowed detail-layout field
							// set, so it should be filtered out.
							array(
								'field'   => 'title',
								'visible' => true,
							),
						),
					),
				),
			)
		);

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'fields' => array(
					array(
						'field'   => 'field-12',
						'visible' => false,
					),
					array(
						'field'   => 'created_at',
						'visible' => true,
					),
				),
			),
			get_post_meta( $collection_id, 'cortext_detail_layout', true )
		);
	}

	public function test_detail_layout_meta_allows_explicit_empty_layout(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'empty-layout', 'Empty Layout' );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $collection_id );
		$request->set_body_params(
			array(
				'meta' => array(
					'cortext_detail_layout' => array(
						'fields' => array(),
					),
				),
			)
		);

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( 'fields' => array() ),
			get_post_meta( $collection_id, 'cortext_detail_layout', true )
		);
	}

	public function test_detail_layout_meta_requires_collection_edit_permission(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'private-layout', 'Private Layout' );

		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $collection_id );
		$request->set_body_params(
			array(
				'meta' => array(
					'cortext_detail_layout' => array(
						'fields' => array(
							array(
								'field'   => 'field-12',
								'visible' => false,
							),
						),
					),
				),
			)
		);

		$response = rest_do_request( $request );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( '', get_post_meta( $collection_id, 'cortext_detail_layout', true ) );
	}

	public function test_duplicate_clones_schema_and_owner(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		$source  = $this->create_collection( 'reports', 'Quarterly reports', $page_id );
		$this->attach_scalar_field( $source, 'Owner', 'text' );
		$this->attach_scalar_field( $source, 'Date', 'date' );

		$response = $this->duplicate_collection( $source );

		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'Copy of Quarterly reports', $data['title'] );
		$this->assertSame( $page_id, $data['parent'] );
		$this->assertSame( array(), $data['skipped_fields'] );

		$new_field_ids = $this->stored_collection_field_ids( (int) $data['id'] );
		// The source's seeded "Title" placeholder is cloned alongside the
		// two scalar fields the test adds.
		$this->assertCount( 3, $new_field_ids );
		$this->assertSame(
			array( 'Copy of Title', 'Copy of Owner', 'Copy of Date' ),
			array_map(
				static fn ( int $id ): string => get_post( $id )->post_title,
				array_map( 'intval', $new_field_ids )
			)
		);
	}

	public function test_duplicate_skips_relation_fields_and_reports_them(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$source      = $this->create_collection( 'links', 'Links' );
		$relation_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Linked',
				'meta_input'  => array( 'type' => 'relation' ),
			)
		);
		add_post_meta( $source, 'cortext_fields', (string) $relation_id );
		$this->attach_scalar_field( $source, 'Label', 'text' );

		$response = $this->duplicate_collection( $source );

		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();
		$this->assertCount( 1, $data['skipped_fields'] );
		$this->assertSame( 'relation_unsupported', $data['skipped_fields'][0]['reason'] );

		$new_field_ids = $this->stored_collection_field_ids( (int) $data['id'] );
		// The seeded "Title" placeholder plus the scalar "Label" field;
		// the relation field is skipped.
		$this->assertCount( 2, $new_field_ids, 'The duplicate should keep the seeded placeholder and the scalar field, skipping the relation.' );
		$this->assertSame(
			array( 'Copy of Title', 'Copy of Label' ),
			array_map(
				static fn ( int $id ): string => get_post( $id )->post_title,
				array_map( 'intval', $new_field_ids )
			)
		);
	}

	public function test_duplicate_remaps_rollup_references_to_cloned_field_ids(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$source    = $this->create_collection( 'metrics', 'Metrics' );
		$target_id = $this->attach_scalar_field( $source, 'Score', 'number' );
		$rollup_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Total',
				'meta_input'  => array(
					'type'                   => 'rollup',
					'rollup_target_field_id' => (string) $target_id,
					'rollup_aggregator'      => 'sum',
				),
			)
		);
		add_post_meta( $source, 'cortext_fields', (string) $rollup_id );

		$response = $this->duplicate_collection( $source );

		$new_field_ids = array_map( 'intval', $this->stored_collection_field_ids( (int) $response->get_data()['id'] ) );
		// Seeded "Title" placeholder, the "Score" target, and the rollup.
		$this->assertCount( 3, $new_field_ids );
		$cloned_target = $new_field_ids[1];
		$cloned_rollup = $new_field_ids[2];

		$this->assertSame(
			(string) $cloned_target,
			(string) get_post_meta( $cloned_rollup, 'rollup_target_field_id', true ),
			'Copied rollups should point at copied fields.'
		);
	}

	public function test_duplicate_returns_404_for_unknown_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->duplicate_collection( 99999 );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_document_not_found', $response->get_data()['code'] );
	}

	private function duplicate_collection( int $collection_id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $collection_id . '/duplicate' );
		return rest_do_request( $request );
	}

	private function create_collection( string $slug, string $title, int $parent = 0 ): int {
		$id = wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'post_name'   => $slug,
				'post_parent' => $parent,
			)
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		// Seed at least one field so `Document::is_collection` returns true
		// and the mirror trait term is created via the meta sync hook.
		$placeholder = $this->attach_scalar_field( (int) $id, 'Title', 'text' );
		// The placeholder is real; the duplicate tests expect to see it
		// in the source's field list. Tests that count fields take this
		// into account explicitly.
		unset( $placeholder );

		return (int) $id;
	}

	private function attach_scalar_field( int $collection_id, string $title, string $type ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => $type ),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		return $field_id;
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

	private function create_page( array $args = array() ): int {
		$defaults = array(
			'post_type'   => Document::POST_TYPE,
			'post_status' => 'private',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	/**
	 * Reads the stored `cortext_fields` entries for a collection directly
	 * from WorDBless's in-memory store so duplicate-test assertions see
	 * the real DB state.
	 *
	 * @param int $collection_id Collection document id.
	 * @return string[]
	 */
	private function stored_collection_field_ids( int $collection_id ): array {
		$store  = \WorDBless\PostMeta::init()->meta[ $collection_id ] ?? array();
		$stored = array();
		foreach ( $store as $row ) {
			if ( isset( $row['meta_key'] ) && 'cortext_fields' === $row['meta_key'] ) {
				$stored[] = (string) maybe_unserialize( $row['meta_value'] );
			}
		}
		return $stored;
	}
}
