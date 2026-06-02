<?php
/**
 * Whitelist of named colors usable on select/multiselect option chips.
 *
 * Stored on `crtxt_field` option records as a string name (e.g. `"blue"`)
 * and resolved to CSS custom properties on the JS side so chips re-skin
 * under the editor's light/dark theme. Anything outside this list is
 * dropped silently during normalization.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

defined( 'ABSPATH' ) || exit;

final class OptionPalette {

	private const NAMES = array(
		'default',
		'gray',
		'brown',
		'orange',
		'yellow',
		'green',
		'blue',
		'purple',
		'pink',
		'red',
	);

	/**
	 * Returns every palette name. Order is intentional and surfaces in the UI.
	 *
	 * @return array<int,string>
	 */
	public static function names(): array {
		return self::NAMES;
	}

	public static function is_valid( string $name ): bool {
		return in_array( $name, self::NAMES, true );
	}
}
