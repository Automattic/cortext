export function makeRowDocumentContext( {
	documentId,
	collectionId,
	fields,
	allFields,
	detailLayoutEntries,
	row,
	isResolving = false,
} ) {
	if ( ! documentId || ! collectionId ) {
		return null;
	}
	return {
		documentId: Number( documentId ),
		collectionId,
		fields,
		allFields,
		detailLayoutEntries,
		row,
		isResolving,
	};
}

export function rememberRowDocumentContext( cache, context ) {
	if ( ! cache || ! context?.documentId ) {
		return;
	}
	cache.set( Number( context.documentId ), context );
}

export function rowDocumentContextForEditorPost(
	cache,
	editorPostId,
	currentContext
) {
	if ( ! editorPostId ) {
		return null;
	}
	const documentId = Number( editorPostId );
	if ( currentContext?.documentId === documentId ) {
		return currentContext;
	}
	return cache?.get( documentId ) ?? null;
}
