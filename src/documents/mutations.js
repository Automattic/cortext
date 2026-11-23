import apiFetch from '@wordpress/api-fetch';

import { DOCUMENT_POST_TYPE } from '../collections';

/**
 * Adds a canonical REST record to the shared core-data cache. Mutation
 * envelopes are partial and must stay out of the cache. List invalidation is
 * left to the caller so bulk actions can refresh each affected query once.
 *
 * @param {Object|null} record               Canonical document record.
 * @param {Function}    receiveEntityRecords core-data dispatcher.
 * @return {Object|null} Cached record, or null when it was not cached.
 */
export function receiveCanonicalDocumentRecord( record, receiveEntityRecords ) {
	if ( ! record?.id || ! receiveEntityRecords ) {
		return null;
	}
	receiveEntityRecords(
		'postType',
		DOCUMENT_POST_TYPE,
		[ record ],
		undefined,
		false
	);
	return record;
}

/**
 * Fetches a document's full record, in the shape core-data keeps it.
 *
 * @param {number} id Document ID.
 * @return {Promise<Object>} REST record in edit context.
 */
export function fetchDocumentRecord( id ) {
	return apiFetch( {
		path: `/wp/v2/crtxt_documents/${ id }?context=edit`,
	} );
}

/**
 * Duplicates a document and caches the canonical record from the response.
 *
 * @param {Object}   record               Document to duplicate.
 * @param {Function} receiveEntityRecords core-data dispatcher.
 * @return {Promise<Object>} Duplicate response.
 */
export async function duplicateDocumentRecord( record, receiveEntityRecords ) {
	const response = await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/duplicate`,
		method: 'POST',
	} );
	receiveCanonicalDocumentRecord( response?.post, receiveEntityRecords );
	return response;
}
