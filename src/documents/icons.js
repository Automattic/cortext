import { Icon, customPostType } from '@wordpress/icons';

import PageIcon from '../components/PageIcon';

/**
 * Resolve the sidebar icon for a document record. Pages and full-page
 * collections both opt into the shared document-identity meta, so they
 * render through PageIcon with the same icon shapes (emoji, uploaded
 * image, wp-icon). Anything else (rows etc.) keeps the static post-type
 * glyph.
 *
 * @param {Object} record Document record (page or collection).
 * @param {string} kind   Resolved document kind.
 * @param {number} [size] Icon size in pixels.
 * @return {Object} Rendered React node for the icon.
 */
export function iconForRecord( record, kind, size = 16 ) {
	if ( kind === 'page' || kind === 'collection' ) {
		const iconMeta = record?.meta?.cortext_document_icon ?? '';
		return <PageIcon icon={ iconMeta } size={ size } />;
	}
	return <Icon icon={ customPostType } size={ size } />;
}
