<?php
/**
 * Tests for collection REST behavior: create and duplicate routes on
 * `DocumentsController`, plus query and pre-insert filters on `Collection`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\PostType\Page;
use Cortext\Rest\DocumentsController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Collections extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Page() )->register_post_type();
		$collection = new Collection();
		$collection->register_post_type();
		$collection->register_rest_filters();
		( new Field() )->register_post_type();
		// Register the save hook that gives a newly created collection its row
		// CPT during the same request.
		( new CollectionEntries() )->register();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_creates_collection_and_registers_row_cpt_from_title(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title' => 'Project Tasks',
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$data          = $response->get_data();
		$collection_id = (int) $data['id'];

		$this->assertSame( 'project-tasks', get_post_meta( $collection_id, 'slug', true ) );
		$this->assertTrue( post_type_exists( 'crtxt_project-tasks' ) );
		$this->assertSame( 'Project Tasks', get_post( $collection_id )->post_title );
		$this->assertSame( array(), get_post_meta( $collection_id, 'fields', false ) );
	}

	public function test_auto_suffixes_conflicting_slug_within_cpt_limit(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Existing',
				'meta_input'  => array( 'slug' => 'abcdefghijklmn' ),
			)
		);
		register_post_type( 'crtxt_abcdefghijklmn' );

		$response = $this->create_collection(
			array(
				'title' => 'abcdefghijklmnop',
			)
		);

		$data          = $response->get_data();
		$collection_id = (int) $data['id'];
		$slug          = (string) get_post_meta( $collection_id, 'slug', true );

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'abcdefghijkl-2', $slug );
		$this->assertLessThanOrEqual(
			CollectionEntries::MAX_CPT_LEN,
			strlen( CollectionEntries::CPT_PREFIX . $slug )
		);
		$this->assertTrue( post_type_exists( 'crtxt_abcdefghijkl-2' ) );
	}

	public function test_ignores_slug_and_fields_request_params(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title'  => 'Reading List',
				'slug'   => 'ignored',
				'fields' => array( 'Ignored Field' ),
			)
		);

		$data          = $response->get_data();
		$collection_id = (int) $data['id'];

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'reading-list', get_post_meta( $collection_id, 'slug', true ) );
		$this->assertSame( array(), get_post_meta( $collection_id, 'fields', false ) );
		$this->assertTrue( post_type_exists( 'crtxt_reading-list' ) );
	}

	public function test_create_uses_meta_slug_from_request_when_valid(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title' => 'Reading List',
				'meta'  => array( 'slug' => 'reads' ),
			)
		);

		$data          = $response->get_data();
		$collection_id = (int) $data['id'];

		$this->assertSame( 201, $response->get_status() );
		// The client picked the slug; the row CPT registers under it during
		// save_post and the stored slug matches.
		$this->assertSame( 'reads', get_post_meta( $collection_id, 'slug', true ) );
		$this->assertTrue( post_type_exists( 'crtxt_reads' ) );
	}

	public function test_create_rejects_meta_slug_when_taken(): void {
		wp_set_current_user( $this->create_user( 'author' ) );
		$this->create_collection(
			array(
				'title' => 'First',
				'meta'  => array( 'slug' => 'overlap' ),
			)
		);

		$response = $this->create_collection(
			array(
				'title' => 'Second',
				'meta'  => array( 'slug' => 'overlap' ),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_collection_slug_taken',
			$response->get_data()['code']
		);
	}

	public function test_update_ignores_meta_slug_overwrite(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$create        = $this->create_collection(
			array(
				'title' => 'Reading List',
			)
		);
		$collection_id = (int) $create->get_data()['id'];
		$original_slug = (string) get_post_meta( $collection_id, 'slug', true );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_collections/' . $collection_id );
		$request->set_body_params(
			array( 'meta' => array( 'slug' => 'hijacked' ) )
		);
		$response = rest_do_request( $request );

		// `validate_pre_insert` drops `meta.slug` from the request before WP
		// REST reaches the meta API, so the update succeeds and the stored
		// slug stays put. The row CPT keeps pointing at the original value.
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $original_slug, get_post_meta( $collection_id, 'slug', true ) );
		$this->assertTrue( post_type_exists( 'crtxt_' . $original_slug ) );
	}

	public function test_updates_detail_layout_meta_through_rest(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$create        = $this->create_collection(
			array(
				'title' => 'Reading List',
			)
		);
		$collection_id = (int) $create->get_data()['id'];

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_collections/' . $collection_id );
		$request->set_body_params(
			array(
				'meta' => array(
					Collection::DETAIL_LAYOUT_META_KEY => array(
						'fields' => array(
							array(
								'field'   => 'field-12',
								'visible' => false,
							),
							array(
								'field'   => 'created_at',
								'visible' => true,
							),
							array(
								'field'   => 'field-12',
								'visible' => true,
							),
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
			get_post_meta( $collection_id, Collection::DETAIL_LAYOUT_META_KEY, true )
		);
	}

	public function test_detail_layout_meta_allows_explicit_empty_layout(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$create        = $this->create_collection(
			array(
				'title' => 'Empty Layout',
			)
		);
		$collection_id = (int) $create->get_data()['id'];

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_collections/' . $collection_id );
		$request->set_body_params(
			array(
				'meta' => array(
					Collection::DETAIL_LAYOUT_META_KEY => array(
						'fields' => array(),
					),
				),
			)
		);

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array( 'fields' => array() ),
			get_post_meta( $collection_id, Collection::DETAIL_LAYOUT_META_KEY, true )
		);
	}

	public function test_detail_layout_meta_requires_collection_edit_permission(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$create        = $this->create_collection( array( 'title' => 'Private Layout' ) );
		$collection_id = (int) $create->get_data()['id'];

		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_collections/' . $collection_id );
		$request->set_body_params(
			array(
				'meta' => array(
					Collection::DETAIL_LAYOUT_META_KEY => array(
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
		$this->assertSame( '', get_post_meta( $collection_id, Collection::DETAIL_LAYOUT_META_KEY, true ) );
	}

	public function test_auto_suffixes_reserved_slug(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title' => 'Page',
			)
		);

		$data = $response->get_data();

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'page-2', get_post_meta( (int) $data['id'], 'slug', true ) );
		$this->assertTrue( post_type_exists( 'crtxt_page-2' ) );
	}

	public function test_normalizes_non_latin_slug_for_post_type_name(): void {
		$slug = Collection::unique_slug( '你好' );

		$this->assertSame( 'e4bda0e5a5bd', $slug );
		$this->assertLessThanOrEqual(
			CollectionEntries::MAX_CPT_LEN,
			strlen( CollectionEntries::CPT_PREFIX . $slug )
		);
		$this->assertSame( CollectionEntries::CPT_PREFIX . $slug, sanitize_key( CollectionEntries::CPT_PREFIX . $slug ) );
	}

	public function test_rejects_empty_title(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection(
			array(
				'title' => ' ',
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->create_collection(
			array(
				'title' => 'People',
			)
		);

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_defaults_workspace_mode_to_full_page_when_absent(): void {
		wp_set_current_user( $this->create_user( 'author' ) );

		$response = $this->create_collection( array( 'title' => 'Default mode' ) );

		$this->assertSame( 201, $response->get_status() );

		$data = $response->get_data();
		$this->assertSame( 0, $data['parent'] );
		$this->assertSame(
			Collection::MODE_FULL_PAGE,
			get_post_meta( (int) $data['id'], Collection::MODE_META_KEY, true )
		);
		$this->assertSame(
			'',
			(string) get_post_meta( (int) $data['id'], Collection::INLINE_OWNER_META_KEY, true ),
			'Full-page collections without a parent should not store an inline owner.'
		);
		$this->assertSame( 0, (int) get_post( (int) $data['id'] )->post_parent );
	}

	public function test_creates_inline_collection_with_parent_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();

		$response = $this->create_collection(
			array(
				'title'  => 'Inline tasks',
				'mode'   => Collection::MODE_INLINE,
				'parent' => $page_id,
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$data          = $response->get_data();
		$collection_id = (int) $data['id'];
		$this->assertSame( 0, $data['parent'], 'Inline collections report parent=0 even when they have an owner document.' );
		$this->assertSame(
			Collection::MODE_INLINE,
			get_post_meta( $collection_id, Collection::MODE_META_KEY, true )
		);
		$this->assertSame(
			$page_id,
			(int) get_post_meta( $collection_id, Collection::INLINE_OWNER_META_KEY, true ),
			'Inline collections record the owner page in meta, not post_parent.'
		);
		$this->assertSame( 0, (int) get_post( $collection_id )->post_parent );
	}

	public function test_creates_full_page_collection_nested_under_page(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();

		$response = $this->create_collection(
			array(
				'title'  => 'Books',
				'mode'   => Collection::MODE_FULL_PAGE,
				'parent' => $page_id,
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$data          = $response->get_data();
		$collection_id = (int) $data['id'];
		$this->assertSame( $page_id, $data['parent'] );
		$this->assertSame(
			Collection::MODE_FULL_PAGE,
			get_post_meta( $collection_id, Collection::MODE_META_KEY, true )
		);
		$this->assertSame(
			$page_id,
			(int) get_post( $collection_id )->post_parent,
			'Nested full-page collections use post_parent for the sidebar tree.'
		);
		$this->assertSame(
			'',
			(string) get_post_meta( $collection_id, Collection::INLINE_OWNER_META_KEY, true ),
			'Full-page collections never store an inline owner.'
		);
	}

	public function test_rejects_inline_collection_without_parent(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->create_collection(
			array(
				'title' => 'Orphan inline',
				'mode'  => Collection::MODE_INLINE,
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_collection_inline_parent_required',
			$response->get_data()['code']
		);
	}

	public function test_rejects_collection_with_nonexistent_parent(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->create_collection(
			array(
				'title'  => 'Inline against ghost',
				'mode'   => Collection::MODE_INLINE,
				'parent' => 999999,
			)
		);

		$this->assertSame( 400, $response->get_status() );
		// Core validates `parent` before our pre-insert filter runs. A missing
		// parent therefore comes back as `rest_post_invalid_id`, not our
		// collection-specific code.
		$this->assertSame( 'rest_post_invalid_id', $response->get_data()['code'] );
	}

	public function test_rejects_when_user_cannot_edit_parent(): void {
		$owner_id = $this->create_user( 'administrator' );
		wp_set_current_user( $owner_id );
		$page_id = $this->create_page(
			array(
				'post_author' => $owner_id,
				'post_status' => 'private',
			)
		);

		wp_set_current_user( $this->create_user( 'contributor' ) );

		$response = $this->create_collection(
			array(
				'title'  => 'Inline I cannot host',
				// Contributors cannot create private collections. Use draft so
				// this test reaches the parent permission check.
				'status' => 'draft',
				'mode'   => Collection::MODE_INLINE,
				'parent' => $page_id,
			)
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame(
			'cortext_collection_parent_forbidden',
			$response->get_data()['code']
		);
	}

	public function test_rejects_non_document_parent(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'A regular post',
			)
		);

		$response = $this->create_collection(
			array(
				'title'  => 'Bad parent',
				'mode'   => Collection::MODE_FULL_PAGE,
				'parent' => $post_id,
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_collection_parent_invalid_type',
			$response->get_data()['code']
		);
	}

	public function test_rejects_collection_parent_even_though_collections_are_documents(): void {
		// Collections opt into the document trait now. Without an explicit
		// guard, `validate_parent_document` would let this through and a
		// user could nest a collection under another collection. Reject it.
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$parent_collection_response = $this->create_collection(
			array(
				'title' => 'Parent collection',
				'mode'  => Collection::MODE_FULL_PAGE,
			)
		);
		$this->assertSame( 201, $parent_collection_response->get_status() );
		$parent_collection_id = (int) $parent_collection_response->get_data()['id'];

		$response = $this->create_collection(
			array(
				'title'  => 'Child collection',
				'mode'   => Collection::MODE_FULL_PAGE,
				'parent' => $parent_collection_id,
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_collection_parent_invalid_type',
			$response->get_data()['code']
		);
	}

	public function test_query_filter_for_full_page_matches_explicit_full_page_or_missing_meta(): void {
		// Missing mode means `full_page`, so existing collections stay in the
		// sidebar after the inline/full-page split. The OR clause covers that
		// fallback and excludes explicit inline collections.
		$filtered = $this->filter_query_for_workspace_mode( Collection::MODE_FULL_PAGE );

		$this->assertArrayHasKey( 'meta_query', $filtered );
		$this->assertCount( 1, $filtered['meta_query'] );

		$clause = $filtered['meta_query'][0];
		$this->assertSame( 'OR', $clause['relation'] );
		$this->assertSame(
			array(
				'key'     => Collection::MODE_META_KEY,
				'value'   => Collection::MODE_FULL_PAGE,
				'compare' => '=',
			),
			$clause[0]
		);
		$this->assertSame(
			array(
				'key'     => Collection::MODE_META_KEY,
				'compare' => 'NOT EXISTS',
			),
			$clause[1]
		);
	}

	public function test_query_filter_for_inline_matches_explicit_inline_only(): void {
		$filtered = $this->filter_query_for_workspace_mode( Collection::MODE_INLINE );

		$this->assertArrayHasKey( 'meta_query', $filtered );
		$this->assertSame(
			array(
				array(
					'key'     => Collection::MODE_META_KEY,
					'value'   => Collection::MODE_INLINE,
					'compare' => '=',
				),
			),
			$filtered['meta_query']
		);
	}

	public function test_query_filter_is_no_op_without_workspace_mode_param(): void {
		$controller = new Collection();
		$request    = new \WP_REST_Request( 'GET', '/wp/v2/' . Collection::POST_TYPE . 's' );
		$existing   = array( 'meta_query' => array( array( 'key' => 'something_else' ) ) );

		$filtered = $controller->filter_collection_query( $existing, $request );

		$this->assertSame( $existing, $filtered, 'The filter passes args through when workspace_mode is absent.' );
	}

	public function test_pre_insert_filter_rejects_setting_parent_on_inline_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();

		$inline_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Inline locked',
				'meta_input'  => array(
					'slug'                            => 'inline-locked',
					Collection::MODE_META_KEY         => Collection::MODE_INLINE,
					Collection::INLINE_OWNER_META_KEY => $page_id,
				),
			)
		);
		$this->assertIsInt( $inline_id );

		$controller = new Collection();
		$request    = new WP_REST_Request(
			'PATCH',
			'/wp/v2/' . Collection::POST_TYPE . 's/' . $inline_id
		);
		$prepared              = new \stdClass();
		$prepared->ID          = (int) $inline_id;
		$prepared->post_parent = $page_id;

		$result = $controller->validate_pre_insert( $prepared, $request );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'cortext_collection_inline_parent_locked', $result->get_error_code() );
	}

	public function test_pre_insert_filter_allows_setting_parent_on_full_page_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_page();

		$full_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Full page movable',
				'meta_input'  => array(
					'slug'                    => 'full-movable',
					Collection::MODE_META_KEY => Collection::MODE_FULL_PAGE,
				),
			)
		);
		$this->assertIsInt( $full_id );

		$controller = new Collection();
		$request    = new WP_REST_Request(
			'PATCH',
			'/wp/v2/' . Collection::POST_TYPE . 's/' . $full_id
		);
		$prepared              = new \stdClass();
		$prepared->ID          = (int) $full_id;
		$prepared->post_parent = $page_id;

		$result = $controller->validate_pre_insert( $prepared, $request );

		$this->assertNotInstanceOf( \WP_Error::class, $result );
		$this->assertSame( $prepared, $result );
	}

	public function test_pre_insert_filter_rejects_parent_change_to_non_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Regular post',
			)
		);

		$full_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Full page',
				'meta_input'  => array(
					'slug'                    => 'full-bad-parent',
					Collection::MODE_META_KEY => Collection::MODE_FULL_PAGE,
				),
			)
		);

		$controller = new Collection();
		$request    = new WP_REST_Request( 'PATCH', '/wp/v2/' . Collection::POST_TYPE . 's/' . $full_id );
		$prepared              = new \stdClass();
		$prepared->ID          = (int) $full_id;
		$prepared->post_parent = $post_id;

		$result = $controller->validate_pre_insert( $prepared, $request );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'cortext_collection_parent_invalid_type', $result->get_error_code() );
	}

	public function test_duplicate_clones_schema_with_new_slug_and_owner(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$page_id = $this->create_page();
		$source  = $this->create_full_page_collection(
			'reports',
			'Quarterly reports',
			array( 'post_parent' => $page_id )
		);
		$this->attach_scalar_field( $source, 'Owner', 'text' );
		$this->attach_scalar_field( $source, 'Date', 'date' );

		$response = $this->duplicate_collection( $source );

		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'Copy of Quarterly reports', $data['title'] );
		$this->assertNotSame( 'reports', $data['slug'] );
		$this->assertSame( $page_id, $data['parent'] );
		$this->assertSame( Collection::MODE_FULL_PAGE, $data['mode'] );
		$this->assertSame( array(), $data['skipped_fields'] );

		$new_field_ids = array_map( 'intval', get_post_meta( $data['id'], 'fields', false ) );
		$this->assertCount( 2, $new_field_ids );
		$this->assertSame(
			array( 'Copy of Owner', 'Copy of Date' ),
			array_map(
				static fn ( int $id ): string => get_post( $id )->post_title,
				$new_field_ids
			)
		);
	}

	public function test_duplicate_does_not_copy_rows(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$source = $this->create_full_page_collection( 'archive', 'Archive' );
		( new CollectionEntries() )->register_for_collection( get_post( $source ) );

		wp_insert_post(
			array(
				'post_type'   => CollectionEntries::CPT_PREFIX . 'archive',
				'post_status' => 'private',
				'post_title'  => 'Row 1',
			)
		);

		$response = $this->duplicate_collection( $source );

		$this->assertSame( 201, $response->get_status() );
		$new_slug = $response->get_data()['slug'];

		( new CollectionEntries() )->register_for_collection( get_post( $response->get_data()['id'] ) );
		$row_ids = get_posts(
			array(
				'post_type'      => CollectionEntries::CPT_PREFIX . $new_slug,
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);
		$this->assertSame( array(), $row_ids, 'Duplicating a collection should leave rows behind.' );
	}

	public function test_duplicate_skips_relation_fields_and_reports_them(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$source = $this->create_full_page_collection( 'links', 'Links' );
		$relation_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Linked',
				'meta_input'  => array( 'type' => 'relation' ),
			)
		);
		add_post_meta( $source, 'fields', (string) $relation_id );
		$this->attach_scalar_field( $source, 'Label', 'text' );

		$response = $this->duplicate_collection( $source );

		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();
		$this->assertCount( 1, $data['skipped_fields'] );
		$this->assertSame( 'relation_unsupported', $data['skipped_fields'][0]['reason'] );

		$new_field_ids = array_map( 'intval', get_post_meta( $data['id'], 'fields', false ) );
		$this->assertCount( 1, $new_field_ids, 'The duplicate should keep the scalar field and skip the relation.' );
		$this->assertSame( 'Copy of Label', get_post( $new_field_ids[0] )->post_title );
	}

	public function test_duplicate_remaps_rollup_references_to_cloned_field_ids(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$source     = $this->create_full_page_collection( 'metrics', 'Metrics' );
		$target_id  = $this->attach_scalar_field( $source, 'Score', 'number' );
		$rollup_id  = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Total',
				'meta_input'  => array(
					'type'                     => 'rollup',
					'rollup_target_field_id'   => (string) $target_id,
					'rollup_aggregator'        => 'sum',
				),
			)
		);
		add_post_meta( $source, 'fields', (string) $rollup_id );

		$response = $this->duplicate_collection( $source );

		$new_field_ids = array_map( 'intval', get_post_meta( $response->get_data()['id'], 'fields', false ) );
		$cloned_target = $new_field_ids[0];
		$cloned_rollup = $new_field_ids[1];

		$this->assertSame(
			(string) $cloned_target,
			(string) get_post_meta( $cloned_rollup, 'rollup_target_field_id', true ),
			'Copied rollups should point at copied fields.'
		);
	}

	public function test_duplicate_rejects_inline_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id   = $this->create_page();
		$inline_id = wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Inline',
				'meta_input'  => array(
					'slug'                            => 'inline-only',
					Collection::MODE_META_KEY         => Collection::MODE_INLINE,
					Collection::INLINE_OWNER_META_KEY => $page_id,
				),
			)
		);

		$response = $this->duplicate_collection( (int) $inline_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_collection_duplicate_inline_unsupported',
			$response->get_data()['code']
		);
	}

	public function test_duplicate_returns_404_for_unknown_id(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->duplicate_collection( 99999 );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'cortext_document_not_found', $response->get_data()['code'] );
	}

	public function test_query_filter_preserves_existing_meta_query_clauses(): void {
		$controller = new Collection();
		$request    = new \WP_REST_Request( 'GET', '/wp/v2/' . Collection::POST_TYPE . 's' );
		$request->set_param( 'workspace_mode', Collection::MODE_FULL_PAGE );

		$existing = array(
			'meta_query' => array(
				array(
					'key'     => 'unrelated',
					'value'   => 'thing',
					'compare' => '=',
				),
			),
		);

		$filtered = $controller->filter_collection_query( $existing, $request );

		$this->assertCount( 2, $filtered['meta_query'] );
		$this->assertSame(
			array(
				'key'     => 'unrelated',
				'value'   => 'thing',
				'compare' => '=',
			),
			$filtered['meta_query'][0]
		);
	}

	private function create_collection( array $body ) {
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_collections' );
		$request->set_body_params(
			array_merge(
				array( 'status' => 'private' ),
				$body
			)
		);

		return rest_do_request( $request );
	}

	private function duplicate_collection( int $collection_id ) {
		$request = new WP_REST_Request( 'POST', '/cortext/v1/documents/' . $collection_id . '/duplicate' );
		return rest_do_request( $request );
	}

	private function create_full_page_collection( string $slug, string $title, array $overrides = array() ): int {
		$id = wp_insert_post(
			array_merge(
				array(
					'post_type'   => Collection::POST_TYPE,
					'post_status' => 'private',
					'post_title'  => $title,
					'meta_input'  => array(
						'slug'                    => $slug,
						Collection::MODE_META_KEY => Collection::MODE_FULL_PAGE,
					),
				),
				$overrides
			)
		);
		$this->assertIsInt( $id );
		return (int) $id;
	}

	private function attach_scalar_field( int $collection_id, string $title, string $type ): int {
		$field_id = wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => $type ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		return (int) $field_id;
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
			'post_type'   => Page::POST_TYPE,
			'post_status' => 'private',
			'post_title'  => 'Test page ' . wp_generate_uuid4(),
		);

		$id = wp_insert_post( array_merge( $defaults, $args ) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );

		return (int) $id;
	}

	/**
	 * Runs the collection list-query filter for one workspace_mode value.
	 * The sidebar and DataView picker depend on this behavior, so the test
	 * checks it directly without going through WP_Query.
	 *
	 * @param string $mode Requested workspace_mode.
	 *
	 * @return array<string, mixed>
	 */
	private function filter_query_for_workspace_mode( string $mode ): array {
		$collection = new Collection();
		$request    = new WP_REST_Request( 'GET', '/wp/v2/' . Collection::POST_TYPE . 's' );
		$request->set_param( 'workspace_mode', $mode );

		return $collection->filter_collection_query( array(), $request );
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
