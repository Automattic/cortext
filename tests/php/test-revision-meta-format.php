<?php
/**
 * Tests for Cortext\Editor\RevisionMetaFormat.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Editor\RevisionMetaFormat;
use WorDBless\BaseTestCase;

final class Test_Revision_Meta_Format extends BaseTestCase {

	private const DOCUMENT_POST_TYPE = 'crtxt_document';

	public function set_up(): void {
		parent::set_up();
		register_post_type( self::DOCUMENT_POST_TYPE, array( 'public' => false ) );
		add_post_type_support( self::DOCUMENT_POST_TYPE, 'cortext-document' );
		register_post_type( 'plain_thing', array( 'public' => false ) );
	}

	public function test_register_hooks_the_revision_marker(): void {
		remove_all_actions( '_wp_put_post_revision' );

		( new RevisionMetaFormat() )->register();

		$this->assertNotFalse( has_action( '_wp_put_post_revision' ) );
	}

	public function test_marks_revisions_of_cortext_documents(): void {
		$parent   = (int) wp_insert_post(
			array(
				'post_type'  => self::DOCUMENT_POST_TYPE,
				'post_title' => 'Doc',
			)
		);
		$revision = (int) wp_insert_post(
			array(
				'post_type'   => 'revision',
				'post_status' => 'inherit',
				'post_parent' => $parent,
			)
		);

		$this->assertFalse( RevisionMetaFormat::carries_meta( $revision ) );

		( new RevisionMetaFormat() )->mark_revision( $revision, $parent );

		$this->assertTrue( RevisionMetaFormat::carries_meta( $revision ) );
		$this->assertSame(
			RevisionMetaFormat::VERSION,
			(int) get_post_meta( $revision, RevisionMetaFormat::META_KEY, true )
		);
	}

	public function test_leaves_revisions_of_other_post_types_unmarked(): void {
		$parent   = (int) wp_insert_post(
			array(
				'post_type'  => 'plain_thing',
				'post_title' => 'Thing',
			)
		);
		$revision = (int) wp_insert_post(
			array(
				'post_type'   => 'revision',
				'post_status' => 'inherit',
				'post_parent' => $parent,
			)
		);

		( new RevisionMetaFormat() )->mark_revision( $revision, $parent );

		$this->assertFalse( RevisionMetaFormat::carries_meta( $revision ) );
	}

	public function test_marking_twice_keeps_a_single_value(): void {
		$parent   = (int) wp_insert_post(
			array(
				'post_type'  => self::DOCUMENT_POST_TYPE,
				'post_title' => 'Doc',
			)
		);
		$revision = (int) wp_insert_post(
			array(
				'post_type'   => 'revision',
				'post_status' => 'inherit',
				'post_parent' => $parent,
			)
		);

		$format = new RevisionMetaFormat();
		$format->mark_revision( $revision, $parent );
		$format->mark_revision( $revision, $parent );

		$this->assertCount(
			1,
			get_post_meta( $revision, RevisionMetaFormat::META_KEY, false )
		);
	}
}
