export const ROW_SOURCE_COLLECTION_SEARCH_PARAM = 'collection';
export const ROW_SOURCE_DOCUMENT_SEARCH_PARAM = 'collectionRow';

function normalizeCollectionId( value ) {
	const id = Number( value );
	return Number.isInteger( id ) && id > 0 ? id : null;
}

// Use the URL hint only while it is one of the row's active memberships. The
// locator supplies those memberships; a stale/deleted query parameter falls
// back deterministically to the first active collection.
export function activeRowSourceCollectionId( activeIds, requestedId ) {
	const ids = Array.isArray( activeIds )
		? activeIds
				.map( normalizeCollectionId )
				.filter(
					( id, index, all ) => id && all.indexOf( id ) === index
				)
		: [];
	const requested = normalizeCollectionId( requestedId );
	return requested && ids.includes( requested )
		? requested
		: ids[ 0 ] ?? null;
}

// Search params survive unrelated TanStack navigations by default. Scope the
// hint to the row that created it so a later row cannot accidentally inherit
// the same collection context.
export function rowSourceCollectionHint( search, documentId ) {
	const hintedDocumentId = normalizeCollectionId(
		search?.[ ROW_SOURCE_DOCUMENT_SEARCH_PARAM ]
	);
	return hintedDocumentId === normalizeCollectionId( documentId )
		? search?.[ ROW_SOURCE_COLLECTION_SEARCH_PARAM ]
		: null;
}

// TanStack's search updater keeps unrelated query state while setting (or
// explicitly clearing) the source context for a full-page row navigation.
export function rowSourceCollectionSearch( documentId, collectionId ) {
	const normalizedDocumentId = normalizeCollectionId( documentId );
	const normalizedId = normalizeCollectionId( collectionId );
	return ( current = {} ) => {
		const next = { ...current };
		if ( normalizedDocumentId && normalizedId ) {
			next[ ROW_SOURCE_COLLECTION_SEARCH_PARAM ] = normalizedId;
			next[ ROW_SOURCE_DOCUMENT_SEARCH_PARAM ] = normalizedDocumentId;
		} else {
			delete next[ ROW_SOURCE_COLLECTION_SEARCH_PARAM ];
			delete next[ ROW_SOURCE_DOCUMENT_SEARCH_PARAM ];
		}
		return next;
	};
}
