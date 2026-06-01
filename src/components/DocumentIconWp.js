import * as icons from '@wordpress/icons';
import { isValidElement } from '@wordpress/element';

import { CORTEXT_GLYPHS } from './cortextIcons';

// Resolve a glyph by name: Cortext's own glyphs first, then @wordpress/icons.
// Keeping this in the lazy module means sidebar rows that only use emoji or
// images do not load the whole icon namespace.
export default function DocumentIconWp( { name, size = 16 } ) {
	const Glyph = CORTEXT_GLYPHS[ name ] ?? icons[ name ];
	const Icon = icons.Icon;
	if ( ! Icon || ! isValidElement( Glyph ) || ! Glyph.type ) {
		return null;
	}
	return <Icon icon={ Glyph } size={ size } />;
}
