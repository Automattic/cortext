<?php
/**
 * Legacy no-op registration for the `cortext/page-header-actions` block.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

final class PageHeaderActionsBlock {

	public const BLOCK_NAME = 'cortext/page-header-actions';

	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	public function register_block(): void {
		register_block_type(
			self::BLOCK_NAME,
			array(
				'api_version'     => 3,
				'title'           => __( 'Page header actions', 'cortext' ),
				'category'        => 'widgets',
				'icon'            => 'plus',
				'uses_context'    => array( 'postId', 'postType' ),
				'supports'        => array(
					'html'     => false,
					'reusable' => false,
					'multiple' => false,
					'inserter' => false,
				),
				// Legacy editor-only block. New content no longer inserts
				// it, and PageIdentity strips it on save. Keep the empty
				// renderer so older saved comments do not leak frontend
				// markup before their next edit.
				'render_callback' => static function () {
					return '';
				},
			)
		);
	}
}
