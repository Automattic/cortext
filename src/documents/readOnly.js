/**
 * Why a document can't be edited. Mirrors `DocumentWriteGuard` on the server.
 */
export const READ_ONLY_TRASHED = 'trashed';
export const READ_ONLY_ARCHIVED = 'archived';
export const READ_ONLY_FROZEN = 'frozen';

/**
 * Returns why a document record is read-only, or null when it can be edited.
 *
 * Frozen documents show as "Locked" in the UI. A frozen collection keeps
 * its own content and schema but its rows stay editable, so callers that
 * render rows check the state together with the document kind.
 *
 * @param {?Object} record Document record with `status` and `cortext_frozen`.
 * @return {?string} One of the READ_ONLY_* values, or null.
 */
export function getReadOnlyState( record ) {
	switch ( record?.status ) {
		case 'trash':
			return READ_ONLY_TRASHED;
		case 'crtxt_archived':
			return READ_ONLY_ARCHIVED;
	}
	return record?.cortext_frozen ? READ_ONLY_FROZEN : null;
}
