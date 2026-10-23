import {
	rowDocumentFieldPayload,
	saveRowDocumentField,
} from '../../../src/components/rowDocumentMutations';
import { DOCUMENT_POST_TYPE } from '../../../src/collections';

describe( 'rowDocumentMutations', () => {
	it( 'saves title as a top-level document attribute', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 9 } );

		const saved = await saveRowDocumentField(
			saveEntityRecord,
			9,
			'title',
			'New title'
		);

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ id: 9, title: 'New title' },
			{ throwOnError: true }
		);
		expect( saved ).toEqual( { id: 9 } );
	} );

	it( 'saves only the changed collection field in meta', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 9 } );

		expect( rowDocumentFieldPayload( 'field-7', 'Open' ) ).toEqual( {
			meta: { 'field-7': 'Open' },
		} );

		await saveRowDocumentField( saveEntityRecord, 9, 'field-7', 'Open' );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ id: 9, meta: { 'field-7': 'Open' } },
			{ throwOnError: true }
		);
	} );

	it( 'rejects with the original error when saving a field fails', async () => {
		const error = new Error( 'Save failed' );
		const saveEntityRecord = jest.fn().mockRejectedValue( error );

		await expect(
			saveRowDocumentField( saveEntityRecord, 9, 'field-7', 'Blocked' )
		).rejects.toBe( error );
	} );
} );
