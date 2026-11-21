<?php
/**
 * Tests for Cortext\Abilities\Abilities.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Abilities\Abilities;
use Cortext\Documents;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Rest\RowsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_Abilities_Registry;
use WP_Error;
use WP_REST_Server;

final class Test_Abilities extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private const ABILITIES = array(
		'cortext/search-documents',
		'cortext/list-collections',
		'cortext/query-rows',
	);

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		( new DocumentIdentity() )->register();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new RowsController() )->register();
		do_action( 'rest_api_init' );

		// The registry fires its init hooks once, the first time it's used.
		( new Abilities() )->register();
		WP_Abilities_Registry::get_instance();
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_registers_read_only_abilities_in_the_cortext_category(): void {
		$this->assertTrue( wp_has_ability_category( Abilities::CATEGORY ) );

		foreach ( self::ABILITIES as $name ) {
			$ability = wp_get_ability( $name );
			$this->assertNotNull( $ability, $name );
			$this->assertSame( Abilities::CATEGORY, $ability->get_category() );
			$this->assertTrue( $ability->get_meta_item( 'show_in_rest' ) );
			$this->assertSame(
				array(
					'readonly'    => true,
					'destructive' => false,
					'idempotent'  => true,
				),
				$ability->get_meta_item( 'annotations' )
			);
		}
	}

	public function test_subscriber_cannot_run_any_ability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );
		$collection_id = $this->create_collection( 'Projects' );

		$inputs = array(
			'cortext/search-documents' => null,
			'cortext/list-collections' => null,
			'cortext/query-rows'       => array( 'collection' => $collection_id ),
		);

		foreach ( $inputs as $name => $input ) {
			$result = wp_get_ability( $name )->execute( $input );
			$this->assertInstanceOf( WP_Error::class, $result, $name );
			$this->assertSame( 'ability_invalid_permissions', $result->get_error_code(), $name );
		}
	}

	public function test_search_documents_finds_pages_by_title(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$match     = $this->create_document( 'Quarterly report' );
		$unrelated = $this->create_document( 'Unrelated' );

		$result = wp_get_ability( 'cortext/search-documents' )->execute( array( 'search' => 'quarterly' ) );

		$ids = array_column( $result['documents'], 'id' );
		$this->assertContains( $match, $ids );
		$this->assertNotContains( $unrelated, $ids );
	}

	public function test_search_documents_leaves_out_documents_the_user_cannot_edit(): void {
		$author = $this->create_user( 'author' );
		$other  = $this->create_document( 'Roadmap by someone else', $this->create_user( 'editor' ) );
		$own    = $this->create_document( 'Roadmap of mine', $author );
		wp_set_current_user( $author );

		$result = wp_get_ability( 'cortext/search-documents' )->execute( array( 'search' => 'roadmap' ) );

		$ids = array_column( $result['documents'], 'id' );
		$this->assertContains( $own, $ids );
		$this->assertNotContains( $other, $ids );
	}

	public function test_list_collections_returns_properties_with_operators(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'Projects' );
		$field_id      = $this->add_field( $collection_id, 'Score', 'number' );

		$result = wp_get_ability( 'cortext/list-collections' )->execute();

		$collection = $this->find_by_id( $result['collections'], $collection_id );
		$this->assertSame( 'Projects', $collection['title'] );

		$properties = array_column( $collection['properties'], null, 'key' );
		$this->assertArrayNotHasKey( 'manual', $properties );
		$this->assertSame( 'Title', $properties['title']['label'] );
		$this->assertSame( 'Score', $properties[ "field-{$field_id}" ]['label'] );
		$this->assertSame( 'number', $properties[ "field-{$field_id}" ]['type'] );
		$this->assertTrue( $properties[ "field-{$field_id}" ]['filterable'] );
		$this->assertNotEmpty( $properties[ "field-{$field_id}" ]['operators'] );
	}

	public function test_list_collections_leaves_out_collections_the_user_cannot_edit(): void {
		$author = $this->create_user( 'author' );
		$other  = $this->create_collection( 'Not mine', $this->create_user( 'editor' ) );
		$own    = $this->create_collection( 'Mine', $author );
		wp_set_current_user( $author );

		$result = wp_get_ability( 'cortext/list-collections' )->execute();

		$ids = array_column( $result['collections'], 'id' );
		$this->assertContains( $own, $ids );
		$this->assertNotContains( $other, $ids );
	}

	public function test_list_collections_leaves_out_archived_and_trashed_collections(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$live     = $this->create_collection( 'Live' );
		$archived = $this->create_collection( 'Archived' );
		$trashed  = $this->create_collection( 'Trashed' );
		wp_update_post(
			array(
				'ID'          => $archived,
				'post_status' => Documents::STATUS_ARCHIVED,
			)
		);
		wp_trash_post( $trashed );

		$result = wp_get_ability( 'cortext/list-collections' )->execute();

		$ids = array_column( $result['collections'], 'id' );
		$this->assertContains( $live, $ids );
		$this->assertNotContains( $archived, $ids );
		$this->assertNotContains( $trashed, $ids );
	}

	public function test_query_rows_returns_rows_of_the_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'Projects' );
		$row_id        = $this->create_row( $collection_id, 'Launch plan' );

		$result = wp_get_ability( 'cortext/query-rows' )->execute( array( 'collection' => $collection_id ) );

		$this->assertNotInstanceOf( WP_Error::class, $result );
		$this->assertSame( 1, $result['total'] );
		$this->assertSame( array( $row_id ), array_column( $result['rows'], 'id' ) );
	}

	public function test_query_rows_returns_the_route_error_for_an_unknown_filter_field(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_collection( 'Projects' );

		$result = wp_get_ability( 'cortext/query-rows' )->execute(
			array(
				'collection' => $collection_id,
				'filters'    => array(
					array(
						'field'    => 'field-999999',
						'operator' => 'is',
						'value'    => 'x',
					),
				),
			)
		);

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertStringStartsWith( 'cortext_', $result->get_error_code() );
	}

	private function find_by_id( array $items, int $id ): array {
		foreach ( $items as $item ) {
			if ( $id === $item['id'] ) {
				return $item;
			}
		}
		$this->fail( "No item with id {$id}." );
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

	private function create_document( string $title, int $author = 0 ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'post_author' => $author,
			)
		);
		$this->assertGreaterThan( 0, $id );
		return $id;
	}

	private function create_collection( string $title, int $author = 0 ): int {
		$id = $this->create_document( $title, $author );
		$this->add_field( $id, 'Name', 'text' );
		return $id;
	}

	private function add_field( int $collection_id, string $title, string $type ): int {
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

	private function create_row( int $collection_id, string $title ): int {
		$id = $this->create_document( $title );
		wp_set_object_terms( $id, array( TraitTaxonomy::term_id_for_trait( $collection_id ) ), TraitTaxonomy::TAXONOMY, false );
		return $id;
	}
}
