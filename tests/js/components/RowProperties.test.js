import { render, screen } from '@testing-library/react';

jest.mock( '@wordpress/components', () => {
	const { createElement, forwardRef } = require( '@wordpress/element' );

	const Button = forwardRef( ( { children, ...props }, ref ) =>
		createElement( 'button', { ...props, ref, type: 'button' }, children )
	);
	Button.displayName = 'Button';

	return {
		__esModule: true,
		Button,
		CheckboxControl: () => createElement( 'input', { type: 'checkbox' } ),
		DateTimePicker: () => createElement( 'div', null ),
		Dropdown: () => createElement( 'div', null ),
		Icon: () => createElement( 'span', { 'data-testid': 'wp-icon' } ),
		Popover: ( { children } ) => createElement( 'div', null, children ),
	};
} );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: jest.fn(),
	useSelect: jest.fn(),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	store: 'editor-store',
} ) );

jest.mock( '../../../src/components/EditableCell', () => {
	const { createContext } = require( '@wordpress/element' );

	return {
		__esModule: true,
		default: () => null,
		RowMutationContext: createContext( {} ),
		dateOnlyValue: ( value ) => value,
		formatDisplay: ( value ) => ( value ? String( value ) : '' ),
	};
} );

import { useDispatch, useSelect } from '@wordpress/data';
import RowProperties from '../../../src/components/RowProperties';

describe( 'RowProperties', () => {
	beforeEach( () => {
		useDispatch.mockReturnValue( { editPost: jest.fn() } );
		useSelect.mockReturnValue( {
			title: 'Current title',
			meta: { 'field-7': 'Open' },
			hydratedMeta: {},
		} );
	} );

	it( 'shows field type icons for collection fields only', () => {
		render(
			<RowProperties
				fields={ [
					{
						id: 'title',
						label: 'Title',
						cortextFieldType: 'title',
						editable: true,
					},
					{
						id: 'field-7',
						label: 'Status',
						cortextFieldType: 'text',
						cortextRecordId: 7,
						editable: true,
					},
					{
						id: 'created_at',
						label: 'Created',
						cortextFieldType: 'datetime',
						editable: false,
						getValue: () => '2026-05-23T10:00:00',
					},
				] }
				row={ {} }
			/>
		);

		const statusLabel = screen
			.getByText( 'Status' )
			.closest( '.cortext-row-detail__property-label' );
		expect(
			statusLabel.querySelector(
				'.cortext-row-detail__property-type-icon[data-cortext-field-type="text"]'
			)
		).toBeInTheDocument();

		const createdLabel = screen
			.getByText( 'Created' )
			.closest( '.cortext-row-detail__property-label' );
		expect(
			createdLabel.querySelector( '.cortext-field-type-icon' )
		).toBeNull();
		expect( screen.queryByText( 'Title' ) ).not.toBeInTheDocument();
	} );
} );
