/**
 * Tests for `src/documents/invalidation.js`.
 */
import {
	HOME_FALLBACK_QUERY,
	POST_TYPE,
} from '../../../src/components/page-queries';
import {
	DOCUMENT_POST_TYPE,
	collectionSearchQuery,
} from '../../../src/collections';
import {
	afterDocumentTrash,
	applyInvalidationPack,
} from '../../../src/documents/invalidation';

describe( 'afterDocumentTrash', () => {
	it( 'refreshes the home fallback so it cannot point at a hidden document', () => {
		const invalidateResolution = jest.fn();

		applyInvalidationPack( invalidateResolution, afterDocumentTrash );

		expect( invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', POST_TYPE, HOME_FALLBACK_QUERY ]
		);
	} );

	it( 'refreshes the collection pickers so a trashed or restored collection does not linger or stay missing', () => {
		const invalidateResolution = jest.fn();

		applyInvalidationPack( invalidateResolution, afterDocumentTrash );

		expect( invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', DOCUMENT_POST_TYPE, collectionSearchQuery( '' ) ]
		);
	} );
} );
