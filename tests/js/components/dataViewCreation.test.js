import { nextViewAfterRowCreated } from '../../../src/components/dataViewCreation';

describe( 'nextViewAfterRowCreated', () => {
	const baseView = {
		type: 'grid',
		page: 1,
		perPage: 12,
		search: '',
		filters: [],
		sort: null,
	};

	it( 'moves an unconstrained view to the last page when a row would append there', () => {
		const next = nextViewAfterRowCreated( baseView, { totalItems: 12 } );

		expect( next ).toEqual( {
			...baseView,
			page: 2,
		} );
	} );

	it( 'refreshes in place when search means the new row may not match', () => {
		const view = {
			...baseView,
			search: 'purple',
		};

		expect( nextViewAfterRowCreated( view, { totalItems: 12 } ) ).toBe(
			view
		);
	} );

	it( 'refreshes in place when filters mean the new row may not match', () => {
		const view = {
			...baseView,
			filters: [
				{
					field: 'field-1',
					operator: 'is',
					value: 'Rock',
				},
			],
		};

		expect( nextViewAfterRowCreated( view, { totalItems: 12 } ) ).toBe(
			view
		);
	} );

	it( 'refreshes in place when a sort can place the new row anywhere', () => {
		const view = {
			...baseView,
			sort: {
				field: 'title',
				direction: 'asc',
			},
		};

		expect( nextViewAfterRowCreated( view, { totalItems: 12 } ) ).toBe(
			view
		);
	} );
} );
