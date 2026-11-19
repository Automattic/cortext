import { store as editorStore } from '@wordpress/editor';

/**
 * Why a document can't be edited. Mirrors `DocumentWriteGuard` on the server.
 */
export const READ_ONLY_TRASHED = 'trashed';
export const READ_ONLY_ARCHIVED = 'archived';

/**
 * Returns why a document record is read-only, or null when it can be edited.
 *
 * @param {?Object} record Document record with at least `status`.
 * @return {?string} One of the READ_ONLY_* values, or null.
 */
export function getReadOnlyState( record ) {
	switch ( record?.status ) {
		case 'trash':
			return READ_ONLY_TRASHED;
		case 'crtxt_archived':
			return READ_ONLY_ARCHIVED;
		default:
			return null;
	}
}

/**
 * Selector form of `getReadOnlyState` for the post loaded in core/editor.
 *
 * @param {Function} select Registry select function.
 * @return {?string} One of the READ_ONLY_* values, or null.
 */
export function selectCurrentPostReadOnlyState( select ) {
	const editor = select( editorStore );
	return getReadOnlyState( {
		status: editor.getCurrentPostAttribute( 'status' ),
	} );
}
