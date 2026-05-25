import { fireEvent, render, screen } from '@testing-library/react';

jest.mock( '@wordpress/components', () => {
	const { createElement } = require( '@wordpress/element' );

	return {
		__esModule: true,
		Icon: () => createElement( 'span', { 'data-testid': 'wp-icon' } ),
		Notice: ( { children } ) => createElement( 'div', null, children ),
		Popover: ( { children } ) => createElement( 'div', null, children ),
	};
} );

jest.mock( '../../../../src/hooks/useFieldMutations', () => ( {
	useChangeFieldType: jest.fn(),
} ) );

import ChangeFieldTypePopover from '../../../../src/components/fields/ChangeFieldTypePopover';
import { useChangeFieldType } from '../../../../src/hooks/useFieldMutations';

describe( 'ChangeFieldTypePopover', () => {
	it( 'shows type icons and commits the selected type', () => {
		const run = jest.fn().mockResolvedValue( {} );
		useChangeFieldType.mockReturnValue( {
			run,
			isBusy: false,
			error: null,
		} );

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

		expect( run ).toHaveBeenCalledWith( 77, 'number' );
	} );
} );
