import * as icons from '@wordpress/icons';
import { isValidElement } from '@wordpress/element';

// Resolve a WordPress glyph by saved name. Cortext's own glyphs are handled in
// DocumentIcon so this lazy chunk only needs the full @wordpress/icons namespace.
export default function DocumentIconWp( { name, size = 16 } ) {
	const Glyph = icons[ name ];
	const Icon = icons.Icon;
	if ( ! Icon || ! isValidElement( Glyph ) || ! Glyph.type ) {
		return null;
	}
	return <Icon icon={ Glyph } size={ size } />;
}
