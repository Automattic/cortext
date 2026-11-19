import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';

import { DOCUMENT_POST_TYPE } from '../collections';
import { getReadOnlyState } from './readOnly';

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
		cortext_frozen: editor.getCurrentPostAttribute( 'cortext_frozen' ),
	} );
}

/**
 * Who froze a document and when (`frozen_at`, `frozen_by`), read from
 * core-data. Null when the document isn't frozen ("Locked" in the UI).
 *
 * @param {?number} postId Document ID.
 * @return {?Object} The `cortext_frozen` field, or null.
 */
export function useFrozenDetails( postId ) {
	return useSelect(
		( select ) =>
			( postId &&
				select( coreStore ).getEntityRecord(
					'postType',
					DOCUMENT_POST_TYPE,
					postId
				)?.cortext_frozen ) ||
			null,
		[ postId ]
	);
}

/**
 * Whether a document is frozen ("Locked" in the UI).
 *
 * @param {?number} postId Document ID.
 * @return {boolean} True when the document is frozen.
 */
export function useIsDocumentFrozen( postId ) {
	return Boolean( useFrozenDetails( postId ) );
}
