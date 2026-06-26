<?php
/**
 * Markup shared by Cortext inline mentions.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Mention;

defined( 'ABSPATH' ) || exit;

/**
 * Mentions are saved as anchors with the target document id in a data attribute.
 * The public renderer and backlink index both parse that shape, so keep the
 * attribute name and id regex together.
 */
final class Mention {

	public const ATTRIBUTE = 'data-crtxt-mention';

	// Matches a mention anchor's quoted target id; capture group 2 is the id.
	public const ID_PATTERN = '/' . self::ATTRIBUTE . '=(["\'])(\d+)\1/';
}
