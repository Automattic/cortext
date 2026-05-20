/**
 * Render and behavior tests for `src/components/TypeToConfirmDialog.js`.
 */

import { fireEvent, render, screen } from '@testing-library/react';

// Stub `@wordpress/components` so the Modal/TextControl/Button surface is
// trivial to exercise. The component's logic (matching, key handling, enable
// state) is what's under test, not the WP component internals.
jest.mock( '@wordpress/components', () => {
	const ReactLib = require( 'react' );
	const Modal = ( { children, title, onRequestClose } ) =>
		ReactLib.createElement(
			'div',
			{ role: 'dialog' },
			ReactLib.createElement( 'h2', null, title ),
			ReactLib.createElement(
				'button',
				{ onClick: onRequestClose, 'data-testid': 'modal-close' },
				'Close'
			),
			children
		);
	const TextControl = ReactLib.forwardRef(
		( { value, onChange, onKeyDown, disabled }, ref ) =>
			ReactLib.createElement( 'input', {
				ref,
				'data-testid': 'confirm-input',
				value: value ?? '',
				onChange: ( event ) => onChange( event.target.value ),
				onKeyDown,
				disabled,
			} )
	);
	const Button = ( { children, onClick, disabled, isDestructive, isBusy } ) =>
		ReactLib.createElement(
			'button',
			{
				onClick,
				disabled,
				'data-destructive': isDestructive ? 'true' : 'false',
				'data-busy': isBusy ? 'true' : 'false',
			},
			children
		);
	return { __esModule: true, Modal, TextControl, Button };
} );

import TypeToConfirmDialog from '../../../src/components/TypeToConfirmDialog';

function renderDialog( overrides = {} ) {
	const onConfirm = jest.fn();
	const onCancel = jest.fn();
	const utils = render(
		<TypeToConfirmDialog
			title="Delete this collection?"
			message="This is permanent."
			confirmPhrase="Library"
			onConfirm={ onConfirm }
			onCancel={ onCancel }
			{ ...overrides }
		/>
	);
	return { ...utils, onConfirm, onCancel };
}

describe( 'TypeToConfirmDialog', () => {
	it( 'keeps the confirm button disabled until the typed value matches', () => {
		renderDialog();

		const confirm = screen.getByRole( 'button', {
			name: 'Delete permanently',
		} );
		expect( confirm ).toBeDisabled();

		fireEvent.change( screen.getByTestId( 'confirm-input' ), {
			target: { value: 'Lib' },
		} );
		expect( confirm ).toBeDisabled();

		fireEvent.change( screen.getByTestId( 'confirm-input' ), {
			target: { value: 'Library' },
		} );
		expect( confirm ).toBeEnabled();
	} );

	it( 'calls onConfirm only when the typed value matches', () => {
		const { onConfirm } = renderDialog();

		const confirm = screen.getByRole( 'button', {
			name: 'Delete permanently',
		} );

		fireEvent.click( confirm );
		expect( onConfirm ).not.toHaveBeenCalled();

		fireEvent.change( screen.getByTestId( 'confirm-input' ), {
			target: { value: 'Library' },
		} );
		fireEvent.click( confirm );
		expect( onConfirm ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'submits with Enter once the value matches', () => {
		const { onConfirm } = renderDialog();

		fireEvent.change( screen.getByTestId( 'confirm-input' ), {
			target: { value: 'Library' },
		} );
		fireEvent.keyDown( screen.getByTestId( 'confirm-input' ), {
			key: 'Enter',
		} );

		expect( onConfirm ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'cancels on Escape', () => {
		const { onCancel } = renderDialog();

		fireEvent.keyDown( screen.getByTestId( 'confirm-input' ), {
			key: 'Escape',
		} );

		expect( onCancel ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'treats surrounding whitespace as a match', () => {
		const { onConfirm } = renderDialog();

		fireEvent.change( screen.getByTestId( 'confirm-input' ), {
			target: { value: '  Library  ' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);

		expect( onConfirm ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables the input and buttons while isBusy is true', () => {
		renderDialog( { isBusy: true } );

		fireEvent.change( screen.getByTestId( 'confirm-input' ), {
			target: { value: 'Library' },
		} );
		expect(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		).toBeDisabled();
		expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toBeDisabled();
	} );
} );
