import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockCreateRowDocument = jest.fn();
jest.mock( '../../../src/components/rowDocumentCreation', () => ( {
	useCreateRowDocument: () => mockCreateRowDocument,
} ) );

import DataViewNewRowButton from '../../../src/components/DataViewNewRowButton';

function renderButton( overrides = {} ) {
	return render(
		<DataViewNewRowButton
			collectionId={ 9 }
			view={ { filters: [] } }
			fields={ [] }
			onCreated={ jest.fn() }
			{ ...overrides }
		/>
	);
}

beforeEach( () => {
	mockCreateRowDocument.mockReset();
} );

describe( 'DataViewNewRowButton', () => {
	it( 'passes eligible filter values when creating a row', async () => {
		const created = { id: 44, title: { raw: '' } };
		const onCreated = jest.fn();
		mockCreateRowDocument.mockResolvedValue( created );

		renderButton( {
			view: {
				filters: [
					{ field: 'priority', operator: 'is', value: 'high' },
					{ field: 'readonly', operator: 'is', value: 'ignored' },
					{ field: 'rollup', operator: 'is', value: 10 },
					{ field: 'priority', operator: 'isAny', value: 'ignored' },
					{ field: 'title', operator: 'is', value: 'ignored' },
				],
			},
			fields: [
				{ id: 'priority' },
				{ id: 'readonly', editable: false },
				{ id: 'rollup', cortextType: 'rollup' },
			],
			onCreated,
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'New' } ) );

		await waitFor( () =>
			expect( mockCreateRowDocument ).toHaveBeenCalledWith( {
				collectionId: 9,
				meta: { priority: 'high' },
			} )
		);
		await waitFor( () =>
			expect( onCreated ).toHaveBeenCalledWith( created )
		);
	} );

	it( 'omits meta when no active filter can prefill the row', async () => {
		mockCreateRowDocument.mockResolvedValue( { id: 45 } );

		renderButton();
		fireEvent.click( screen.getByRole( 'button', { name: 'New' } ) );

		await waitFor( () =>
			expect( mockCreateRowDocument ).toHaveBeenCalledWith( {
				collectionId: 9,
				meta: {},
			} )
		);
	} );

	it( 'shows the save error and does not report the row as created', async () => {
		const onCreated = jest.fn();
		mockCreateRowDocument.mockRejectedValue(
			new Error( 'The row could not be saved.' )
		);

		renderButton( { onCreated } );
		fireEvent.click( screen.getByRole( 'button', { name: 'New' } ) );

		expect(
			( await screen.findAllByText( 'The row could not be saved.' ) )
				.length
		).toBeGreaterThan( 0 );
		expect( onCreated ).not.toHaveBeenCalled();
	} );
} );
