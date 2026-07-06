import * as icons from '@wordpress/icons';
import { isValidElement } from '@wordpress/element';

import { CORTEXT_GLYPHS } from './cortextIcons';

// Resolve a saved named glyph. Public document-icon blocks also hydrate
// Cortext-owned names such as `collection`, so check those before falling back
// to the full @wordpress/icons namespace.
export default function DocumentIconWp( { name, size = 16 } ) {
	const Glyph = CORTEXT_GLYPHS[ name ] ?? icons[ name ];
	const Icon = icons.Icon;
	if ( ! Icon || ! isValidElement( Glyph ) || ! Glyph.type ) {
		return null;
	}
	return <Icon icon={ Glyph } size={ size } />;
}
