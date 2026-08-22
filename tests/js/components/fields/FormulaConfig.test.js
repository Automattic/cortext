import { fireEvent, render, screen } from '@testing-library/react';

jest.mock( '@wordpress/i18n', () => ( {
	__: ( value ) =>
		( {
			'Built-in field': 'Campo integrado',
			Created: 'Creación',
			'Date & time': 'Fecha y hora',
			'Last edited': 'Última edición',
			Text: 'Texto',
			Title: 'Título',
		} )[ value ] ?? value,
} ) );

jest.mock( '@wordpress/components', () => {
	const { createElement } = require( '@wordpress/element' );

	return {
		Button: ( {
			children,
			icon,
			isBusy,
			isPressed,
			label,
			onClick,
			size,
			variant,
			...props
		} ) =>
			createElement(
				'button',
				{
					...props,
					type: 'button',
					'aria-label': label,
					'aria-pressed': isPressed,
					onClick,
				},
				children ?? label
			),
		Notice: ( { children } ) => createElement( 'div', null, children ),
	};
} );

jest.mock( '../../../../src/components/CollectionFieldsContext', () => ( {
	useCollectionFieldsContext: jest.fn( () => ( { fields: [] } ) ),
} ) );

import FormulaConfig from '../../../../src/components/fields/FormulaConfig';
import { useCollectionFieldsContext } from '../../../../src/components/CollectionFieldsContext';

describe( 'FormulaConfig localized system field suggestions', () => {
	beforeEach( () => {
		useCollectionFieldsContext.mockReturnValue( { fields: [] } );
	} );

	it( 'shows a localized label but inserts the canonical reference name', () => {
		const onSubmit = jest.fn();
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		window.requestAnimationFrame = ( callback ) => callback();

		try {
			render(
				<FormulaConfig onBack={ jest.fn() } onSubmit={ onSubmit } />
			);

			const editor = screen.getByLabelText( 'Formula' );
			fireEvent.change( editor, {
				target: { value: 'field("Tít', selectionStart: 10 },
			} );

			const titleSuggestion = screen.getByRole( 'option', {
				name: /Título/,
			} );
			expect( titleSuggestion ).toHaveTextContent( 'Texto' );

			fireEvent.mouseDown( titleSuggestion );

			expect( editor ).toHaveValue( 'field("Title")' );
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Create formula' } )
			);
			expect( onSubmit ).toHaveBeenCalledWith( 'field("Title")' );
		} finally {
			window.requestAnimationFrame = originalRequestAnimationFrame;
		}
	} );

	it( 'distinguishes a localized built-in field from a custom field with the same label', () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					cortextType: 'text',
					label: 'Título',
					recordId: 42,
				},
			],
		} );
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		window.requestAnimationFrame = ( callback ) => callback();

		try {
			render(
				<FormulaConfig onBack={ jest.fn() } onSubmit={ jest.fn() } />
			);

			const editor = screen.getByLabelText( 'Formula' );
			fireEvent.change( editor, {
				target: { value: 'field("Tít', selectionStart: 10 },
			} );

			const suggestions = screen.getAllByRole( 'option', {
				name: /Título/,
			} );
			expect( suggestions ).toHaveLength( 2 );
			const builtIn = suggestions.find( ( suggestion ) =>
				suggestion.textContent.includes( 'Campo integrado' )
			);
			expect( builtIn ).toBeDefined();

			fireEvent.mouseDown( builtIn );
			expect( editor ).toHaveValue( 'field("Title")' );

			fireEvent.change( editor, {
				target: { value: 'field("Tít', selectionStart: 10 },
			} );
			const custom = screen
				.getAllByRole( 'option', { name: /Título/ } )
				.find(
					( suggestion ) =>
						! suggestion.textContent.includes( 'Campo integrado' )
				);
			expect( custom ).toBeDefined();
			fireEvent.mouseDown( custom );
			expect( editor ).toHaveValue( 'field("Título")' );
		} finally {
			window.requestAnimationFrame = originalRequestAnimationFrame;
		}
	} );
} );
