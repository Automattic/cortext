/**
 * Tests for `src/hooks/useFieldMutations.js`. Mocks `@wordpress/api-fetch`
 * and the `core` data store so each test asserts the dispatched action
 * shape and the cache-invalidation calls without going to a real REST
 * endpoint.
 */

import { act, renderHook } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

const mockDispatch = {
	invalidateResolution: jest.fn(),
	saveEntityRecord: jest.fn(),
	deleteEntityRecord: jest.fn(),
};

jest.mock( '@wordpress/data', () => ( {
	useDispatch: jest.fn( () => mockDispatch ),
} ) );

import apiFetch from '@wordpress/api-fetch';
import {
	useCreateField,
	useDuplicateField,
	useRenameField,
	useDeleteField,
} from '../../../src/hooks/useFieldMutations';

beforeEach( () => {
	jest.clearAllMocks();
} );

describe( 'useCreateField', () => {
	it( 'POSTs to the atomic create-and-attach route and invalidates resolvers', async () => {
		apiFetch.mockResolvedValueOnce( {
			id: 99,
			title: 'Status',
			type: 'text',
		} );

		const { result } = renderHook( () => useCreateField( 5 ) );
		let returned;
		await act( async () => {
			returned = await result.current.run( {
				title: 'Status',
				type: 'text',
			} );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/collections/5/fields',
			method: 'POST',
			data: { title: 'Status', type: 'text' },
		} );
		expect( returned ).toEqual( {
			id: 99,
			title: 'Status',
			type: 'text',
		} );
		expect( mockDispatch.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_collection', 5 ]
		);
	} );

	it( 'forwards options on the request body when present', async () => {
		apiFetch.mockResolvedValueOnce( { id: 100 } );
		const { result } = renderHook( () => useCreateField( 5 ) );
		await act( async () => {
			await result.current.run( {
				title: 'Priority',
				type: 'select',
				options: [ { value: 'high', label: 'High' } ],
			} );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/collections/5/fields',
			method: 'POST',
			data: {
				title: 'Priority',
				type: 'select',
				options: [ { value: 'high', label: 'High' } ],
			},
		} );
	} );

	it( 'surfaces errors via `error` and rethrows', async () => {
		const apiError = new Error( 'boom' );
		apiFetch.mockRejectedValueOnce( apiError );

		const { result } = renderHook( () => useCreateField( 5 ) );
		await act( async () => {
			await expect(
				result.current.run( { title: 'X', type: 'text' } )
			).rejects.toThrow( 'boom' );
		} );

		expect( result.current.error ).toBe( apiError );
		expect( mockDispatch.invalidateResolution ).not.toHaveBeenCalled();
	} );
} );

describe( 'useDuplicateField', () => {
	it( 'POSTs to the atomic duplicate route and invalidates resolvers', async () => {
		apiFetch.mockResolvedValueOnce( { id: 50 } );
		const { result } = renderHook( () => useDuplicateField( 7 ) );
		await act( async () => {
			await result.current.run( 42 );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/collections/7/fields/42/duplicate',
			method: 'POST',
		} );
		expect( mockDispatch.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_collection', 7 ]
		);
	} );
} );

describe( 'useRenameField', () => {
	it( 'dispatches saveEntityRecord with the new title', async () => {
		mockDispatch.saveEntityRecord.mockResolvedValueOnce( {
			id: 42,
			title: { raw: 'Renamed', rendered: 'Renamed' },
		} );

		const { result } = renderHook( () => useRenameField() );
		await act( async () => {
			await result.current.run( 42, 'Renamed' );
		} );

		expect( mockDispatch.saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_field',
			{ id: 42, title: 'Renamed' }
		);
	} );

	it( 'surfaces a rename failure when saveEntityRecord returns falsy', async () => {
		mockDispatch.saveEntityRecord.mockResolvedValueOnce( undefined );

		const { result } = renderHook( () => useRenameField() );
		await act( async () => {
			await expect(
				result.current.run( 42, 'X' )
			).rejects.toThrow( 'cortext_rename_failed' );
		} );

		expect( result.current.error ).toEqual(
			new Error( 'cortext_rename_failed' )
		);
	} );
} );

describe( 'useDeleteField', () => {
	it( 'dispatches deleteEntityRecord with force: true and invalidates the collection', async () => {
		mockDispatch.deleteEntityRecord.mockResolvedValueOnce( { previous: { id: 42 } } );

		const { result } = renderHook( () => useDeleteField( 5 ) );
		await act( async () => {
			await result.current.run( 42 );
		} );

		expect( mockDispatch.deleteEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_field',
			42,
			{ force: true }
		);
		expect( mockDispatch.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_collection', 5 ]
		);
	} );

	it( 'surfaces a delete failure when deleteEntityRecord returns falsy', async () => {
		mockDispatch.deleteEntityRecord.mockResolvedValueOnce( undefined );

		const { result } = renderHook( () => useDeleteField( 5 ) );
		await act( async () => {
			await expect( result.current.run( 42 ) ).rejects.toThrow(
				'cortext_delete_failed'
			);
		} );

		expect( result.current.error ).toEqual(
			new Error( 'cortext_delete_failed' )
		);
		expect( mockDispatch.invalidateResolution ).not.toHaveBeenCalled();
	} );
} );
