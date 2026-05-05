import { fireEvent, render, screen } from '@testing-library/react';

jest.mock( '@wordpress/components', () => {
	const { createElement, forwardRef } = require( '@wordpress/element' );

	const Button = forwardRef( ( props, ref ) => {
		const { children, label, onClick, ...rest } = props;
		return createElement(
			'button',
			{
				ref,
				type: 'button',
				onClick,
				'aria-label': label,
				...rest,
			},
			children ?? label
		);
	} );
	Button.displayName = 'Button';

	const Popover = ( { children } ) => createElement( 'div', null, children );

	return {
		__esModule: true,
		Button,
		Popover,
	};
} );

jest.mock( '../../../src/components/fields/EditOptionsPopover', () => ( {
	__esModule: true,
	default: ( { initialOptions, onPick } ) => (
		<div>
			{ initialOptions.map( ( option ) => (
				<button
					key={ option.value }
					type="button"
					onClick={ () => onPick( option.value ) }
				>
					{ option.label }
				</button>
			) ) }
		</div>
	),
} ) );

import MultiselectEdit from '../../../src/components/MultiselectEdit';

describe( 'MultiselectEdit', () => {
	it( 'keeps rapid toggles based on the local selected values', () => {
		const onSave = jest.fn();
		render(
			<MultiselectEdit
				recordId={ 7 }
				value={ [] }
				elements={ [
					{ value: 'a', label: 'A' },
					{ value: 'b', label: 'B' },
				] }
				onSave={ onSave }
				onCancel={ jest.fn() }
				label="Tags"
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'A' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'B' } ) );

		expect( onSave ).toHaveBeenNthCalledWith( 1, [ 'a' ] );
		expect( onSave ).toHaveBeenNthCalledWith( 2, [ 'a', 'b' ] );
	} );
} );
