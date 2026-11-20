import { useDispatch } from '@wordpress/data';
import { useCallback } from '@wordpress/element';

import { DOCUMENT_POST_TYPE } from '../collections';

/**
 * Creates a row directly through core-data.
 *
 * @param {Function} saveEntityRecord   Core-data save dispatcher.
 * @param {Object}   input              Row values.
 * @param {number}   input.collectionId Collection/trait ID.
 * @param {string}   [input.title]      Initial row title.
 * @param {Object}   [input.meta]       Initial field values.
 * @return {Promise<Object>} Created row record.
 */
export function createRowDocument(
	saveEntityRecord,
	{ collectionId, title = '', meta }
) {
	const payload = {
		status: 'private',
		title,
		cortext_trait: collectionId,
		...( meta && Object.keys( meta ).length ? { meta } : {} ),
	};

	return saveEntityRecord( 'postType', DOCUMENT_POST_TYPE, payload, {
		throwOnError: true,
	} );
}

/**
 * Returns a row creator bound to core-data.
 *
 * @return {Function} Row creation callback.
 */
export function useCreateRowDocument() {
	const { saveEntityRecord } = useDispatch( 'core' );

	return useCallback(
		( input ) => createRowDocument( saveEntityRecord, input ),
		[ saveEntityRecord ]
	);
}
