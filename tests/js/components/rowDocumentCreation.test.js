import { act, renderHook } from '@testing-library/react';

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: jest.fn(),
} ) );

import { useDispatch } from '@wordpress/data';
import {
	createRowDocument,
	useCreateRowDocument,
} from '../../../src/components/rowDocumentCreation';

describe( 'createRowDocument', () => {
	it( 'sends the row creation payload with throwOnError enabled', async () => {
		const saveEntityRecord = jest
			.fn()
			.mockResolvedValue( { id: 44, title: { raw: 'New Ada' } } );

		const created = await createRowDocument( saveEntityRecord, {
			collectionId: 9,
			title: 'New Ada',
			meta: { priority: 'high' },
		} );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			{
				status: 'private',
				title: 'New Ada',
				cortext_trait: 9,
				meta: { priority: 'high' },
			},
			{ throwOnError: true }
		);
		expect( created ).toEqual( {
			id: 44,
			title: { raw: 'New Ada' },
		} );
	} );

	it( 'defaults the title and omits empty meta', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 45 } );

		await createRowDocument( saveEntityRecord, {
			collectionId: 9,
			meta: {},
		} );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			{
				status: 'private',
				title: '',
				cortext_trait: 9,
			},
			{ throwOnError: true }
		);
	} );

	it( 'propagates core-data failures', async () => {
		const error = new Error( 'Save failed.' );
		const saveEntityRecord = jest.fn().mockRejectedValue( error );

		await expect(
			createRowDocument( saveEntityRecord, { collectionId: 9 } )
		).rejects.toBe( error );
	} );
} );

describe( 'useCreateRowDocument', () => {
	it( 'uses the core-data dispatcher', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 46 } );
		useDispatch.mockReturnValue( { saveEntityRecord } );
		const { result } = renderHook( () => useCreateRowDocument() );

		await act( async () => {
			await result.current( {
				collectionId: 9,
				title: 'Grace',
			} );
		} );

		expect( useDispatch ).toHaveBeenCalledWith( 'core' );
		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			{
				status: 'private',
				title: 'Grace',
				cortext_trait: 9,
			},
			{ throwOnError: true }
		);
	} );
} );
