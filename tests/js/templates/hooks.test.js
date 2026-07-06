import { act, renderHook, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: jest.fn(),
} ) );

import { useDispatch } from '@wordpress/data';
import { afterDocumentTrash } from '../../../src/documents/invalidation';
import {
	notifyTemplatesChanged,
	useCreateTemplate,
	useCreateTemplateFromDocument,
	useDefaultPageTemplate,
	useDuplicateTemplate,
	useInstantiateTemplate,
	useTemplates,
} from '../../../src/templates/hooks';

beforeEach( () => {
	apiFetch.mockReset();
	useDispatch.mockReset();
} );

describe( 'template hooks', () => {
	it( 'loads and refreshes templates for a kind and collection', async () => {
		apiFetch
			.mockResolvedValueOnce( { templates: [ { id: 1 } ] } )
			.mockResolvedValueOnce( { templates: [ { id: 2 } ] } );

		const { result } = renderHook( () =>
			useTemplates( { kind: 'row', collectionId: 7 } )
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		expect( result.current.templates ).toEqual( [ { id: 1 } ] );

		let refreshed;
		await act( async () => {
			refreshed = await result.current.refresh();
		} );

		expect( refreshed ).toEqual( [ { id: 2 } ] );
		expect( result.current.templates ).toEqual( [ { id: 2 } ] );
		expect( apiFetch ).toHaveBeenNthCalledWith( 1, {
			path: '/cortext/v1/templates?kind=row&collection_id=7',
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 2, {
			path: '/cortext/v1/templates?kind=row&collection_id=7',
		} );
	} );

	it( 'refreshes matching template queries after a template change event', async () => {
		apiFetch
			.mockResolvedValueOnce( { templates: [ { id: 1 } ] } )
			.mockResolvedValueOnce( { templates: [ { id: 2 } ] } );

		const { result } = renderHook( () =>
			useTemplates( { kind: 'row', collectionId: 7 } )
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		await act( async () => {
			notifyTemplatesChanged( { kind: 'row', collectionId: 7 } );
		} );

		await waitFor( () =>
			expect( result.current.templates ).toEqual( [ { id: 2 } ] )
		);
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'loads and updates the workspace page default template', async () => {
		apiFetch
			.mockResolvedValueOnce( { template: { id: 4 } } )
			.mockResolvedValueOnce( { template: { id: 8 } } );

		const { result } = renderHook( () => useDefaultPageTemplate() );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		expect( result.current.template ).toEqual( { id: 4 } );

		let next;
		await act( async () => {
			next = await result.current.setDefault( 8 );
		} );

		expect( next ).toEqual( { id: 8 } );
		expect( result.current.template ).toEqual( { id: 8 } );
		expect( apiFetch ).toHaveBeenNthCalledWith( 2, {
			path: '/cortext/v1/templates/default',
			method: 'PUT',
			data: { id: 8 },
		} );
	} );

	it( 'exposes create, create-from-document, and duplicate mutation hooks', async () => {
		apiFetch
			.mockResolvedValueOnce( { template: { id: 14 } } )
			.mockResolvedValueOnce( { template: { id: 16 } } )
			.mockResolvedValueOnce( { template: { id: 15 } } );

		const { result: createResult } = renderHook( () =>
			useCreateTemplate()
		);
		const { result: createFromDocumentResult } = renderHook( () =>
			useCreateTemplateFromDocument()
		);
		const { result: duplicateResult } = renderHook( () =>
			useDuplicateTemplate()
		);

		await expect(
			createResult.current( { kind: 'page', title: 'Brief' } )
		).resolves.toEqual( { id: 14 } );
		await expect( createFromDocumentResult.current( 23 ) ).resolves.toEqual(
			{ id: 16 }
		);
		await expect( duplicateResult.current( 14 ) ).resolves.toEqual( {
			id: 15,
		} );

		expect( apiFetch ).toHaveBeenNthCalledWith( 1, {
			path: '/cortext/v1/templates',
			method: 'POST',
			data: { kind: 'page', title: 'Brief' },
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 2, {
			path: '/cortext/v1/templates/from-document',
			method: 'POST',
			data: { document_id: 23 },
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 3, {
			path: '/cortext/v1/templates/14/duplicate',
			method: 'POST',
		} );
	} );

	it( 'invalidates document lists after instantiating a template', async () => {
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( { invalidateResolution } );
		apiFetch.mockResolvedValueOnce( { document: { id: 11 } } );

		const { result } = renderHook( () => useInstantiateTemplate() );

		await act( async () => {
			await result.current( 9, { parent: 3 } );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/templates/9/instantiate',
			method: 'POST',
			data: { parent: 3 },
		} );
		expect( invalidateResolution ).toHaveBeenCalledTimes(
			afterDocumentTrash.length
		);
	} );
} );
