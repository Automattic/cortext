import apiFetch from '@wordpress/api-fetch';

import { DOCUMENT_POST_TYPE } from '../collections';
import { notifyDocumentLocatorChanged } from '../hooks/documentLocatorInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';

/**
 * Replaces a document's traits through `PUT /cortext/v1/documents/<id>/traits`
 * and tells the rest of the app.
 *
 * The PUT replaces the whole set, so `collectionIds` must carry every current
 * membership, including the ones the user cannot see or that are retired.
 *
 * @param {number}   documentId           Document whose traits change.
 * @param {number[]} collectionIds        The complete new set.
 * @param {Function} invalidateResolution core-data's `invalidateResolution`.
 * @return {Promise<Object>} The endpoint response.
 */
export async function writeDocumentTraits(
	documentId,
	collectionIds,
	invalidateResolution
) {
	const response = await apiFetch( {
		path: `/cortext/v1/documents/${ documentId }/traits`,
		method: 'PUT',
		data: { collection_ids: collectionIds },
	} );
	const activeIds = Array.isArray( response?.collections )
		? response.collections
				.filter( ( collection ) => collection?.active !== false )
				.map( ( collection ) => collection?.id )
		: null;
	// Also refreshes every `useDocumentTraits` reading this document.
	notifyDocumentLocatorChanged( documentId, activeIds );
	// Membership changes can update reverse relations and rollups in
	// collections beyond the one directly added or removed.
	notifyCollectionRowsChanged();
	// The breadcrumb chips read `crtxt_trait` off the core-data document
	// record, which this custom-endpoint write does not touch.
	invalidateResolution( 'getEntityRecord', [
		'postType',
		DOCUMENT_POST_TYPE,
		documentId,
	] );
	return response;
}
