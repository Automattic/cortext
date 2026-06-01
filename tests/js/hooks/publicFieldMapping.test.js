import { filterSortAndPaginate } from '@wordpress/dataviews';

import { buildPublicFields } from '../../../src/hooks/publicFieldMapping';

describe( 'buildPublicFields', () => {
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
