<?php
/**
 * Cortext block patterns.
 *
 * Registers the `cortext` pattern category and auto-loads every
 * `patterns/*.php` file as a block pattern. Each pattern file carries a
 * header comment (Title, Slug, Categories, Description) and echoes block
 * markup for its body. Inline styles on the pattern markup reference the
 * shell token contract so patterns inherit the workspace's look on both
 * the admin canvas and the public frontend.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Theming;

final class Patterns {

	public const CATEGORY = 'cortext';

	public function register(): void {
		add_action( 'init', array( $this, 'register_category' ) );
		add_action( 'init', array( $this, 'register_patterns' ) );
	}

	public function register_category(): void {
		register_block_pattern_category(
			self::CATEGORY,
			array( 'label' => __( 'Cortext', 'cortext' ) )
		);
	}

	public function register_patterns(): void {
		$files = glob( CORTEXT_PATH . 'patterns/*.php' );
		if ( empty( $files ) ) {
			return;
		}

		foreach ( $files as $file ) {
			$headers = get_file_data(
				$file,
				array(
					'title'       => 'Title',
					'slug'        => 'Slug',
					'description' => 'Description',
					'categories'  => 'Categories',
				)
			);

			if ( empty( $headers['slug'] ) ) {
				continue;
			}

			ob_start();
			include $file;
			$content = ob_get_clean();

			$categories = array_filter(
				array_map( 'trim', explode( ',', (string) $headers['categories'] ) )
			);
			if ( empty( $categories ) ) {
				$categories = array( self::CATEGORY );
			}

			register_block_pattern(
				$headers['slug'],
				array(
					'title'       => $headers['title'],
					'description' => $headers['description'],
					'categories'  => $categories,
					'content'     => $content,
				)
			);
		}
	}
}
