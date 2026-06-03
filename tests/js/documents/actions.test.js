/**
 * Tests for `src/documents/actions.js`.
 *
 * `createDocument` is a pure persist + invalidate action. Post-create UX
 * (navigation, auto-rename, picker selection) is the caller's responsibility.
 * `useCreateDocument` is the standalone hook that wires the core-data
 * dispatchers and binds them to `createDocument`.
 */

import { renderHook, act } from '@testing-library/react';

jest.mock( '@wordpress/data', () => {
	const useDispatch = jest.fn();
	return { __esModule: true, useDispatch };
} );

import { useDispatch } from '@wordpress/data';
import {
	createDocument,
	useCreateCollectionDocument,
	useCreateDocument,
} from '../../../src/documents/actions';
import { DOCUMENT_POST_TYPE } from '../../../src/collections';
import { afterDocumentTrash } from '../../../src/documents/invalidation';

function makeCtx( overrides = {} ) {
	return {
		saveEntityRecord: jest.fn(),
		invalidateResolution: jest.fn(),
		...overrides,
	};
}

describe( 'createDocument', () => {
	it( 'persists with `status: draft` by default and returns the created record', async () => {
		const ctx = makeCtx();
		ctx.saveEntityRecord.mockResolvedValue( {
			id: 42,
			slug: 'untitled',
		} );

		const result = await createDocument( {}, ctx );

		expect( ctx.saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ status: 'draft' }
		);
		expect( result ).toEqual( { id: 42, slug: 'untitled' } );
	} );

	it( 'merges the caller payload over the default status', async () => {
		const ctx = makeCtx();
		ctx.saveEntityRecord.mockResolvedValue( { id: 7 } );

		await createDocument(
			{ title: 'Untitled', status: 'private', parent: 3 },
			ctx
		);

		expect( ctx.saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ title: 'Untitled', status: 'private', parent: 3 }
		);
	} );

	it( 'invalidates the same lists as trash/duplicate', async () => {
		const ctx = makeCtx();
		ctx.saveEntityRecord.mockResolvedValue( { id: 9 } );

		await createDocument( {}, ctx );

		expect( ctx.invalidateResolution ).toHaveBeenCalledTimes(
			afterDocumentTrash.length
		);
		afterDocumentTrash.forEach( ( [ selector, args ], index ) => {
			expect( ctx.invalidateResolution ).toHaveBeenNthCalledWith(
				index + 1,
				selector,
				args
			);
		} );
	} );

	it( 'skips invalidation when no id comes back', async () => {
		const ctx = makeCtx();
		ctx.saveEntityRecord.mockResolvedValue( null );

		const result = await createDocument( {}, ctx );

		expect( result ).toBeNull();
		expect( ctx.invalidateResolution ).not.toHaveBeenCalled();
	} );
} );

describe( 'useCreateDocument', () => {
	beforeEach( () => {
		useDispatch.mockReset();
	} );

	it( 'binds core-data dispatchers and calls saveEntityRecord on invocation', async () => {
		const saveEntityRecord = jest
			.fn()
			.mockResolvedValue( { id: 11, slug: 'about' } );
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			saveEntityRecord,
			invalidateResolution,
		} );

		const { result } = renderHook( () => useCreateDocument() );

		let created;
		await act( async () => {
			created = await result.current( { title: 'About' } );
		} );

		expect( useDispatch ).toHaveBeenCalledWith( 'core' );
		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ status: 'draft', title: 'About' }
		);
		expect( invalidateResolution ).toHaveBeenCalledTimes(
			afterDocumentTrash.length
		);
		expect( created ).toEqual( { id: 11, slug: 'about' } );
	} );

	it( 'defaults input to an empty object', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 5 } );
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			saveEntityRecord,
			invalidateResolution,
		} );

		const { result } = renderHook( () => useCreateDocument() );

		await act( async () => {
			await result.current();
		} );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ status: 'draft' }
		);
	} );
} );

describe( 'useCreateCollectionDocument', () => {
	beforeEach( () => {
		useDispatch.mockReset();
	} );

	it( 'adds cortext_collection to the caller payload', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 21 } );
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			saveEntityRecord,
			invalidateResolution,
		} );

		const { result } = renderHook( () => useCreateCollectionDocument() );

		await act( async () => {
			await result.current( { title: 'Tasks', parent: 3 } );
		} );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{
				status: 'draft',
				title: 'Tasks',
				parent: 3,
				cortext_collection: true,
			}
		);
	} );

	it( 'creates a draft with only the collection flag by default', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 22 } );
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			saveEntityRecord,
			invalidateResolution,
		} );

		const { result } = renderHook( () => useCreateCollectionDocument() );

		await act( async () => {
			await result.current();
		} );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ status: 'draft', cortext_collection: true }
		);
	} );
} );
