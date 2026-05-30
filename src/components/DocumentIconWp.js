import * as icons from '@wordpress/icons';
import { isValidElement } from '@wordpress/element';

// Renders a single icon from `@wordpress/icons` by export name. Lives in
// its own module so DocumentIcon can `lazy()` it; the sidebar tree (which
// only ever renders emoji/image icons) doesn't pay the import cost.
export default function DocumentIconWp( { name, size = 16 } ) {
	const Glyph = icons[ name ];
	const Icon = icons.Icon;
	if ( ! Icon || ! isValidElement( Glyph ) || ! Glyph.type ) {
		return null;
	}
	return <Icon icon={ Glyph } size={ size } />;
}
