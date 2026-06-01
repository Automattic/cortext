import * as icons from '@wordpress/icons';
import { isValidElement } from '@wordpress/element';

// Resolve one @wordpress/icons export by name. Keeping this in the lazy module
// means sidebar rows that only use emoji or images do not load the whole icon
// namespace.
export default function DocumentIconWp( { name, size = 16 } ) {
	const Glyph = icons[ name ];
	const Icon = icons.Icon;
	if ( ! Icon || ! isValidElement( Glyph ) || ! Glyph.type ) {
		return null;
	}
	return <Icon icon={ Glyph } size={ size } />;
}
