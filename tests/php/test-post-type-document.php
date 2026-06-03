<?php
/**
 * Tests for Cortext\PostType\Document.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Response;

final class Test_Post_Type_Document extends BaseTestCase {

	use InMemoryPostsQuery;
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

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_post_type_constant_matches_expected_slug(): void {
		$this->assertSame( 'crtxt_document', Document::POST_TYPE );
	}

	public function test_register_post_type_registers_crtxt_document(): void {
		$this->assertTrue( post_type_exists( Document::POST_TYPE ) );
	}

	public function test_registered_post_type_uses_shell_for_editing_ui(): void {
		$object = get_post_type_object( Document::POST_TYPE );

		$this->assertNotNull( $object );
		$this->assertFalse( $object->show_ui, 'crtxt_document editing belongs in the Cortext shell, not in core admin screens.' );
		$this->assertFalse( $object->show_in_menu, 'show_in_menu stays false because navigation lives in the Cortext shell.' );
	}

	public function test_registered_post_type_supports_cortext_document_capability(): void {
		$this->assertTrue( post_type_supports( Document::POST_TYPE, 'cortext-document' ) );
	}

	public function test_is_collection_returns_false_for_plain_document(): void {
		$page_id = $this->create_document();

		$this->assertFalse( Document::is_collection( $page_id ) );
	}

	public function test_is_collection_returns_true_when_mirror_term_exists(): void {
		$collection_id = $this->create_collection();

		// The mirror term is the collection's identity.
		$this->assertGreaterThan( 0, TraitTaxonomy::term_id_for_trait( $collection_id ) );
		$this->assertTrue( Document::is_collection( $collection_id ) );
	}

	public function test_is_collection_returns_true_for_empty_collection(): void {
		// A collection with no custom fields still defines a trait: designate it
		// directly and confirm the term-based identity holds.
		$collection_id = $this->create_document();
		( new TraitTaxonomy() )->ensure_mirror_term( $collection_id );

		$this->assertGreaterThan( 0, TraitTaxonomy::term_id_for_trait( $collection_id ) );
		$this->assertTrue(
			Document::is_collection( $collection_id ),
			'A collection with no custom fields is still a collection.'
		);
		$this->assertSame( array(), Document::collection_field_ids( $collection_id ) );
	}

	public function test_is_collection_post_requires_matching_post_type(): void {
		$collection_id = $this->create_collection();
		$collection    = get_post( $collection_id );
		$this->assertNotNull( $collection );

		$foreign_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Foreign post',
			)
		);
		// Even with the meta present, a non-document post is not a collection.
		add_post_meta( $foreign_id, 'cortext_fields', '42' );
		$foreign = get_post( $foreign_id );

		$this->assertTrue( Document::is_collection_post( $collection ) );
		$this->assertFalse( Document::is_collection_post( $foreign ) );
	}

	public function test_collection_field_ids_returns_int_array(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection',
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', '5' );
		add_post_meta( $collection_id, 'cortext_fields', '10' );
		// Garbage values are dropped.
		add_post_meta( $collection_id, 'cortext_fields', '0' );
		add_post_meta( $collection_id, 'cortext_fields', '-3' );

		$this->assertSame( array( 5, 10 ), Document::collection_field_ids( $collection_id ) );
	}

	public function test_collection_field_ids_returns_empty_for_non_collection(): void {
		$page_id = $this->create_document();

		$this->assertSame( array(), Document::collection_field_ids( $page_id ) );
	}

	public function test_register_collection_meta_registers_cortext_fields(): void {
		( new Document() )->register_collection_meta();

		$registered = get_registered_meta_keys( 'post', Document::POST_TYPE );
		$this->assertArrayHasKey( 'cortext_fields', $registered );
		$this->assertFalse( $registered['cortext_fields']['single'] );
		$this->assertSame( 'sanitize_text_field', $registered['cortext_fields']['sanitize_callback'] );
		// Collection identity lives in the mirror term, not in a meta marker, so
		// no `cortext_collection` meta is registered.
		$this->assertArrayNotHasKey( 'cortext_collection', $registered );
	}

	public function test_register_collection_meta_registers_detail_layout(): void {
		( new Document() )->register_collection_meta();

		$registered = get_registered_meta_keys( 'post', Document::POST_TYPE );
		$this->assertArrayHasKey( 'cortext_detail_layout', $registered );
		$this->assertTrue( $registered['cortext_detail_layout']['single'] );
		$this->assertSame(
			array( Document::class, 'sanitize_detail_layout' ),
			$registered['cortext_detail_layout']['sanitize_callback']
		);
	}

	public function test_defines_trait_rest_field_reports_collection_state(): void {
		( new Document() )->register_rest_fields();

		$fields = $GLOBALS['wp_rest_additional_fields'][ Document::POST_TYPE ] ?? array();
		$this->assertArrayHasKey( 'cortext_defines_trait', $fields );
		$this->assertTrue( $fields['cortext_defines_trait']['schema']['readonly'] );
		$this->assertSame( 'boolean', $fields['cortext_defines_trait']['schema']['type'] );

		$callback      = $fields['cortext_defines_trait']['get_callback'];
		$collection_id = $this->create_collection();
		$page_id       = $this->create_document();

		$this->assertTrue( $callback( array( 'id' => $collection_id ) ) );
		$this->assertFalse( $callback( array( 'id' => $page_id ) ) );
	}

	public function test_sanitize_detail_layout_accepts_array_with_visible_entries(): void {
		$sanitized = Document::sanitize_detail_layout(
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
			)
		);

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
			$sanitized
		);
	}

	public function test_sanitize_detail_layout_accepts_object_payload(): void {
		$payload = (object) array(
			'fields' => array(
				(object) array(
					'field'   => 'field-7',
					'visible' => true,
				),
			),
		);

		$sanitized = Document::sanitize_detail_layout( $payload );

		$this->assertSame(
			array(
				'fields' => array(
					array(
						'field'   => 'field-7',
						'visible' => true,
					),
				),
			),
			$sanitized
		);
	}

	public function test_sanitize_detail_layout_rejects_invalid_field_ids(): void {
		$sanitized = Document::sanitize_detail_layout(
			array(
				'fields' => array(
					array(
						'field'   => 'title',
						'visible' => true,
					),
					array(
						'field'   => 'field-abc',
						'visible' => true,
					),
					array(
						'field'   => 'field-0',
						'visible' => true,
					),
					array(
						'field'   => 'field-3',
						'visible' => true,
					),
					array(
						'field'   => 'modified_by',
						'visible' => false,
					),
				),
			)
		);

		$this->assertSame(
			array(
				array(
					'field'   => 'field-3',
					'visible' => true,
				),
				array(
					'field'   => 'modified_by',
					'visible' => false,
				),
			),
			$sanitized['fields']
		);
	}

	public function test_sanitize_detail_layout_deduplicates_by_field_id(): void {
		$sanitized = Document::sanitize_detail_layout(
			array(
				'fields' => array(
					array(
						'field'   => 'field-1',
						'visible' => false,
					),
					array(
						'field'   => 'field-1',
						'visible' => true,
					),
				),
			)
		);

		$this->assertCount( 1, $sanitized['fields'] );
		$this->assertSame( 'field-1', $sanitized['fields'][0]['field'] );
		$this->assertFalse( $sanitized['fields'][0]['visible'] );
	}

	public function test_sanitize_detail_layout_defaults_visible_to_true_when_missing(): void {
		$sanitized = Document::sanitize_detail_layout(
			array(
				'fields' => array(
					array( 'field' => 'field-9' ),
				),
			)
		);

		$this->assertTrue( $sanitized['fields'][0]['visible'] );
	}

	public function test_sanitize_detail_layout_coerces_visible_to_bool(): void {
		$sanitized = Document::sanitize_detail_layout(
			array(
				'fields' => array(
					array(
						'field'   => 'field-1',
						'visible' => '0',
					),
					array(
						'field'   => 'field-2',
						'visible' => 'true',
					),
				),
			)
		);

		$this->assertFalse( $sanitized['fields'][0]['visible'] );
		$this->assertTrue( $sanitized['fields'][1]['visible'] );
	}

	public function test_sanitize_detail_layout_returns_empty_fields_for_garbage(): void {
		$this->assertSame( array( 'fields' => array() ), Document::sanitize_detail_layout( 'nope' ) );
		$this->assertSame( array( 'fields' => array() ), Document::sanitize_detail_layout( null ) );
		$this->assertSame( array( 'fields' => array() ), Document::sanitize_detail_layout( array() ) );
	}

	public function test_register_field_meta_registers_each_field_with_correct_shape(): void {
		$text_field        = $this->create_field( 'text' );
		$multiselect_field = $this->create_field( 'multiselect' );
		$relation_field    = $this->create_field( 'relation' );
		$rollup_field      = $this->create_field( 'rollup' );

		( new Document() )->register_field_meta();

		$registered = get_registered_meta_keys( 'post', Document::POST_TYPE );

		$this->assertArrayHasKey( "field-{$text_field}", $registered );
		$this->assertTrue( $registered[ "field-{$text_field}" ]['single'] );

		$this->assertArrayHasKey( "field-{$multiselect_field}", $registered );
		$this->assertFalse( $registered[ "field-{$multiselect_field}" ]['single'] );

		$this->assertArrayHasKey( "field-{$relation_field}", $registered );
		$this->assertFalse( $registered[ "field-{$relation_field}" ]['single'] );
		$this->assertSame( 'integer', $registered[ "field-{$relation_field}" ]['type'] );

		$this->assertArrayHasKey( "field-{$rollup_field}", $registered );
		$this->assertTrue( $registered[ "field-{$rollup_field}" ]['single'] );
	}

	public function test_seed_data_view_block_inserts_owner_block(): void {
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Collection seed',
			)
		);

		Document::seed_data_view_block( $collection_id );

		$collection = get_post( $collection_id );
		$this->assertNotNull( $collection );
		// WorDBless stores `post_content` slashed (it hooks `wp_insert_post_data`
		// which fires before WP unslashes). Match against the slashed shape so
		// the test reflects what the seed actually wrote.
		$this->assertStringContainsString( '<!-- wp:cortext/data-view', (string) $collection->post_content );
		$this->assertStringContainsString( '"collectionId":' . $collection_id, wp_unslash( (string) $collection->post_content ) );
	}

	public function test_data_view_owner_markup_locks_move_and_remove(): void {
		$blocks = parse_blocks( Document::build_data_view_block_markup( 123 ) );

		$this->assertCount( 1, $blocks );
		$this->assertSame( 'cortext/data-view', $blocks[0]['blockName'] );
		$this->assertSame( 123, $blocks[0]['attrs']['collectionId'] ?? null );
		$this->assertSame(
			array(
				'move'   => true,
				'remove' => true,
			),
			$blocks[0]['attrs']['lock'] ?? null
		);
	}

	public function test_seed_data_view_block_is_idempotent(): void {
		// Pre-stamp the canvas with the canonical (unslashed) markup so the
		// idempotency check matches even under WorDBless's storage quirk
		// (`get_post` returns the slashed shape on read).
		$collection_id = (int) wp_insert_post(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_status'  => 'private',
				'post_title'   => 'Seed once',
				'post_content' => '',
			)
		);
		$markup        = Document::build_data_view_block_markup( $collection_id );
		// Directly inject the canonical markup into the in-memory store, then
		// seed again to prove it bails out.
		$post               = get_post( $collection_id );
		$post->post_content = $markup;
		\WorDBless\Posts::init()->posts[ $collection_id ]->post_content = $markup;
		wp_cache_set( $collection_id, $post, 'posts' );

		// With the canonical markup in place, has_owner_data_view_block()
		// returns true and the seed should bail out.
		$this->assertTrue( Document::has_owner_data_view_block( $markup, $collection_id ) );
		Document::seed_data_view_block( $collection_id );

		$collection = get_post( $collection_id );
		$this->assertNotNull( $collection );
		$this->assertSame(
			1,
			substr_count( (string) $collection->post_content, '<!-- wp:cortext/data-view' ),
			'The data-view block should only appear once when the canvas already carries it.'
		);
	}

	public function test_seed_data_view_block_ignores_non_document_posts(): void {
		$foreign_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Foreign',
			)
		);

		Document::seed_data_view_block( $foreign_id );

		$foreign = get_post( $foreign_id );
		$this->assertNotNull( $foreign );
		$this->assertStringNotContainsString( '<!-- wp:cortext/data-view', (string) $foreign->post_content );
	}

	public function test_has_owner_data_view_block_returns_true_for_self_reference(): void {
		$markup = Document::build_data_view_block_markup( 42 );

		$this->assertTrue( Document::has_owner_data_view_block( $markup, 42 ) );
	}

	public function test_has_owner_data_view_block_returns_false_for_foreign_reference(): void {
		$markup = Document::build_data_view_block_markup( 99 );

		$this->assertFalse( Document::has_owner_data_view_block( $markup, 42 ) );
	}

	public function test_has_owner_data_view_block_returns_false_for_empty_content(): void {
		$this->assertFalse( Document::has_owner_data_view_block( '', 42 ) );
	}

	public function test_drop_foreign_root_data_views_keeps_self_referencing_block(): void {
		$blocks = parse_blocks(
			'<!-- wp:cortext/data-view {"collectionId":7,"align":"full"} /-->'
		);

		$this->assertSame( $blocks, Document::drop_foreign_root_data_views( $blocks, 7 ) );
	}

	public function test_drop_foreign_root_data_views_drops_block_pointing_elsewhere(): void {
		$blocks = parse_blocks(
			"<!-- wp:post-title /-->\n\n" .
			'<!-- wp:cortext/data-view {"collectionId":7,"align":"full"} /-->' . "\n\n" .
			'<!-- wp:cortext/data-view {"collectionId":42,"align":"full"} /-->'
		);

		$filtered    = Document::drop_foreign_root_data_views( $blocks, 7 );
		$named_kept  = $this->named_block_names( $filtered );
		$collections = $this->data_view_collection_ids( $filtered );

		$this->assertSame( array( 'core/post-title', 'cortext/data-view' ), $named_kept );
		$this->assertSame( array( 7 ), $collections );
	}

	public function test_drop_foreign_root_data_views_preserves_non_data_view_blocks(): void {
		$blocks = parse_blocks(
			"<!-- wp:paragraph -->\n<p>Body</p>\n<!-- /wp:paragraph -->\n\n" .
			'<!-- wp:cortext/data-view {"collectionId":9} /-->'
		);

		$filtered   = Document::drop_foreign_root_data_views( $blocks, 7 );
		$named_kept = $this->named_block_names( $filtered );

		$this->assertSame( array( 'core/paragraph' ), $named_kept );
	}

	/**
	 * Returns block names in order.
	 *
	 * @param array<int,array<string,mixed>> $blocks
	 * @return array<int,string>
	 */
	private function named_block_names( array $blocks ): array {
		$names = array();
		foreach ( $blocks as $block ) {
			$name = $block['blockName'] ?? null;
			if ( is_string( $name ) ) {
				$names[] = $name;
			}
		}
		return $names;
	}

	/**
	 * Returns data-view collection ids in order.
	 *
	 * @param array<int,array<string,mixed>> $blocks
	 * @return array<int,int>
	 */
	private function data_view_collection_ids( array $blocks ): array {
		$ids = array();
		foreach ( $blocks as $block ) {
			if ( 'cortext/data-view' === ( $block['blockName'] ?? null ) ) {
				$ids[] = (int) ( $block['attrs']['collectionId'] ?? 0 );
			}
		}
		return $ids;
	}

	public function test_strip_foreign_root_data_views_filters_collection_post_content(): void {
		$collection_id = $this->create_collection();
		$dirty         = "<!-- wp:post-title /-->\n\n" .
			'<!-- wp:cortext/data-view {"collectionId":' . $collection_id . '} /-->' . "\n\n" .
			'<!-- wp:cortext/data-view {"collectionId":9999} /-->';

		$data = ( new Document() )->strip_foreign_root_data_views(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_content' => wp_slash( $dirty ),
			),
			array( 'ID' => $collection_id )
		);

		$cleaned = wp_unslash( (string) $data['post_content'] );
		$this->assertSame( 1, substr_count( $cleaned, '<!-- wp:cortext/data-view' ) );
		$this->assertStringContainsString( '"collectionId":' . $collection_id, $cleaned );
		$this->assertStringNotContainsString( '"collectionId":9999', $cleaned );
	}

	public function test_strip_foreign_root_data_views_skips_pages_without_schema(): void {
		$page_id = $this->create_document();
		$content = "<!-- wp:post-title /-->\n\n" .
			'<!-- wp:cortext/data-view {"collectionId":9999} /-->';

		$data = ( new Document() )->strip_foreign_root_data_views(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_content' => wp_slash( $content ),
			),
			array( 'ID' => $page_id )
		);

		$this->assertStringContainsString( '"collectionId":9999', wp_unslash( (string) $data['post_content'] ) );
	}

	public function test_strip_foreign_root_data_views_skips_create_when_id_unknown(): void {
		$content = '<!-- wp:cortext/data-view {"collectionId":9999} /-->';

		$data = ( new Document() )->strip_foreign_root_data_views(
			array(
				'post_type'    => Document::POST_TYPE,
				'post_content' => wp_slash( $content ),
			),
			array( 'ID' => 0 )
		);

		$this->assertSame( wp_slash( $content ), $data['post_content'] );
	}

	public function test_strip_foreign_root_data_views_skips_other_post_types(): void {
		$content = '<!-- wp:cortext/data-view {"collectionId":9999} /-->';

		$data = ( new Document() )->strip_foreign_root_data_views(
			array(
				'post_type'    => 'post',
				'post_content' => wp_slash( $content ),
			),
			array( 'ID' => 1 )
		);

		$this->assertSame( wp_slash( $content ), $data['post_content'] );
	}

	public function test_assign_trait_from_request_attaches_existing_term(): void {
		$collection_id = $this->create_collection();
		$row_id        = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'New row',
			)
		);

		$post    = get_post( $row_id );
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_trait', $collection_id );

		( new Document() )->assign_trait_from_request( $post, $request, true );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		$this->assertTrue( has_term( $term_id, TraitTaxonomy::TAXONOMY, $row_id ) );
	}

	public function test_assign_trait_from_request_designates_collection_from_param(): void {
		// `cortext_collection` is a transient creation param read straight off
		// the request body; it is not registered as meta. Setting it designates
		// the document a collection by creating its mirror term.
		$document_id = $this->create_document();
		$post        = get_post( $document_id );
		$this->assertFalse( Document::is_collection( $document_id ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_collection', true );

		( new Document() )->assign_trait_from_request( $post, $request, true );

		$this->assertGreaterThan( 0, TraitTaxonomy::term_id_for_trait( $document_id ) );
		$this->assertTrue( Document::is_collection( $document_id ) );
		// The designation lives in the term, so no marker meta is written.
		$this->assertSame( '', (string) get_post_meta( $document_id, 'cortext_collection', true ) );
	}

	public function test_assign_trait_from_request_skips_when_no_trait_param(): void {
		$row_id  = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'No trait param',
			)
		);
		$post    = get_post( $row_id );
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );

		( new Document() )->assign_trait_from_request( $post, $request, true );

		$terms = wp_get_object_terms( $row_id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) );
		$this->assertSame( array(), $terms );
	}

	public function test_assign_trait_from_request_skips_when_term_missing(): void {
		$row_id  = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Missing term',
			)
		);
		$post    = get_post( $row_id );
		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_trait', 99999 );

		( new Document() )->assign_trait_from_request( $post, $request, true );

		$terms = wp_get_object_terms( $row_id, TraitTaxonomy::TAXONOMY, array( 'fields' => 'ids' ) );
		$this->assertSame( array(), $terms );
	}

	public function test_prepare_meta_updates_rejects_field_from_another_collection(): void {
		// `field-<id>` is registered globally on `crtxt_document`, so without
		// an extra check WP REST would accept writes for any field on any
		// row. The handler must reject the request when the field doesn't
		// belong to the row's collection.
		$source_collection_id = $this->create_collection();
		$other_collection_id  = $this->create_collection();
		$other_field_id       = $this->create_field( 'text' );
		add_post_meta( $other_collection_id, 'cortext_fields', (string) $other_field_id );

		$row_id         = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Source row',
			)
		);
		$source_term_id = TraitTaxonomy::term_id_for_trait( $source_collection_id );
		wp_set_object_terms( $row_id, array( $source_term_id ), TraitTaxonomy::TAXONOMY );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $row_id );
		$request->set_param( 'id', $row_id );
		$request->set_param( 'meta', array( 'field-' . $other_field_id => 'sneaky' ) );

		$result = ( new Document() )->prepare_meta_updates( new \stdClass(), $request );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'cortext_field_not_in_collection', $result->get_error_code() );
	}

	public function test_prepare_meta_updates_accepts_field_from_the_rows_own_collection(): void {
		$collection_id = $this->create_collection();
		$field_id      = (int) get_post_meta( $collection_id, 'cortext_fields', false )[0];

		$row_id         = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Source row',
			)
		);
		$source_term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		wp_set_object_terms( $row_id, array( $source_term_id ), TraitTaxonomy::TAXONOMY );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $row_id );
		$request->set_param( 'id', $row_id );
		$request->set_param( 'meta', array( 'field-' . $field_id => 'value' ) );

		$prepared = new \stdClass();
		$result   = ( new Document() )->prepare_meta_updates( $prepared, $request );

		$this->assertSame( $prepared, $result );
	}

	public function test_prepare_meta_updates_ignores_rollup_meta(): void {
		$collection_id = $this->create_collection();
		$field_id      = (int) get_post_meta( $collection_id, 'cortext_fields', false )[0];
		$rollup_field  = $this->create_field( 'rollup' );
		add_post_meta( $collection_id, 'cortext_fields', (string) $rollup_field );

		$row_id  = $this->create_document( array( 'post_title' => 'Source row' ) );
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents/' . $row_id );
		$request->set_param( 'id', $row_id );
		$request->set_param(
			'meta',
			array(
				'field-' . $field_id     => 'value',
				'field-' . $rollup_field => '',
			)
		);

		$prepared = new \stdClass();
		$result   = ( new Document() )->prepare_meta_updates( $prepared, $request );

		$this->assertSame( $prepared, $result );
		$this->assertSame( array( 'field-' . $field_id => 'value' ), $request->get_param( 'meta' ) );
	}

	public function test_prepare_meta_updates_ignores_rollup_meta_on_create(): void {
		$rollup_field = $this->create_field( 'rollup' );

		$request = new WP_REST_Request( 'POST', '/wp/v2/crtxt_documents' );
		$request->set_param( 'meta', array( 'field-' . $rollup_field => '' ) );

		$prepared = new \stdClass();
		$result   = ( new Document() )->prepare_meta_updates( $prepared, $request );

		$this->assertSame( $prepared, $result );
		$this->assertSame( array(), $request->get_param( 'meta' ) );
	}

	public function test_limit_field_meta_to_collection_keeps_only_the_rows_collection_fields(): void {
		$collection_id = $this->create_collection();
		$own_field_id  = (int) get_post_meta( $collection_id, 'cortext_fields', false )[0];
		$foreign_field = $this->create_field( 'text' );

		$row_id  = $this->create_document( array( 'post_title' => 'Row' ) );
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY );

		$response = new WP_REST_Response(
			array(
				'meta' => array(
					'field-' . $own_field_id  => 'kept',
					'field-' . $foreign_field => 'dropped',
					'cortext_fields'          => array(),
				),
			)
		);

		$meta = ( new Document() )
			->limit_field_meta_to_collection( $response, get_post( $row_id ) )
			->get_data()['meta'];

		$this->assertArrayHasKey( 'field-' . $own_field_id, $meta );
		$this->assertArrayNotHasKey( 'field-' . $foreign_field, $meta );
		$this->assertArrayHasKey( 'cortext_fields', $meta );
	}

	public function test_limit_field_meta_to_collection_drops_rollup_meta(): void {
		$collection_id = $this->create_collection();
		$own_field_id  = (int) get_post_meta( $collection_id, 'cortext_fields', false )[0];
		$rollup_field  = $this->create_field( 'rollup' );
		add_post_meta( $collection_id, 'cortext_fields', (string) $rollup_field );

		$row_id  = $this->create_document( array( 'post_title' => 'Row' ) );
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY );

		$response = new WP_REST_Response(
			array(
				'meta' => array(
					'field-' . $own_field_id => 'kept',
					'field-' . $rollup_field => '',
				),
			)
		);

		$meta = ( new Document() )
			->limit_field_meta_to_collection( $response, get_post( $row_id ) )
			->get_data()['meta'];

		$this->assertArrayHasKey( 'field-' . $own_field_id, $meta );
		$this->assertArrayNotHasKey( 'field-' . $rollup_field, $meta );
	}

	public function test_limit_field_meta_to_collection_drops_all_field_meta_on_a_page(): void {
		$field_id = $this->create_field( 'text' );
		$page_id  = $this->create_document( array( 'post_title' => 'Page' ) );

		$response = new WP_REST_Response(
			array(
				'meta' => array(
					'field-' . $field_id => 'x',
					'cortext_fields'     => array(),
				),
			)
		);

		$meta = ( new Document() )
			->limit_field_meta_to_collection( $response, get_post( $page_id ) )
			->get_data()['meta'];

		$this->assertArrayNotHasKey( 'field-' . $field_id, $meta );
		$this->assertArrayHasKey( 'cortext_fields', $meta );
	}

	public function test_apply_trait_filters_adds_not_exists_tax_query_for_no_trait(): void {
		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_no_trait', '1' );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertArrayHasKey( 'tax_query', $args );
		$this->assertArrayNotHasKey( 'meta_query', $args );
		$clause = $args['tax_query'][0];
		$this->assertSame( TraitTaxonomy::TAXONOMY, $clause['taxonomy'] );
		$this->assertSame( 'NOT EXISTS', $clause['operator'] );
	}

	public function test_apply_trait_filters_restricts_to_trait_term(): void {
		$collection_id = $this->create_collection();
		$term_id       = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );

		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_trait', $collection_id );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertArrayHasKey( 'tax_query', $args );
		$clause = $args['tax_query'][0];
		$this->assertSame( TraitTaxonomy::TAXONOMY, $clause['taxonomy'] );
		$this->assertSame( 'term_id', $clause['field'] );
		$this->assertSame( array( $term_id ), $clause['terms'] );
	}

	public function test_apply_trait_filters_skips_trait_clause_when_term_missing(): void {
		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_trait', 99999 );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertSame( array(), $args );
	}

	public function test_apply_trait_filters_restricts_collections_to_trait_ids(): void {
		$first  = $this->create_collection();
		$second = $this->create_collection();

		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_collections', '1' );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertArrayNotHasKey( 'tax_query', $args );
		$this->assertArrayHasKey( 'post__in', $args );
		$this->assertEqualsCanonicalizing( array( $first, $second ), $args['post__in'] );
	}

	public function test_apply_trait_filters_collections_forces_empty_result_when_none_exist(): void {
		// With no collections, an empty `post__in` would match every document,
		// so the filter has to stand in `array( 0 )` to return nothing.
		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_collections', '1' );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertSame( array( 0 ), $args['post__in'] );
	}

	public function test_apply_trait_filters_excludes_collections_for_no_collections(): void {
		// `cortext_no_trait` only drops rows. A pages-only screen (the trash
		// list, the published-documents screen) also drops collections, since a
		// collection is not a page.
		$collection_id = $this->create_collection();

		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_no_collections', '1' );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertArrayHasKey( 'post__not_in', $args );
		$this->assertContains( $collection_id, $args['post__not_in'] );
	}

	public function test_apply_trait_filters_no_collections_is_noop_when_none_exist(): void {
		// Nothing to exclude means no `post__not_in`, so a pages-only query is
		// not accidentally narrowed.
		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_no_collections', '1' );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertArrayNotHasKey( 'post__not_in', $args );
	}

	public function test_apply_trait_filters_combines_no_trait_and_no_collections_for_pages(): void {
		$collection_id = $this->create_collection();

		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );
		$request->set_param( 'cortext_no_trait', '1' );
		$request->set_param( 'cortext_no_collections', '1' );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertArrayHasKey( 'tax_query', $args );
		$this->assertSame( 'NOT EXISTS', $args['tax_query'][0]['operator'] );
		$this->assertArrayHasKey( 'post__not_in', $args );
		$this->assertContains( $collection_id, $args['post__not_in'] );
	}

	public function test_apply_trait_filters_is_a_noop_when_no_params_set(): void {
		$request = new WP_REST_Request( 'GET', '/wp/v2/crtxt_documents' );

		$args = ( new Document() )->apply_trait_filters( array(), $request );

		$this->assertSame( array(), $args );
	}

	public function test_expose_trait_filter_params_lists_the_four_filter_params(): void {
		$params = ( new Document() )->expose_trait_filter_params( array() );

		$this->assertArrayHasKey( 'cortext_no_trait', $params );
		$this->assertSame( 'boolean', $params['cortext_no_trait']['type'] );

		$this->assertArrayHasKey( 'cortext_no_collections', $params );
		$this->assertSame( 'boolean', $params['cortext_no_collections']['type'] );

		$this->assertArrayHasKey( 'cortext_trait', $params );
		$this->assertSame( 'integer', $params['cortext_trait']['type'] );

		$this->assertArrayHasKey( 'cortext_collections', $params );
		$this->assertSame( 'boolean', $params['cortext_collections']['type'] );
	}

	private function create_document( array $args = array() ): int {
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

	private function create_collection(): int {
		$id       = $this->create_document( array( 'post_title' => 'Collection ' . wp_generate_uuid4() ) );
		$field_id = $this->create_field( 'text' );
		add_post_meta( $id, 'cortext_fields', (string) $field_id );

		return $id;
	}

	private function create_field( string $type ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => ucfirst( $type ) . ' field',
				'meta_input'  => array( 'type' => $type ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		return $field_id;
	}
}
