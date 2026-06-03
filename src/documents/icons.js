import { Icon, customPostType } from '@wordpress/icons';

import DocumentIcon from '../components/DocumentIcon';
import { definesTrait, hasTrait } from './capabilities';

// A collection with no custom icon shows the collection glyph, rendered through
// DocumentIcon (as a named glyph) so it inherits the same 1.4x glyph scale and
// box as a page's document glyph; the glyph is drawn to the page glyph's extent
// so a collection row lines up with a page row instead of reading heavier.
const COLLECTION_ICON = JSON.stringify( { type: 'wp', name: 'collection' } );
// Same idea for a row's list glyph in the compact lists (Recents, Favorites,
// Command Palette), so collection and row icons line up with page icons there.
const ROW_ICON = JSON.stringify( { type: 'wp', name: 'listItem' } );

/**
 * Sidebar-tree icon for a document record. A custom document-identity icon
 * always wins. Without one, a collection shows the collection glyph (through
 * DocumentIcon, so its size matches a page), a row takes the static post-type
 * glyph, and a page falls back to the document glyph.
 *
 * @param {Object} record Document record.
 * @param {number} [size] Icon size in pixels.
 * @return {Object} Rendered React node for the icon.
 */
export function iconForRecord( record, size = 16 ) {
	const iconMeta = record?.meta?.cortext_document_icon ?? '';
	if ( ! iconMeta && definesTrait( record ) ) {
		return <DocumentIcon icon={ COLLECTION_ICON } size={ size } />;
	}
	if ( ! hasTrait( record ) ) {
		return <DocumentIcon icon={ iconMeta } size={ size } />;
	}
	return <Icon icon={ customPostType } size={ size } />;
}

/**
 * Compact-list icon for any document record (Recents, Favorites, Palette).
 * Custom icons on the record win; otherwise a glyph derived from capabilities.
 *
 * @param {?Object} record Document record.
 * @param {number}  [size] Icon size in pixels.
 * @return {?Object} Rendered React node for the icon, or `null`.
 */
export function listIconForRecord( record, size = 16 ) {
	const icon = record?.icon ?? record?.meta?.cortext_document_icon ?? '';
	if ( icon ) {
		return <DocumentIcon icon={ icon } size={ size } />;
	}
	if ( definesTrait( record ) ) {
		return <DocumentIcon icon={ COLLECTION_ICON } size={ size } />;
	}
	if ( hasTrait( record ) ) {
		return <DocumentIcon icon={ ROW_ICON } size={ size } />;
	}
	return <DocumentIcon icon="" size={ size } />;
}
