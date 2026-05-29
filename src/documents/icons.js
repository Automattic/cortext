import { Icon, customPostType, listItem, table } from '@wordpress/icons';

import DocumentIcon from '../components/DocumentIcon';
import { definesTrait, hasTrait } from './capabilities';

/**
 * Sidebar icon for a document record. Pages and collections opt into the
 * shared document-identity meta and render via DocumentIcon; rows take the
 * static post-type glyph.
 *
 * @param {Object} record Document record.
 * @param {number} [size] Icon size in pixels.
 * @return {Object} Rendered React node for the icon.
 */
export function iconForRecord( record, size = 16 ) {
	if ( ! hasTrait( record ) ) {
		const iconMeta = record?.meta?.cortext_document_icon ?? '';
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
		return <Icon icon={ table } size={ size } />;
	}
	if ( hasTrait( record ) ) {
		return <Icon icon={ listItem } size={ size } />;
	}
	return <DocumentIcon icon="" size={ size } />;
}
