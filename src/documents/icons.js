import { Icon, customPostType } from '@wordpress/icons';

import PageIcon from '../components/PageIcon';

/**
 * Resolve the sidebar icon for a document record. Pages use their
 * `cortext_document_icon` meta; collections keep the static post-type glyph.
 *
 * @param {Object} record Document record (page or collection).
 * @param {string} kind   Resolved document kind.
 * @param {number} [size] Icon size in pixels.
 * @return {Object} Rendered React node for the icon.
 */
export function iconForRecord( record, kind, size = 16 ) {
	if ( kind === 'page' ) {
		const iconMeta = record?.meta?.cortext_document_icon ?? '';
		return <PageIcon icon={ iconMeta } size={ size } />;
	}
	return <Icon icon={ customPostType } size={ size } />;
}
