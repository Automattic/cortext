<?php
/**
 * Tests for Cortext\Abilities\WriteAbilities.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Abilities\Abilities;
use Cortext\Abilities\WriteAbilities;
use Cortext\Documents;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentFreeze;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\DocumentWriteGuard;
use Cortext\PostType\Field;
use Cortext\PostType\TrashCascade;
use Cortext\Rest\DocumentsController;
use Cortext\Taxonomy\TraitTaxonomy;
use WorDBless\BaseTestCase;
use WP_Abilities_Registry;
use WP_Error;
use WP_REST_Server;

final class Test_Write_Abilities extends BaseTestCase {

	use InMemoryPostsQuery;
	use InMemoryTermStore;

	private Document $document;

	public function set_up(): void {
		parent::set_up();

		$this->document = new Document();
		$this->document->register_post_type();
		add_filter( 'rest_pre_insert_' . Document::POST_TYPE, array( $this->document, 'prepare_meta_updates' ), 10, 2 );
		add_action( 'rest_after_insert_' . Document::POST_TYPE, array( $this->document, 'assign_trait_from_request' ), 10, 3 );
		add_action( 'rest_after_insert_' . Document::POST_TYPE, array( $this->document, 'apply_meta_updates' ), 20, 3 );
		( new DocumentIdentity() )->register();
		( new TraitTaxonomy() )->register_taxonomy();
		$trait_taxonomy = new TraitTaxonomy();
		add_action( 'added_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $trait_taxonomy, 'sync_term_on_meta_change' ), 10, 4 );
		( new Field() )->register_post_type();

		remove_all_actions( 'wp_trash_post' );
		remove_all_actions( 'untrashed_post' );
		remove_all_actions( 'transition_post_status' );
		remove_all_filters( 'wp_untrash_post_status' );

		$this->install_in_memory_term_store();
		$this->install_in_memory_posts_query();

		( new DocumentWriteGuard() )->register();
		( new DocumentFreeze() )->register();

		$archive_cascade = new ArchiveCascade();
		$archive_cascade->register_status();
		$archive_cascade->register_meta();
		$archive_cascade->register();

		$trash_cascade = new TrashCascade();
		$trash_cascade->register();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new DocumentsController( null, $trash_cascade, $archive_cascade ) )->register();
		do_action( 'rest_api_init' );

		// The registry fires its init hooks once per process, so another test
		// class may have built it without the write abilities.
		( new Abilities() )->register();
		$registry = WP_Abilities_Registry::get_instance();
		if ( ! wp_has_ability( 'cortext/create-page' ) ) {
			remove_all_actions( 'wp_abilities_api_init' );
			( new WriteAbilities() )->register();
			do_action( 'wp_abilities_api_init', $registry );
		}
	}

	public function tear_down(): void {
		$this->uninstall_in_memory_posts_query();
		$this->uninstall_in_memory_term_store();
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_annotations_say_what_each_ability_does(): void {
		$expected = array(
			'cortext/create-page'        => array( false, false, false ),
			'cortext/create-row'         => array( false, false, false ),
			'cortext/update-document'    => array( false, false, true ),
			'cortext/rename-document'    => array( false, false, true ),
			'cortext/move-document'      => array( false, false, true ),
			'cortext/archive-document'   => array( false, false, true ),
			'cortext/unarchive-document' => array( false, false, true ),
			'cortext/trash-document'     => array( false, true, true ),
		);

		foreach ( $expected as $name => list( $readonly, $destructive, $idempotent ) ) {
			$ability = wp_get_ability( $name );
			$this->assertNotNull( $ability, $name );
			$this->assertSame( Abilities::CATEGORY, $ability->get_category(), $name );
			$this->assertTrue( $ability->get_meta_item( 'show_in_rest' ), $name );
			$this->assertSame(
				compact( 'readonly', 'destructive', 'idempotent' ),
				$ability->get_meta_item( 'annotations' ),
				$name
			);
		}
	}

	public function test_create_page_adds_a_private_page_under_the_parent(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id = $this->create_document( 'Parent' );

		$result = $this->run_ability(
			'cortext/create-page',
			array(
				'title'   => 'Meeting notes',
				'content' => '<!-- wp:paragraph --><p>Agenda</p><!-- /wp:paragraph -->',
				'parent'  => $parent_id,
			)
		);

		$post = get_post( $result['id'] );
		$this->assertSame( 'Meeting notes', $result['title'] );
		$this->assertSame( $parent_id, $result['parent'] );
		$this->assertSame( "meeting-notes-{$result['id']}", $result['path'] );
		$this->assertSame( 'private', $post->post_status );
		$this->assertStringContainsString( 'Agenda', $post->post_content );
	}

	public function test_create_page_without_a_title_starts_as_a_draft(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$result = $this->run_ability( 'cortext/create-page' );

		$this->assertSame( 'draft', get_post_status( $result['id'] ) );
		$this->assertSame( 0, $result['parent'] );
	}

	public function test_move_document_puts_it_last_only_when_the_parent_changes(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id   = $this->create_document( 'Parent' );
		$document_id = $this->create_document( 'Child' );
		wp_update_post(
			array(
				'ID'         => $document_id,
				'menu_order' => 7,
			)
		);

		$this->run_ability(
			'cortext/move-document',
			array(
				'id'     => $document_id,
				'parent' => 0,
			)
		);
		$this->assertSame( 7, (int) get_post_field( 'menu_order', $document_id ) );

		$this->run_ability(
			'cortext/move-document',
			array(
				'id'     => $document_id,
				'parent' => $parent_id,
			)
		);
		$this->assertNotSame( 7, (int) get_post_field( 'menu_order', $document_id ) );
	}

	public function test_create_page_and_move_refuse_a_parent_that_is_not_a_live_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$document_id = $this->create_document( 'Child' );
		$trashed_id  = $this->create_document( 'Trashed' );
		wp_trash_post( $trashed_id );
		$post_id = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'A blog post',
			)
		);

		foreach ( array( $trashed_id, $post_id, 999999 ) as $parent_id ) {
			$created = wp_get_ability( 'cortext/create-page' )->execute(
				array(
					'title'  => 'New',
					'parent' => $parent_id,
				)
			);
			$moved   = wp_get_ability( 'cortext/move-document' )->execute(
				array(
					'id'     => $document_id,
					'parent' => $parent_id,
				)
			);

			$this->assertSame( 'cortext_parent_not_found', $created->get_error_code(), (string) $parent_id );
			$this->assertSame( 'cortext_parent_not_found', $moved->get_error_code(), (string) $parent_id );
		}
		$this->assertSame( 0, (int) get_post_field( 'post_parent', $document_id ) );
	}

	public function test_create_page_needs_permission_to_create_documents(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$this->assertPermissionDenied( wp_get_ability( 'cortext/create-page' )->execute( array( 'title' => 'Nope' ) ) );
	}

	public function test_create_row_adds_it_to_the_collection_with_its_property_values(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_document( 'Projects' );
		$field_id      = $this->add_field( $collection_id, 'Owner' );

		$result = $this->run_ability(
			'cortext/create-row',
			array(
				'collection' => $collection_id,
				'title'      => 'Launch',
				'properties' => array( "field-{$field_id}" => 'Ana' ),
			)
		);

		$this->assertSame( 'Launch', $result['title'] );
		$this->assertSame( $collection_id, $result['collection']['id'] );
		$this->assertSame( Documents::KIND_ROW, Documents::kind_for_document( get_post( $result['id'] ) ) );
		$this->assertSame( 'private', get_post_status( $result['id'] ) );
		$this->assertSame( 'Ana', get_post_meta( $result['id'], "field-{$field_id}", true ) );
	}

	public function test_create_row_refuses_a_document_that_is_not_a_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$page_id = $this->create_document( 'Just a page' );

		$result = wp_get_ability( 'cortext/create-row' )->execute( array( 'collection' => $page_id ) );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'cortext_collection_not_found', $result->get_error_code() );
	}

	public function test_create_row_refuses_keys_that_are_not_properties_of_the_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_document( 'Projects' );
		$this->add_field( $collection_id, 'Owner' );
		$other_field = $this->add_field( $this->create_document( 'Other' ), 'Elsewhere' );

		foreach ( array( "field-{$other_field}", 'Owner', 'cortext_fields' ) as $key ) {
			$result = wp_get_ability( 'cortext/create-row' )->execute(
				array(
					'collection' => $collection_id,
					'properties' => array( $key => 'x' ),
				)
			);

			$this->assertInstanceOf( WP_Error::class, $result, $key );
			$this->assertSame( 'cortext_unknown_property', $result->get_error_code(), $key );
		}
	}

	public function test_create_row_refuses_a_collection_in_trash(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_document( 'Projects' );
		$this->add_field( $collection_id, 'Owner' );
		wp_trash_post( $collection_id );

		$result = wp_get_ability( 'cortext/create-row' )->execute( array( 'collection' => $collection_id ) );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'cortext_collection_not_found', $result->get_error_code() );
	}

	public function test_create_row_needs_permission_to_edit_the_collection(): void {
		$collection_id = $this->create_document( 'Not mine', $this->create_user( 'editor' ) );
		$this->add_field( $collection_id, 'Owner' );
		wp_set_current_user( $this->create_user( 'author' ) );

		$this->assertPermissionDenied( wp_get_ability( 'cortext/create-row' )->execute( array( 'collection' => $collection_id ) ) );
	}

	public function test_update_document_changes_only_the_given_properties(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_document( 'Projects' );
		$owner_id      = $this->add_field( $collection_id, 'Owner' );
		$stage_id      = $this->add_field( $collection_id, 'Stage' );
		$row_id        = $this->create_row( $collection_id, 'Launch' );
		update_post_meta( $row_id, "field-{$stage_id}", 'Planning' );

		$result = $this->run_ability(
			'cortext/update-document',
			array(
				'id'         => $row_id,
				'properties' => array( "field-{$owner_id}" => 'Ana' ),
			)
		);

		$this->assertSame( $row_id, $result['id'] );
		$this->assertSame( 'Ana', get_post_meta( $row_id, "field-{$owner_id}", true ) );
		$this->assertSame( 'Planning', get_post_meta( $row_id, "field-{$stage_id}", true ) );
		$this->assertSame( 'Launch', get_post_field( 'post_title', $row_id ) );
	}

	public function test_update_document_rejects_a_property_of_another_collection(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_document( 'Projects' );
		$this->add_field( $collection_id, 'Owner' );
		$other_field = $this->add_field( $this->create_document( 'Other' ), 'Elsewhere' );
		$row_id      = $this->create_row( $collection_id, 'Launch' );

		$result = wp_get_ability( 'cortext/update-document' )->execute(
			array(
				'id'         => $row_id,
				'properties' => array( "field-{$other_field}" => 'x' ),
			)
		);

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'cortext_unknown_property', $result->get_error_code() );
		$this->assertSame( '', get_post_meta( $row_id, "field-{$other_field}", true ) );
	}

	public function test_update_document_refuses_content_and_keys_that_are_not_properties(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_document( 'Projects' );
		$this->add_field( $collection_id, 'Owner' );
		$row_id  = $this->create_row( $collection_id, 'Launch' );
		$page_id = $this->create_document( 'Just a page' );

		$with_content = wp_get_ability( 'cortext/update-document' )->execute(
			array(
				'id'         => $row_id,
				'content'    => 'Replaced',
				'properties' => array(),
			)
		);
		$other_meta   = wp_get_ability( 'cortext/update-document' )->execute(
			array(
				'id'         => $row_id,
				'properties' => array( 'cortext_fields' => '1' ),
			)
		);
		$on_a_page    = wp_get_ability( 'cortext/update-document' )->execute(
			array(
				'id'         => $page_id,
				'properties' => array( 'cortext_fields' => '1' ),
			)
		);

		$this->assertSame( 'ability_invalid_input', $with_content->get_error_code() );
		$this->assertSame( 'cortext_unknown_property', $other_meta->get_error_code() );
		$this->assertSame( 'cortext_unknown_property', $on_a_page->get_error_code() );
		$this->assertSame( array(), get_post_meta( $page_id, 'cortext_fields', false ) );
	}

	public function test_calculated_properties_cannot_be_set(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_document( 'Projects' );
		$field_ids     = array(
			'rollup'  => $this->add_field( $collection_id, 'Total', 'rollup' ),
			'formula' => $this->add_field( $collection_id, 'Margin', 'formula' ),
		);
		$row_id        = $this->create_row( $collection_id, 'Launch' );

		foreach ( $field_ids as $type => $field_id ) {
			$properties = array( "field-{$field_id}" => '5' );

			$created = wp_get_ability( 'cortext/create-row' )->execute(
				array(
					'collection' => $collection_id,
					'properties' => $properties,
				)
			);
			$updated = wp_get_ability( 'cortext/update-document' )->execute(
				array(
					'id'         => $row_id,
					'properties' => $properties,
				)
			);

			$this->assertInstanceOf( WP_Error::class, $created, $type );
			$this->assertSame( 'cortext_calculated_property', $created->get_error_code(), $type );
			$this->assertInstanceOf( WP_Error::class, $updated, $type );
			$this->assertSame( 'cortext_calculated_property', $updated->get_error_code(), $type );
		}
	}

	public function test_a_user_who_cannot_edit_the_document_cannot_change_it(): void {
		$document_id = $this->create_document( 'Theirs', $this->create_user( 'editor' ) );
		wp_set_current_user( $this->create_user( 'author' ) );

		$inputs = array(
			'cortext/update-document'  => array( 'properties' => array() ),
			'cortext/rename-document'  => array( 'title' => 'Mine now' ),
			'cortext/move-document'    => array( 'parent' => 0 ),
			'cortext/archive-document' => array(),
			'cortext/trash-document'   => array(),
		);

		foreach ( $inputs as $name => $input ) {
			$this->assertPermissionDenied( wp_get_ability( $name )->execute( array( 'id' => $document_id ) + $input ), $name );
		}
		$this->assertSame( 'Theirs', get_post_field( 'post_title', $document_id ) );
		$this->assertSame( 'private', get_post_status( $document_id ) );
	}

	public function test_unarchive_needs_permission_to_edit_the_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$document_id = $this->create_document( 'Old' );
		$this->run_ability( 'cortext/archive-document', array( 'id' => $document_id ) );
		wp_set_current_user( $this->create_user( 'author' ) );

		$this->assertPermissionDenied( wp_get_ability( 'cortext/unarchive-document' )->execute( array( 'id' => $document_id ) ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $document_id ) );
	}

	public function test_archived_and_locked_documents_refuse_edits(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$collection_id = $this->create_document( 'Projects' );
		$owner_id      = $this->add_field( $collection_id, 'Owner' );
		$archived_id   = $this->create_row( $collection_id, 'Archived' );
		$this->run_ability( 'cortext/archive-document', array( 'id' => $archived_id ) );
		$frozen_id = $this->create_row( $collection_id, 'Locked' );
		DocumentFreeze::freeze( $frozen_id );

		$expected = array(
			$archived_id => 'cortext_document_archived',
			$frozen_id   => 'cortext_document_frozen',
		);
		foreach ( $expected as $id => $code ) {
			$updated = wp_get_ability( 'cortext/update-document' )->execute(
				array(
					'id'         => $id,
					'properties' => array( "field-{$owner_id}" => 'Changed' ),
				)
			);
			$renamed = wp_get_ability( 'cortext/rename-document' )->execute(
				array(
					'id'    => $id,
					'title' => 'Changed',
				)
			);

			$this->assertInstanceOf( WP_Error::class, $updated );
			$this->assertSame( $code, $updated->get_error_code() );
			$this->assertInstanceOf( WP_Error::class, $renamed );
			$this->assertSame( $code, $renamed->get_error_code() );
			$this->assertSame( '', get_post_meta( $id, "field-{$owner_id}", true ) );
		}
	}

	public function test_rename_document_changes_the_title_and_names_a_draft(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$draft_id = $this->create_document( '', 0, 'draft' );

		$result = $this->run_ability(
			'cortext/rename-document',
			array(
				'id'    => $draft_id,
				'title' => 'Roadmap',
			)
		);

		$this->assertSame( 'Roadmap', $result['title'] );
		$this->assertSame( "roadmap-{$draft_id}", $result['path'] );
		$this->assertSame( 'private', get_post_status( $draft_id ) );
	}

	public function test_move_document_changes_the_parent(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id   = $this->create_document( 'Parent' );
		$document_id = $this->create_document( 'Child' );

		$result = $this->run_ability(
			'cortext/move-document',
			array(
				'id'     => $document_id,
				'parent' => $parent_id,
			)
		);

		$this->assertSame( $parent_id, $result['parent'] );

		$result = $this->run_ability(
			'cortext/move-document',
			array(
				'id'     => $document_id,
				'parent' => 0,
			)
		);

		$this->assertSame( 0, $result['parent'] );
	}

	public function test_move_document_still_moves_a_locked_document(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id   = $this->create_document( 'Parent' );
		$document_id = $this->create_document( 'Locked' );
		DocumentFreeze::freeze( $document_id );

		$result = $this->run_ability(
			'cortext/move-document',
			array(
				'id'     => $document_id,
				'parent' => $parent_id,
			)
		);

		$this->assertSame( $parent_id, $result['parent'] );
	}

	public function test_move_document_refuses_to_move_a_document_under_its_subpage(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id = $this->create_document( 'Parent' );
		$child_id  = $this->create_document( 'Child', 0, 'private', $parent_id );

		foreach ( array( $parent_id, $child_id ) as $target ) {
			$result = wp_get_ability( 'cortext/move-document' )->execute(
				array(
					'id'     => $parent_id,
					'parent' => $target,
				)
			);

			$this->assertInstanceOf( WP_Error::class, $result );
			$this->assertSame( 'cortext_invalid_parent', $result->get_error_code() );
		}
		$this->assertSame( 0, (int) get_post_field( 'post_parent', $parent_id ) );
	}

	public function test_move_document_to_the_top_level_after_saving_one_of_its_subpages(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$grandparent_id = $this->create_document( 'Grandparent' );
		$parent_id      = $this->create_document( 'Parent', 0, 'private', $grandparent_id );
		// The documents route leaves the subpage it just saved as the global post.
		$this->run_ability(
			'cortext/create-page',
			array(
				'title'  => 'Child',
				'parent' => $parent_id,
			)
		);

		$result = $this->run_ability(
			'cortext/move-document',
			array(
				'id'     => $parent_id,
				'parent' => 0,
			)
		);

		$this->assertSame( 0, $result['parent'] );
	}

	public function test_archive_and_unarchive_document_with_its_subpages(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id = $this->create_document( 'Parent' );
		$child_id  = $this->create_document( 'Child', 0, 'private', $parent_id );

		$result = $this->run_ability( 'cortext/archive-document', array( 'id' => $parent_id ) );

		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id ), $result['archived'] );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $parent_id ) );
		$this->assertSame( Documents::STATUS_ARCHIVED, get_post_status( $child_id ) );

		$result = $this->run_ability( 'cortext/unarchive-document', array( 'id' => $parent_id ) );

		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id ), $result['restored'] );
		$this->assertSame( 'private', get_post_status( $parent_id ) );
		$this->assertSame( 'private', get_post_status( $child_id ) );
	}

	public function test_unarchive_reports_the_status_and_the_documents_public_again(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$document_id = $this->create_document( 'Published', 0, 'publish' );
		$this->run_ability( 'cortext/archive-document', array( 'id' => $document_id ) );

		$result = $this->run_ability( 'cortext/unarchive-document', array( 'id' => $document_id ) );

		$this->assertSame( 'publish', $result['status'] );
		$this->assertSame( array( $document_id ), $result['published'] );
	}

	public function test_trash_document_moves_it_to_trash_without_deleting_it(): void {
		wp_set_current_user( $this->create_user( 'administrator' ) );
		$parent_id = $this->create_document( 'Parent' );
		$child_id  = $this->create_document( 'Child', 0, 'private', $parent_id );

		$result = $this->run_ability( 'cortext/trash-document', array( 'id' => $parent_id ) );

		$this->assertSame( $parent_id, $result['trashed'][0] );
		$this->assertEqualsCanonicalizing( array( $parent_id, $child_id ), $result['trashed'] );
		$this->assertNotNull( get_post( $parent_id ) );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $parent_id ) );
		$this->assertSame( Documents::STATUS_TRASH, get_post_status( $child_id ) );

		$again = wp_get_ability( 'cortext/trash-document' )->execute( array( 'id' => $parent_id ) );

		$this->assertInstanceOf( WP_Error::class, $again );
		$this->assertNotNull( get_post( $parent_id ) );
	}

	/**
	 * Runs an ability that has to succeed.
	 *
	 * @param string                   $name  Ability name.
	 * @param array<string,mixed>|null $input Ability input.
	 * @return array<string,mixed>
	 */
	private function run_ability( string $name, ?array $input = null ): array {
		$result = wp_get_ability( $name )->execute( $input );
		$this->assertIsArray( $result, is_wp_error( $result ) ? $result->get_error_message() : $name );
		return $result;
	}

	private function assertPermissionDenied( $result, string $message = '' ): void {
		$this->assertInstanceOf( WP_Error::class, $result, $message );
		$this->assertSame( 'ability_invalid_permissions', $result->get_error_code(), $message );
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

	private function create_document( string $title, int $author = 0, string $status = 'private', int $parent_id = 0 ): int {
		$id = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => $status,
				'post_title'  => $title,
				'post_author' => $author,
				'post_parent' => $parent_id,
			)
		);
		$this->assertGreaterThan( 0, $id );
		return $id;
	}

	/**
	 * Adds a property and registers its meta, so REST writes accept it.
	 *
	 * @param int    $collection_id Collection post ID.
	 * @param string $title         Property name.
	 * @param string $type          Property type.
	 */
	private function add_field( int $collection_id, string $title, string $type = 'text' ): int {
		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'type' => $type ),
			)
		);
		add_post_meta( $collection_id, 'cortext_fields', (string) $field_id );
		$this->document->register_field_meta();
		return $field_id;
	}

	private function create_row( int $collection_id, string $title ): int {
		$id = $this->create_document( $title );
		wp_set_object_terms( $id, array( TraitTaxonomy::term_id_for_trait( $collection_id ) ), TraitTaxonomy::TAXONOMY, false );
		return $id;
	}
}
