import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRun = jest.fn();

jest.mock( '@wordpress/components', () => {
	const { createElement } = require( '@wordpress/element' );

	return {
		__esModule: true,
		Icon: () => createElement( 'span', { 'data-testid': 'wp-icon' } ),
		Notice: ( { children } ) =>
			createElement( 'div', { role: 'alert' }, children ),
		Popover: ( { children } ) => createElement( 'div', null, children ),
	};
} );

jest.mock( '../../../../src/hooks/useFieldMutations', () => ( {
	useChangeFieldType: () => ( {
		run: mockRun,
		isBusy: false,
		error: null,
	} ),
} ) );

import ChangeFieldTypePopover from '../../../../src/components/fields/ChangeFieldTypePopover';

describe( 'ChangeFieldTypePopover', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		mockRun.mockResolvedValue( { id: 77, type: 'checkbox' } );
	} );

	it( 'shows type icons and commits the selected type', async () => {
		render(
			<ChangeFieldTypePopover
				anchor={ document.body }
				collectionId={ 5 }
				recordId={ 77 }
				currentType="text"
			/>
		);

		const numberButton = screen.getByRole( 'button', { name: 'Number' } );
		expect(
			numberButton.querySelector(
				'.cortext-change-field-type-popover__type-icon[data-cortext-field-type="number"]'
			)
		).toBeInTheDocument();

		fireEvent.click( numberButton );

		await waitFor( () =>
			expect( mockRun ).toHaveBeenCalledWith( 77, 'number' )
		);
	} );

	it( 'notifies after a successful type conversion', async () => {
		const onClose = jest.fn();
		const onTypeChanged = jest.fn();

		render(
			<ChangeFieldTypePopover
				collectionId={ 5 }
				recordId={ 77 }
				currentType="text"
				onClose={ onClose }
				onTypeChanged={ onTypeChanged }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Checkbox' } )
		);

		await waitFor( () =>
			expect( mockRun ).toHaveBeenCalledWith( 77, 'checkbox' )
		);
		expect( onTypeChanged ).toHaveBeenCalledWith( 'checkbox' );
		expect( onClose ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not notify when type conversion fails', async () => {
		mockRun.mockRejectedValue( new Error( 'nope' ) );
		const onTypeChanged = jest.fn();

		render(
			<ChangeFieldTypePopover
				collectionId={ 5 }
				recordId={ 77 }
				currentType="text"
				onTypeChanged={ onTypeChanged }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Checkbox' } )
		);

		await waitFor( () => expect( mockRun ).toHaveBeenCalled() );
		expect( onTypeChanged ).not.toHaveBeenCalled();
	} );
} );
