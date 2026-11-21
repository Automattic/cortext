<?php
/**
 * The `cortext/property` block bindings source: fills a block attribute
 * with one of the row's properties, such as an image from a URL property.
 *
 * The editor registers the same source in `src/blocks/property-bindings.js`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Editor;

defined( 'ABSPATH' ) || exit;

use Cortext\Fields\PropertyText;
use Cortext\PostType\Document;
use WP_Block;

final class PropertyBindings {

	public const SOURCE = 'cortext/property';

	/**
	 * Attributes that take the stored value as is, since locale formatting
	 * would break a link or an attachment ID.
	 */
	public const RAW_ATTRIBUTES = array( 'url', 'id', 'linkTarget', 'rel' );

	public function __construct( private PropertyText $property_text = new PropertyText() ) {}

	public function register(): void {
		add_action( 'init', array( $this, 'register_source' ) );
	}

	public function register_source(): void {
		register_block_bindings_source(
			self::SOURCE,
			array(
				'label'              => __( 'Document property', 'cortext' ),
				'uses_context'       => array( 'postId', 'postType' ),
				'get_value_callback' => array( $this, 'get_value' ),
			)
		);
	}

	/**
	 * Returns the property text for a bound attribute.
	 *
	 * @param array    $source_args    Binding args, `key` names the property.
	 * @param WP_Block $block_instance Block being rendered.
	 * @param string   $attribute_name Bound attribute.
	 * @return string|null Null leaves the attribute as saved.
	 */
	public function get_value( array $source_args, WP_Block $block_instance, string $attribute_name ): ?string {
		$key     = (string) ( $source_args['key'] ?? '' );
		$post_id = (int) ( $block_instance->context['postId'] ?? 0 );
		if ( '' === $key || $post_id < 1 || Document::POST_TYPE !== get_post_type( $post_id ) ) {
			return null;
		}
		return $this->property_text->for_row(
			$post_id,
			$key,
			in_array( $attribute_name, self::RAW_ATTRIBUTES, true )
		);
	}
}
