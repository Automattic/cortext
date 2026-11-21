<?php
/**
 * Tests for Cortext\Fields\PropertyText and the `cortext/property` bindings source.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Editor\PropertyBindings;
use Cortext\Fields\PropertyText;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_Block;

final class Test_Fields_Property_Text extends BaseTestCase {

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
		( new Field() )->register_post_type();

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();
		wp_set_current_user( $this->create_user( 'administrator' ) );
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	/**
	 * Cases shared with `tests/js/utils/propertyText.test.js`.
	 *
	 * @return array<string,array{0:array}>
	 */
	public function shared_cases(): array {
		$fixture = json_decode(
			(string) file_get_contents( dirname( __DIR__ ) . '/fixtures/property-text.json' ), // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Local fixture file.
			true
		);
		$cases   = array();
		foreach ( $fixture['cases'] as $case ) {
			$cases[ $case['name'] ] = array( $case );
		}
		return $cases;
	}

	/**
	 * Formats each shared case the way the editor does.
	 *
	 * @dataProvider shared_cases
	 *
	 * @param array $test_case Fixture case.
	 */
	public function test_formats_shared_cases( array $test_case ): void {
		if ( ! class_exists( \NumberFormatter::class ) ) {
			$this->markTestSkipped( 'The shared cases expect intl formatting.' );
		}

		$text = PropertyText::format( $test_case['value'], $test_case['config'] );

		$this->assertSame( $test_case['expected'], str_replace( "\u{202F}", ' ', $text ) );
	}

	public function test_reads_a_row_property(): void {
		$collection_id = $this->create_collection( 'Books' );
		$field_id      = $this->add_field( $collection_id, 'Pages', 'number', array( 'number_format' => '{"style":"comma"}' ) );
		$row_id        = $this->create_row( $collection_id, 'Dune' );
		update_post_meta( $row_id, "field-{$field_id}", '1200' );

		$this->assertSame( '1,200', $this->property_text()->for_row( $row_id, (string) $field_id ) );
		$this->assertSame( '1200', $this->property_text()->for_row( $row_id, (string) $field_id, true ) );
	}

	public function test_reads_system_properties(): void {
		$collection_id = $this->create_collection( 'Books' );
		$this->add_field( $collection_id, 'Pages', 'number' );
		$row_id = $this->create_row( $collection_id, 'Dune' );
		$author = 'Ada Lovelace';
		wp_update_user(
			array(
				'ID'           => get_current_user_id(),
				'display_name' => $author,
			)
		);

		$this->assertSame( $author, $this->property_text()->for_row( $row_id, 'created_by' ) );
		$this->assertSame( $author, $this->property_text()->for_row( $row_id, 'modified_by' ) );
		$this->assertSame(
			wp_date( 'M j, Y g:i a', (int) get_post_time( 'U', true, $row_id ) ),
			$this->property_text()->for_row( $row_id, 'created_at' )
		);
	}

	public function test_ignores_fields_outside_the_row_collection(): void {
		$collection_id = $this->create_collection( 'Books' );
		$other_id      = $this->create_collection( 'Films' );
		$field_id      = $this->add_field( $other_id, 'Director', 'text' );
		$row_id        = $this->create_row( $collection_id, 'Dune' );
		update_post_meta( $row_id, "field-{$field_id}", 'Villeneuve' );

		$this->assertSame( '', $this->property_text()->for_row( $row_id, (string) $field_id ) );
		$this->assertSame( '', $this->property_text()->for_row( $row_id, 'not-a-field' ) );
	}

	public function test_returns_nothing_for_pages(): void {
		$page_id = $this->create_document( 'Notes', 'publish' );

		$this->assertSame( '', $this->property_text()->for_row( $page_id, 'created_by' ) );
	}

	public function test_hides_relation_targets_the_viewer_cannot_read(): void {
		$collection_id = $this->create_collection( 'Books' );
		$authors_id    = $this->create_collection( 'Authors' );
		$field_id      = $this->add_field( $collection_id, 'Author', 'relation', array( 'related_collection_id' => (string) $authors_id ) );
		$public_id     = $this->create_row( $authors_id, 'Frank Herbert', 'publish' );
		$private_id    = $this->create_row( $authors_id, 'Secret author', 'private' );
		$row_id        = $this->create_row( $collection_id, 'Dune', 'publish' );
		add_post_meta( $row_id, "field-{$field_id}", $public_id );
		add_post_meta( $row_id, "field-{$field_id}", $private_id );

		$this->assertSame( 'Frank Herbert, Secret author', $this->property_text()->for_row( $row_id, (string) $field_id ) );

		wp_set_current_user( 0 );

		$this->assertSame( 'Frank Herbert', $this->property_text()->for_row( $row_id, (string) $field_id ) );
	}

	public function test_bindings_source_fills_attributes(): void {
		$collection_id = $this->create_collection( 'Books' );
		$url_field     = $this->add_field( $collection_id, 'Cover', 'url' );
		$row_id        = $this->create_row( $collection_id, 'Dune' );
		update_post_meta( $row_id, "field-{$url_field}", 'https://example.com/dune.jpg' );

		$bindings = new PropertyBindings();
		$block    = new WP_Block(
			array(
				'blockName' => 'core/paragraph',
				'attrs'     => array(),
			)
		);
		// Core fills context from the block type's `usesContext`; set it
		// directly so the test doesn't depend on core blocks being registered.
		$block->context = array(
			'postId'   => $row_id,
			'postType' => Document::POST_TYPE,
		);

		$this->assertSame(
			'https://example.com/dune.jpg',
			$bindings->get_value( array( 'key' => (string) $url_field ), $block, 'url' )
		);
		$this->assertNull( $bindings->get_value( array(), $block, 'content' ) );
	}

	private function property_text(): PropertyText {
		return new PropertyText();
	}

	private function create_document( string $title, string $status = 'private' ): int {
		return (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => $status,
				'post_title'  => $title,
				'post_author' => get_current_user_id(),
			)
		);
	}

	/**
	 * A document becomes a collection once it lists a field, so callers add
	 * at least one field.
	 *
	 * @param string $title Collection title.
	 */
	private function create_collection( string $title ): int {
		return $this->create_document( $title, 'publish' );
	}

	private function add_field( int $collection_id, string $title, string $type, array $meta = array() ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array_merge( array( 'type' => $type ), $meta ),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		return $field_id;
	}

	private function create_row( int $collection_id, string $title, string $status = 'publish' ): int {
		$row_id  = $this->create_document( $title, $status );
		$term_id = TraitTaxonomy::term_id_for_trait( $collection_id );
		if ( $term_id > 0 ) {
			wp_set_object_terms( $row_id, array( $term_id ), TraitTaxonomy::TAXONOMY, false );
		}
		return $row_id;
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
