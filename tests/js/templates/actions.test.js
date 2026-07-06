import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import {
	createTemplate,
	createTemplateFromDocument,
	deleteTemplate,
	duplicateTemplate,
	fetchDefaultPageTemplate,
	fetchTemplates,
	instantiateTemplate,
	setDefaultPageTemplate,
	updateTemplate,
} from '../../../src/templates/actions';

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'template REST actions', () => {
	it( 'fetches templates with kind and collection filters', async () => {
		apiFetch.mockResolvedValueOnce( {
			templates: [ { id: 1, kind: 'row' } ],
		} );

		const templates = await fetchTemplates( {
			kind: 'row',
			collectionId: 7,
		} );

		expect( templates ).toEqual( [ { id: 1, kind: 'row' } ] );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/templates?kind=row&collection_id=7',
		} );
	} );

	it( 'creates, updates, duplicates, deletes, and instantiates templates through the shared endpoint', async () => {
		apiFetch
			.mockResolvedValueOnce( { template: { id: 2 } } )
			.mockResolvedValueOnce( { template: { id: 2, title: 'Renamed' } } )
			.mockResolvedValueOnce( { template: { id: 3 } } )
			.mockResolvedValueOnce( { deleted: true } )
			.mockResolvedValueOnce( { document: { id: 4 } } );

		await expect(
			createTemplate( { kind: 'page', title: 'Brief' } )
		).resolves.toEqual( { id: 2 } );
		await expect(
			updateTemplate( 2, { title: 'Renamed' } )
		).resolves.toEqual( { id: 2, title: 'Renamed' } );
		await expect( duplicateTemplate( 2 ) ).resolves.toEqual( { id: 3 } );
		await expect( deleteTemplate( 2 ) ).resolves.toEqual( {
			deleted: true,
		} );
		await expect(
			instantiateTemplate( 3, { parent: 9 } )
		).resolves.toEqual( { id: 4 } );

		expect( apiFetch ).toHaveBeenNthCalledWith( 1, {
			path: '/cortext/v1/templates',
			method: 'POST',
			data: { kind: 'page', title: 'Brief' },
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 2, {
			path: '/cortext/v1/templates/2',
			method: 'POST',
			data: { title: 'Renamed' },
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 3, {
			path: '/cortext/v1/templates/2/duplicate',
			method: 'POST',
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 4, {
			path: '/cortext/v1/templates/2',
			method: 'DELETE',
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 5, {
			path: '/cortext/v1/templates/3/instantiate',
			method: 'POST',
			data: { parent: 9 },
		} );
	} );

	it( 'creates a template from an existing document', async () => {
		apiFetch.mockResolvedValueOnce( { template: { id: 12 } } );

		await expect( createTemplateFromDocument( 42 ) ).resolves.toEqual( {
			id: 12,
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/templates/from-document',
			method: 'POST',
			data: { document_id: 42 },
		} );
	} );

	it( 'gets and sets the workspace page default template', async () => {
		apiFetch
			.mockResolvedValueOnce( { template: { id: 5 } } )
			.mockResolvedValueOnce( { template: null } );

		await expect( fetchDefaultPageTemplate() ).resolves.toEqual( {
			id: 5,
		} );
		await expect( setDefaultPageTemplate( null ) ).resolves.toBeNull();

		expect( apiFetch ).toHaveBeenNthCalledWith( 1, {
			path: '/cortext/v1/templates/default',
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 2, {
			path: '/cortext/v1/templates/default',
			method: 'PUT',
			data: { id: null },
		} );
	} );
} );
