import { renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useCollectionRows from '../../../src/hooks/useCollectionRows';

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( {
		rows: [],
		collection: null,
		total: 0,
		totalPages: 1,
	} );
} );

describe( 'useCollectionRows', () => {
	it( 'refetches rows when the visible schema gains a rollup field', async () => {
		const view = { type: 'table', filters: [] };
		const initialFields = [
			{ id: 'title', cortextType: 'title' },
			{ id: 'field-10', recordId: 10, cortextType: 'relation' },
		];
		const nextFields = [
			...initialFields,
			{ id: 'field-20', recordId: 20, cortextType: 'rollup' },
		];

		const { rerender } = renderHook(
			( { fields } ) => useCollectionRows( 7, view, fields ),
			{ initialProps: { fields: initialFields } }
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		rerender( { fields: nextFields } );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( apiFetch ).toHaveBeenLastCalledWith(
			expect.objectContaining( {
				path: expect.stringContaining( 'collection=7' ),
			} )
		);
	} );
} );
