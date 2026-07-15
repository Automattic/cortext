import * as icons from '@wordpress/icons';

import { collectionIcon } from './cortextIcons';

const CORTEXT_DOCUMENT_GLYPHS = {
	collection: collectionIcon,
};

// Public document-icon blocks may store Cortext names such as `collection`, so
// resolve those before falling back to @wordpress/icons.
export default function DocumentIconWp( { name, size = 16 } ) {
	const cortextGlyph = CORTEXT_DOCUMENT_GLYPHS[ name ];
	const Icon = icons.Icon;
	if ( cortextGlyph?.type === 'svg' ) {
		return (
			<svg { ...cortextGlyph.props } width={ size } height={ size }>
				{ cortextGlyph.props.children }
			</svg>
		);
	}

	const Glyph = icons[ name ];
	if ( ! Icon || ! Glyph?.type ) {
		return null;
	}
	return <Icon icon={ Glyph } size={ size } />;
}
