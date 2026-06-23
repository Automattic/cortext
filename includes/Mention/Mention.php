<?php
/**
 * Shared contract for Cortext inline mention markup.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Mention;

defined( 'ABSPATH' ) || exit;

/**
 * Inline mentions persist as an anchor carrying the target document id in a data
 * attribute. The public renderer and the backlinks index both parse that markup,
 * so the attribute name and id pattern live here as the single source of truth.
 */
final class Mention {

	public const ATTRIBUTE = 'data-crtxt-mention';

	// Matches a mention anchor's quoted target id; capture group 2 is the id.
	public const ID_PATTERN = '/' . self::ATTRIBUTE . '=(["\'])(\d+)\1/';
}
