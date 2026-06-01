import { filterSortAndPaginate } from '@wordpress/dataviews';

import { buildPublicFields } from '../../../src/hooks/publicFieldMapping';

describe( 'buildPublicFields', () => {
	it( 'marks public text-like fields as searchable', () => {
		const fields = buildPublicFields( [
			{ id: 11, label: 'Notes', type: 'text', options: null },
			{ id: 22, label: 'Author', type: 'relation', options: null },
			{ id: 33, label: 'Score', type: 'number', options: null },
		] );

		expect( fields.find( ( field ) => field.id === 'title' ) ).toEqual(
			expect.objectContaining( { enableGlobalSearch: true } )
		);
		expect( fields.find( ( field ) => field.id === 'field-11' ) ).toEqual(
			expect.objectContaining( { enableGlobalSearch: true } )
		);
		expect( fields.find( ( field ) => field.id === 'field-22' ) ).toEqual(
			expect.objectContaining( { enableGlobalSearch: true } )
		);
		expect( fields.find( ( field ) => field.id === 'field-33' ) ).toEqual(
			expect.objectContaining( { enableGlobalSearch: false } )
		);
	} );

	it( 'searches public custom text fields in the local DataViews pass', () => {
		const fields = buildPublicFields( [
			{ id: 11, label: 'Notes', type: 'text', options: null },
		] );

		const { data } = filterSortAndPaginate(
			[
				{
					id: 1,
					title: { rendered: 'Alpha' },
					meta: { 'field-11': 'needle in the notes' },
				},
				{
					id: 2,
					title: { rendered: 'Needle title' },
					meta: { 'field-11': 'plain notes' },
				},
				{
					id: 3,
					title: { rendered: 'Gamma' },
					meta: { 'field-11': 'plain notes' },
				},
			],
			{ search: 'needle' },
			fields
		);

		expect( data.map( ( item ) => item.id ) ).toEqual( [ 1, 2 ] );
	} );

	it( 'uses editor-like public filter operators for text fields', () => {
		const fields = buildPublicFields( [
			{ id: 11, label: 'Notes', type: 'text', options: null },
		] );
		const notes = fields.find( ( field ) => field.id === 'field-11' );

		expect( notes.filterBy ).toEqual( {
			operators: [
				'is',
				'isNot',
				'contains',
				'notContains',
				'startsWith',
			],
		} );

		const { data } = filterSortAndPaginate(
			[
				{ id: 1, meta: { 'field-11': 'needle in the notes' } },
				{ id: 2, meta: { 'field-11': 'plain notes' } },
			],
			{
				filters: [
					{
						field: 'field-11',
						operator: 'contains',
						value: 'needle',
					},
				],
			},
			fields
		);

		expect( data.map( ( item ) => item.id ) ).toEqual( [ 1 ] );
	} );

	it( 'keeps number values numeric for the public client filter pass', () => {
		const fields = buildPublicFields( [
			{ id: 33, label: 'Score', type: 'number', options: null },
		] );
		const scoreField = fields.find( ( field ) => field.id === 'field-33' );

		expect(
			scoreField.getValue( {
				item: { meta: { 'field-33': '5' } },
			} )
		).toBe( 5 );

		const { data } = filterSortAndPaginate(
			[
				{ id: 1, meta: { 'field-33': '5' } },
				{ id: 2, meta: { 'field-33': '7' } },
			],
			{
				filters: [
					{
						field: 'field-33',
						operator: 'is',
						value: 5,
					},
				],
			},
			fields
		);

		expect( data.map( ( item ) => item.id ) ).toEqual( [ 1 ] );
	} );
} );
