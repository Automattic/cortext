import {
	ACTIVE_PAGES_QUERY,
	HOME_FALLBACK_QUERY,
	POST_TYPE,
	PUBLISHED_DOCUMENTS_QUERY,
	TRASHED_PAGES_QUERY,
} from '../../../src/components/page-queries';
import {
	DOCUMENT_POST_TYPE,
	FULL_PAGE_COLLECTION_QUERY,
} from '../../../src/collections';
import {
	afterDocumentTrash,
	afterRowLifecycle,
	applyInvalidationPack,
} from '../../../src/documents/invalidation';

describe( 'document lifecycle invalidation', () => {
	it( 'targets every document list affected by a page lifecycle change', () => {
		expect( afterDocumentTrash ).toEqual( [
			[
				'getEntityRecords',
				[ 'postType', POST_TYPE, ACTIVE_PAGES_QUERY ],
			],
			[
				'getEntityRecords',
				[ 'postType', POST_TYPE, TRASHED_PAGES_QUERY ],
			],
			[
				'getEntityRecords',
				[ 'postType', DOCUMENT_POST_TYPE, FULL_PAGE_COLLECTION_QUERY ],
			],
			[
				'getEntityRecords',
				[ 'postType', DOCUMENT_POST_TYPE, PUBLISHED_DOCUMENTS_QUERY ],
			],
			[
				'getEntityRecords',
				[ 'postType', POST_TYPE, HOME_FALLBACK_QUERY ],
			],
		] );
	} );

	it( 'invalidates only the core-data list that contains rows', () => {
		expect( afterRowLifecycle ).toEqual( [
			[
				'getEntityRecords',
				[ 'postType', DOCUMENT_POST_TYPE, PUBLISHED_DOCUMENTS_QUERY ],
			],
		] );
	} );

	it( 'dispatches each targeted invalidation once', () => {
		const invalidateResolution = jest.fn();

		applyInvalidationPack( invalidateResolution, afterRowLifecycle );

		expect( invalidateResolution ).toHaveBeenCalledTimes( 1 );
		expect( invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', DOCUMENT_POST_TYPE, PUBLISHED_DOCUMENTS_QUERY ]
		);
	} );
} );
