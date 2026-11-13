jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';

import { DOCUMENT_POST_TYPE } from '../../../src/collections';
import {
	duplicateDocumentRecord,
	receiveCanonicalDocumentRecord,
	restoreDocumentRecord,
	trashDocumentRecord,
} from '../../../src/documents/mutations';

describe( 'document mutation cache updates', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'caches a canonical record without invalidating list queries', () => {
		const receiveEntityRecords = jest.fn();
		const record = { id: 17, title: { raw: 'Canonical' } };

		expect(
			receiveCanonicalDocumentRecord( record, receiveEntityRecords )
		).toBe( record );
		expect( receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			[ record ],
			undefined,
			false
		);
	} );

	it( 'ignores missing canonical records', () => {
		const receiveEntityRecords = jest.fn();

		expect(
			receiveCanonicalDocumentRecord( null, receiveEntityRecords )
		).toBeNull();
		expect( receiveEntityRecords ).not.toHaveBeenCalled();
	} );

	it( 'caches only response.post from the duplicate endpoint', async () => {
		const receiveEntityRecords = jest.fn();
		const post = { id: 23, title: { raw: 'Copy' }, status: 'private' };
		const response = {
			id: 23,
			title: 'Copy',
			parent: 0,
			post,
		};
		apiFetch.mockResolvedValue( response );

		await expect(
			duplicateDocumentRecord( { id: 12 }, receiveEntityRecords )
		).resolves.toBe( response );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/12/duplicate',
			method: 'POST',
		} );
		expect( receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			[ post ],
			undefined,
			false
		);
		expect( receiveEntityRecords ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not cache a duplicate when response.post is null', async () => {
		const receiveEntityRecords = jest.fn();
		const response = { id: 23, title: 'Copy', post: null };
		apiFetch.mockResolvedValue( response );

		await expect(
			duplicateDocumentRecord( { id: 12 }, receiveEntityRecords )
		).resolves.toBe( response );

		expect( receiveEntityRecords ).not.toHaveBeenCalled();
	} );

	it( 'caches the canonical top-level record after moving a document to trash', async () => {
		const receiveEntityRecords = jest.fn();
		const response = {
			id: 31,
			status: 'trash',
			title: { raw: 'Trashed document' },
			cascade_deleted: [ 32 ],
		};
		apiFetch.mockResolvedValue( response );

		await expect(
			trashDocumentRecord( { id: 31 }, receiveEntityRecords )
		).resolves.toBe( response );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/wp/v2/crtxt_documents/31',
			method: 'DELETE',
		} );
		expect( receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			[ response ],
			undefined,
			false
		);
	} );

	it( 'caches response.previous from a wrapped delete response', async () => {
		const receiveEntityRecords = jest.fn();
		const previous = { id: 31, status: 'private' };
		const response = { deleted: true, previous };
		apiFetch.mockResolvedValue( response );

		await expect(
			trashDocumentRecord( { id: 31 }, receiveEntityRecords )
		).resolves.toBe( response );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/wp/v2/crtxt_documents/31',
			method: 'DELETE',
		} );
		expect( receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			[ previous ],
			undefined,
			false
		);
	} );

	it( 'caches response.post and returns the full restore response', async () => {
		const receiveEntityRecords = jest.fn();
		const post = { id: 31, status: 'private' };
		const response = { restored: [ 31 ], post };
		apiFetch.mockResolvedValue( response );

		await expect(
			restoreDocumentRecord( { id: 31 }, receiveEntityRecords )
		).resolves.toBe( response );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/31/restore',
			method: 'POST',
		} );
		expect( receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			[ post ],
			undefined,
			false
		);
	} );

	it( 'rejects without caching a record when the custom endpoint fails', async () => {
		const receiveEntityRecords = jest.fn();
		const error = new Error( 'duplicate failed' );
		apiFetch.mockRejectedValue( error );

		await expect(
			duplicateDocumentRecord( { id: 12 }, receiveEntityRecords )
		).rejects.toBe( error );
		expect( receiveEntityRecords ).not.toHaveBeenCalled();
	} );
} );
