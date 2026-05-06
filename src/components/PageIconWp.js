import * as icons from '@wordpress/icons';

// Renders a single icon from `@wordpress/icons` by export name. Lives in
// its own module so PageIcon can `lazy()` it; the sidebar tree (which
// only ever renders emoji/image icons) doesn't pay the import cost.
export default function PageIconWp( { name, size = 16 } ) {
	const Glyph = icons[ name ];
	if ( ! Glyph || typeof Glyph !== 'object' ) {
		return null;
	}
	return <icons.Icon icon={ Glyph } size={ size } />;
}
