export const DOCUMENT_POST_TYPE = 'crtxt_document';

export const COLLECTION_QUERY = {
	per_page: 100,
	context: 'edit',
	status: [ 'draft', 'private', 'publish' ],
	cortext_collections: 1,
};

export const FULL_PAGE_COLLECTION_QUERY = COLLECTION_QUERY;
