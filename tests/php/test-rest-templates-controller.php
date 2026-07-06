<?php
/**
 * Tests for Cortext template REST endpoints and instantiation behaviour.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\PostType\Template as TemplatePostType;
use Cortext\Relations;
use Cortext\Rest\TemplatesController;
use Cortext\Taxonomy\TraitTaxonomy;
use Cortext\Templates;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Templates_Controller extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private TemplatePostType $template_post_type;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new Field() )->register_post_type();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'before_delete_post', array( $trait_taxonomy, 'sync_term_on_delete' ), 10, 2 );

		$this->template_post_type = new TemplatePostType();
		$this->template_post_type->register_post_type();
		$this->template_post_type->register_meta();
		add_action( 'before_delete_post', array( $this->template_post_type, 'clear_deleted_default' ), 10, 2 );

		$this->install_in_memory_posts_query();
		$this->install_in_memory_term_store();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new TemplatesController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		remove_action( 'before_delete_post', array( $this->template_post_type, 'clear_deleted_default' ), 10 );
		delete_option( Templates::PAGE_DEFAULT_OPTION );
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/templates', $routes );
		$this->assertArrayHasKey( '/cortext/v1/templates/default', $routes );
		$this->assertArrayHasKey( '/cortext/v1/templates/from-document', $routes );
	}

	public function test_registers_hidden_template_post_type_with_rest_support(): void {
		$this->assertTrue( post_type_exists( TemplatePostType::POST_TYPE ) );

		$object = get_post_type_object( TemplatePostType::POST_TYPE );
		$this->assertNotNull( $object );
		$this->assertFalse( $object->show_ui );
		$this->assertFalse( $object->show_in_menu );
		$this->assertTrue( $object->show_in_rest );
		$this->assertTrue( post_type_supports( TemplatePostType::POST_TYPE, 'title' ) );
		$this->assertTrue( post_type_supports( TemplatePostType::POST_TYPE, 'editor' ) );
		$this->assertTrue( post_type_supports( TemplatePostType::POST_TYPE, 'revisions' ) );
	}

	public function test_requires_edit_posts_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->request( 'GET', '/cortext/v1/templates' );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_crud_and_duplicate_page_templates(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$create = $this->request(
			'POST',
			'/cortext/v1/templates',
			array(
				'kind'    => Templates::KIND_PAGE,
				'title'   => 'Meeting notes',
				'content' => '<!-- wp:paragraph --><p>Agenda</p><!-- /wp:paragraph -->',
			)
		);

		$this->assertSame( 201, $create->get_status() );
		$template = $create->get_data()['template'];
		$this->assertSame( 'Meeting notes', $template['title'] );
		$this->assertSame( Templates::KIND_PAGE, $template['kind'] );
		$this->assertNull( $template['collection_id'] );

		$list = $this->request(
			'GET',
			'/cortext/v1/templates',
			array( 'kind' => Templates::KIND_PAGE )
		);
		$this->assertSame( array( $template['id'] ), array_column( $list->get_data()['templates'], 'id' ) );

		$update = $this->request(
			'POST',
			'/cortext/v1/templates/' . $template['id'],
			array(
				'title'   => 'Renamed template',
				'content' => '<!-- wp:paragraph --><p>Updated</p><!-- /wp:paragraph -->',
			)
		);
		$this->assertSame( 200, $update->get_status() );
		$this->assertSame( 'Renamed template', $update->get_data()['template']['title'] );

		$duplicate = $this->request( 'POST', '/cortext/v1/templates/' . $template['id'] . '/duplicate' );
		$this->assertSame( 201, $duplicate->get_status() );
		$this->assertSame( 'Copy of Renamed template', $duplicate->get_data()['template']['title'] );
		$this->assertStringContainsString( 'Updated', $duplicate->get_data()['template']['content'] );

		$delete = $this->request( 'DELETE', '/cortext/v1/templates/' . $template['id'] );
		$this->assertSame( 200, $delete->get_status() );
		$this->assertTrue( $delete->get_data()['deleted'] );
		$this->assertNull( get_post( (int) $template['id'] ) );
	}

	public function test_page_default_is_saved_returned_and_cleared_when_deleted(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$template_id = $this->create_template(
			array(
				'kind'  => Templates::KIND_PAGE,
				'title' => 'Default page',
			)
		);

		$set = $this->request(
			'PUT',
			'/cortext/v1/templates/default',
			array( 'id' => $template_id )
		);
		$this->assertSame( 200, $set->get_status() );
		$this->assertSame( $template_id, $set->get_data()['template']['id'] );

		$get = $this->request( 'GET', '/cortext/v1/templates/default' );
		$this->assertSame( $template_id, $get->get_data()['template']['id'] );

		$delete = $this->request( 'DELETE', '/cortext/v1/templates/' . $template_id );
		$this->assertSame( 200, $delete->get_status() );
		$this->assertSame( 0, (int) get_option( Templates::PAGE_DEFAULT_OPTION, 0 ) );

		$get_after_delete = $this->request( 'GET', '/cortext/v1/templates/default' );
		$this->assertNull( $get_after_delete->get_data()['template'] );
	}

	public function test_page_default_read_without_template_access_does_not_clear_default(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$template_id = $this->create_template(
			array(
				'kind'  => Templates::KIND_PAGE,
				'title' => 'Private default page',
			)
		);

		$set = $this->request(
			'PUT',
			'/cortext/v1/templates/default',
			array( 'id' => $template_id )
		);
		$this->assertSame( 200, $set->get_status() );

		wp_set_current_user( $this->create_user( 'author' ) );

		$get = $this->request( 'GET', '/cortext/v1/templates/default' );
		$this->assertSame( 200, $get->get_status() );
		$this->assertNull( $get->get_data()['template'] );
		$this->assertSame( $template_id, (int) get_option( Templates::PAGE_DEFAULT_OPTION, 0 ) );
	}

	public function test_row_template_cannot_be_workspace_page_default(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'Tasks' );
		$template_id   = $this->create_template(
			array(
				'kind'          => Templates::KIND_ROW,
				'collection_id' => $collection_id,
				'title'         => 'Task row',
			)
		);

		$response = $this->request(
			'PUT',
			'/cortext/v1/templates/default',
			array( 'id' => $template_id )
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_template_default_invalid_kind', $response->get_data()['code'] );
	}

	public function test_instantiate_page_template_copies_title_blocks_and_parent(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id   = $this->create_document( 'Parent' );
		$template_id = $this->create_template(
			array(
				'kind'    => Templates::KIND_PAGE,
				'title'   => 'Project brief',
				'content' => '<!-- wp:post-title /--><!-- wp:cortext/document-icon /--><!-- wp:paragraph --><p>Brief body</p><!-- /wp:paragraph -->',
			)
		);

		$response = $this->request(
			'POST',
			'/cortext/v1/templates/' . $template_id . '/instantiate',
			array( 'parent' => $parent_id )
		);

		$this->assertSame( 201, $response->get_status() );
		$document_id = (int) $response->get_data()['document']['id'];
		$document    = get_post( $document_id );
		$this->assertNotNull( $document );
		$this->assertSame( Document::POST_TYPE, $document->post_type );
		$this->assertSame( 'Project brief', $document->post_title );
		$this->assertSame( $parent_id, (int) $document->post_parent );
		$this->assertStringContainsString( 'Brief body', $document->post_content );
		$this->assertStringNotContainsString( 'post-title', $document->post_content );
		$this->assertStringNotContainsString( 'document-icon', $document->post_content );
	}

	public function test_creates_page_template_from_existing_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$document_id = $this->create_document( 'Spec page' );
		wp_update_post(
			array(
				'ID'           => $document_id,
				'post_content' => '<!-- wp:paragraph --><p>Starter body</p><!-- /wp:paragraph -->',
			)
		);

		$response = $this->request(
			'POST',
			'/cortext/v1/templates/from-document',
			array( 'document_id' => $document_id )
		);

		$this->assertSame( 201, $response->get_status(), wp_json_encode( $response->get_data() ) );
		$template = $response->get_data()['template'];
		$this->assertSame( Templates::KIND_PAGE, $template['kind'] );
		$this->assertSame( 'Spec page', $template['title'] );
		$this->assertStringContainsString( 'Starter body', $template['content'] );
	}

	public function test_creates_row_template_from_existing_row_with_field_defaults(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'Tasks' );
		$status_id     = $this->attach_field( $collection_id, 'Status', 'text' );
		$tag_id        = $this->attach_field( $collection_id, 'Tags', 'multiselect' );
		$rollup_id     = $this->attach_field( $collection_id, 'Rollup', 'rollup' );
		$row_id        = $this->create_row( $collection_id, 'Bug bash' );

		wp_update_post(
			array(
				'ID'           => $row_id,
				'post_content' => '<!-- wp:paragraph --><p>Row starter</p><!-- /wp:paragraph -->',
			)
		);
		update_post_meta( $row_id, Relations::meta_key( $status_id ), 'todo' );
		add_post_meta( $row_id, Relations::meta_key( $tag_id ), 'frontend' );
		add_post_meta( $row_id, Relations::meta_key( $tag_id ), 'urgent' );
		update_post_meta( $row_id, Relations::meta_key( $rollup_id ), 'ignored' );

		$response = $this->request(
			'POST',
			'/cortext/v1/templates/from-document',
			array( 'document_id' => $row_id )
		);

		$this->assertSame( 201, $response->get_status(), wp_json_encode( $response->get_data() ) );
		$template = $response->get_data()['template'];
		$this->assertSame( Templates::KIND_ROW, $template['kind'] );
		$this->assertSame( $collection_id, $template['collection_id'] );
		$this->assertSame( 'Bug bash', $template['title'] );
		$this->assertStringContainsString( 'Row starter', $template['content'] );
		$this->assertSame( 'todo', $template['field_values'][ 'field-' . $status_id ] );
		$this->assertSame( array( 'frontend', 'urgent' ), $template['field_values'][ 'field-' . $tag_id ] );
		$this->assertArrayNotHasKey( 'field-' . $rollup_id, $template['field_values'] );
	}

	public function test_collections_cannot_be_saved_as_templates_from_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'Tasks' );

		$response = $this->request(
			'POST',
			'/cortext/v1/templates/from-document',
			array( 'document_id' => $collection_id )
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_template_source_collection', $response->get_data()['code'] );
	}

	public function test_instantiate_row_template_applies_defaults_with_request_prefills_taking_priority(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'Tasks' );
		$status_id     = $this->attach_field( $collection_id, 'Status', 'text' );
		$owner_id      = $this->attach_field( $collection_id, 'Owner', 'text' );
		$tags_id       = $this->attach_field( $collection_id, 'Tags', 'multiselect' );
		$template_id   = $this->create_template(
			array(
				'kind'          => Templates::KIND_ROW,
				'collection_id' => $collection_id,
				'title'         => 'Task starter',
				'content'       => '<!-- wp:paragraph --><p>Row body</p><!-- /wp:paragraph -->',
				'field_values'  => array(
					'field-' . $status_id => 'todo',
					'field-' . $owner_id  => 'template owner',
					'field-' . $tags_id   => array( 'frontend', 'urgent' ),
				),
			)
		);

		$response = $this->request(
			'POST',
			'/cortext/v1/templates/' . $template_id . '/instantiate',
			array(
				'field_values' => array(
					'field-' . $status_id => 'filtered status',
				),
			)
		);

		$this->assertSame( 201, $response->get_status() );
		$row_id = (int) $response->get_data()['document']['id'];
		$row    = get_post( $row_id );

		$this->assertNotNull( $row );
		$this->assertSame( 'Task starter', $row->post_title );
		$this->assertSame( 'private', $row->post_status );
		$this->assertStringContainsString( 'Row body', $row->post_content );
		$this->assertSame( 'filtered status', get_post_meta( $row_id, Relations::meta_key( $status_id ), true ) );
		$this->assertSame( 'template owner', get_post_meta( $row_id, Relations::meta_key( $owner_id ), true ) );
		$this->assertSame( array( 'frontend', 'urgent' ), get_post_meta( $row_id, Relations::meta_key( $tags_id ), false ) );

		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertTrue( has_term( $term_id, TraitTaxonomy::TAXONOMY, $row_id ) );
	}

	public function test_rejects_row_template_defaults_for_fields_outside_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'Tasks' );

		$response = $this->request(
			'POST',
			'/cortext/v1/templates',
			array(
				'kind'          => Templates::KIND_ROW,
				'collection_id' => $collection_id,
				'title'         => 'Invalid row template',
				'field_values'  => array(
					'field-99999' => 'outside',
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_template_field_invalid', $response->get_data()['code'] );
	}

	private function request( string $method, string $path, array $params = array() ) {
		$request = new WP_REST_Request( $method, $path );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
		if ( in_array( $method, array( 'POST', 'PUT', 'PATCH', 'DELETE' ), true ) ) {
			$request->set_body_params( $params );
		}
		return rest_do_request( $request );
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

	private function create_collection( string $title ): int {
		$collection_id = $this->create_document( $title );
		$this->attach_field( $collection_id, 'Title', 'text' );
		$this->assertGreaterThan( 0, TraitTaxonomy::term_id_for_trait( $collection_id ) );
		return $collection_id;
	}

	private function create_row( int $collection_id, string $title ): int {
		$row_id  = $this->create_document( $title );
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		$this->assertGreaterThan( 0, $term_id );
		wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		return $row_id;
	}

	private function attach_field( int $collection_id, string $title, string $type ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => $type ),
			)
		);
		$this->assertGreaterThan( 0, $field_id );
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		return $field_id;
	}

	private function create_template( array $args ): int {
		$response = $this->request( 'POST', '/cortext/v1/templates', $args );
		$this->assertSame( 201, $response->get_status(), wp_json_encode( $response->get_data() ) );
		return (int) $response->get_data()['template']['id'];
	}
}
