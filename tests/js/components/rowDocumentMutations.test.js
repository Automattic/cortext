import apiFetch from '@wordpress/api-fetch';

import {
	rowDocumentFieldPayload,
	saveRowDocumentField,
} from '../../../src/components/rowDocumentMutations';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

describe( 'rowDocumentMutations', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'saves title as a top-level document attribute', async () => {
		apiFetch.mockResolvedValue( { id: 9 } );

		await saveRowDocumentField( 9, 'title', 'New title' );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/wp/v2/crtxt_documents/9',
			method: 'POST',
			data: { title: 'New title' },
		} );
	} );

	it( 'saves collection fields as meta patches', () => {
		expect( rowDocumentFieldPayload( 'field-7', 'Open' ) ).toEqual( {
			meta: { 'field-7': 'Open' },
		} );
	} );
} );
