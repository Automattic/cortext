<?php
/**
 * Tests for Cortext\Frontend\MentionRenderer.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Frontend\MentionRenderer;
use Cortext\PostType\Document;
use Cortext\PostType\DocumentIdentity;
use WorDBless\BaseTestCase;

final class Test_Frontend_Mention_Renderer extends BaseTestCase {

	private MentionRenderer $renderer;

	public function set_up(): void {
		parent::set_up();

		( new Document() )->register_post_type();
		$this->renderer = new MentionRenderer();
		wp_set_current_user( $this->create_user( 'administrator' ) );
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_updates_title_and_permalink_snapshot(): void {
		$target = $this->create_document( 'Fresh title' );
		update_post_meta(
			$target,
			DocumentIdentity::META_KEY,
			wp_json_encode(
				array(
					'type'  => 'emoji',
					'value' => 'F',
				)
			)
		);
		$html = sprintf(
			'<p>See <a class="cortext-mention" data-crtxt-mention="%d" href="old">Old title</a>.</p>',
			$target
		);

		$rendered = $this->renderer->refresh_mentions( $html );

		$this->assertStringContainsString( 'data-crtxt-mention="' . $target . '"', $rendered );
		$this->assertStringContainsString( 'data-crtxt-icon-emoji="F"', $rendered );
		$this->assertStringContainsString( 'data-crtxt-path="fresh-title-' . $target . '"', $rendered );
		$this->assertStringContainsString( 'href="' . esc_url( get_permalink( $target ) ) . '"', $rendered );
		$this->assertStringContainsString( '>Fresh title</a>', $rendered );
		$this->assertStringNotContainsString( 'cortext-mention__label', $rendered );
		$this->assertStringNotContainsString( 'Old title', $rendered );
	}

	public function test_renders_wordpress_icon_marker(): void {
		$target = $this->create_document( 'Icon target' );
		update_post_meta(
			$target,
			DocumentIdentity::META_KEY,
			wp_json_encode(
				array(
					'type'  => 'wp',
					'name'  => 'starFilled',
					'color' => 'yellow',
				)
			)
		);
		$html = sprintf(
			'<p><a class="cortext-mention" data-crtxt-mention="%d" href="old">Old title</a></p>',
			$target
		);

		$rendered = $this->renderer->refresh_mentions( $html );

		$this->assertStringContainsString( 'data-crtxt-icon-wp="starFilled"', $rendered );
		$this->assertStringContainsString( 'style="--cortext-mention-icon-color: #eab308;"', $rendered );
	}

	public function test_deleted_target_renders_saved_label_as_missing_mention(): void {
		$target = $this->create_document( 'Gone' );
		wp_delete_post( $target, true );
		$html = sprintf(
			'<p><a class="cortext-mention" data-crtxt-mention="%d" href="old">Snapshot</a></p>',
			$target
		);

		$rendered = $this->renderer->refresh_mentions( $html );

		$this->assertStringContainsString(
			'<span class="cortext-mention cortext-mention--missing">Snapshot</span>',
			$rendered
		);
		$this->assertStringNotContainsString( '<a class="cortext-mention"', $rendered );
	}

	public function test_trashed_target_renders_saved_label_as_missing_mention(): void {
		$target = $this->create_document( 'Trashed' );
		wp_trash_post( $target );
		$html = sprintf(
			'<p><a class="cortext-mention" data-crtxt-mention="%d" href="old">Snapshot</a></p>',
			$target
		);

		$rendered = $this->renderer->refresh_mentions( $html );

		$this->assertStringContainsString(
			'<span class="cortext-mention cortext-mention--missing">Snapshot</span>',
			$rendered
		);
		$this->assertStringNotContainsString( '<a class="cortext-mention"', $rendered );
	}

	public function test_non_document_target_renders_saved_label_as_missing_mention(): void {
		$target = (int) wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_title'  => 'Regular post',
			)
		);
		$html   = sprintf(
			'<p><a class="cortext-mention" data-crtxt-mention="%d" href="old">Snapshot</a></p>',
			$target
		);

		$rendered = $this->renderer->refresh_mentions( $html );

		$this->assertStringContainsString(
			'<span class="cortext-mention cortext-mention--missing">Snapshot</span>',
			$rendered
		);
	}

	public function test_unreadable_private_target_renders_saved_label_as_missing_mention(): void {
		$target = (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Secret title',
				'post_name'   => 'secret-title',
			)
		);
		wp_set_current_user( $this->create_user( 'subscriber' ) );
		$html = sprintf(
			'<p><a class="cortext-mention" data-crtxt-mention="%d" href="old">Snapshot</a></p>',
			$target
		);

		$rendered = $this->renderer->refresh_mentions( $html );

		$this->assertStringContainsString(
			'<span class="cortext-mention cortext-mention--missing">Snapshot</span>',
			$rendered
		);
		$this->assertStringNotContainsString( 'Secret title', $rendered );
	}

	public function test_content_without_mentions_is_unchanged(): void {
		$html = '<p>No mention here.</p>';

		$this->assertSame( $html, $this->renderer->refresh_mentions( $html ) );
	}

	private function create_document( string $title ): int {
		return (int) wp_insert_post(
			array(
				'post_type'   => Document::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => $title,
				'post_name'   => sanitize_title( $title ),
			)
		);
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
